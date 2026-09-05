// Pure, deterministic parser for the `/autopilot` command argument text.
// Grammar:
//   (empty) | help                      -> help
//   on [flags]                          -> ambient autonomy
//   off | stop                          -> stop
//   pause                               -> pause objective
//   resume [flags]                      -> resume objective
//   clear                               -> clear objective
//   status                              -> run card
//   <objective> [flags]                 -> start objective run
// Flags (first line, removed from the objective):
//   --agent=<id> | --agent <id>
//   --max=<n> | --max <n> | bare `max <n>`
//   --limited | bare `limited`, --allow-all | bare `allow-all`
//   --duration=<15m|900s|900000ms|900000>
//   --tokens=<100k|100000>
//   --verify="<cmd>" | --done-when="<text>"
//   --strength=<conservative|balanced|aggressive>
// Multi-line input: first line is the objective; remaining lines become the
// plan when they look like a list, otherwise they extend the objective.

export type AutopilotActionName =
  | "help"
  | "on"
  | "off"
  | "stop"
  | "pause"
  | "resume"
  | "clear"
  | "status"
  | "start"
  | "run";

export interface AutopilotActionArgs {
  action?: AutopilotActionName;
  objective?: string;
  goal?: string;
  target?: string;
  task?: string;
  doneWhen?: string;
  verifyWith?: string;
  plan?: string;
  permissionMode?: "limited" | "allow-all";
  maxContinues?: number;
  maxDurationMs?: number;
  maxTokens?: number;
  noProgressTokenThreshold?: number;
  noProgressTurns?: number;
  workerAgent?: string;
  autonomousStrength?: "conservative" | "balanced" | "aggressive";
}

export interface ParsedAutopilotCommand extends AutopilotActionArgs {
  action: AutopilotActionName;
}

const KEYWORD_ACTIONS: ReadonlySet<AutopilotActionName> = new Set([
  "help",
  "on",
  "off",
  "stop",
  "pause",
  "resume",
  "clear",
  "status",
]);

const STRENGTHS = new Set(["conservative", "balanced", "aggressive"]);
const LIST_LINE_RE = /^\s*(?:[-*]|\d+[.)])\s+/;

function unquoteSegments(token: string): string {
  return token.replace(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g, (_, doubled, singled) =>
    ((doubled ?? singled ?? "") as string).replace(/\\(["'])/g, "$1"),
  );
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  // A token is a run of unquoted non-space characters and quoted segments,
  // so `--verify="bun test"` stays one token.
  const regex = /(?:[^\s"']+|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')+/g;
  let match = regex.exec(input);
  while (match) {
    tokens.push(unquoteSegments(match[0]));
    match = regex.exec(input);
  }
  return tokens;
}

function parsePositiveInt(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseDurationMs(value: string): number | undefined {
  const match = value.match(/^(\d+)(ms|s|m|h)?$/i);
  if (!match?.[1]) return undefined;
  const amount = Number(match[1]);
  if (!Number.isSafeInteger(amount) || amount <= 0) return undefined;
  const unit = (match[2] ?? "ms").toLowerCase();
  const multiplier = unit === "h" ? 3_600_000 : unit === "m" ? 60_000 : unit === "s" ? 1000 : 1;
  return amount * multiplier;
}

function parseTokenCount(value: string): number | undefined {
  const match = value.match(/^(\d+)(k)?$/i);
  if (!match?.[1]) return undefined;
  const amount = Number(match[1]);
  if (!Number.isSafeInteger(amount) || amount <= 0) return undefined;
  return match[2] ? amount * 1000 : amount;
}

function stripQuotes(value: string): string {
  const match = value.match(/^"([\s\S]*)"$|^'([\s\S]*)'$/);
  return match ? (match[1] ?? match[2] ?? "") : value;
}

function applyFlagValue(args: AutopilotActionArgs, name: string, value: string): boolean {
  switch (name) {
    case "agent": {
      if (value.trim()) args.workerAgent = value.trim();
      return true;
    }
    case "max": {
      const parsed = parsePositiveInt(value);
      if (parsed !== undefined) args.maxContinues = parsed;
      return true;
    }
    case "duration": {
      const parsed = parseDurationMs(value);
      if (parsed !== undefined) args.maxDurationMs = parsed;
      return true;
    }
    case "tokens": {
      const parsed = parseTokenCount(value);
      if (parsed !== undefined) args.maxTokens = parsed;
      return true;
    }
    case "verify": {
      const command = stripQuotes(value).trim();
      if (command) args.verifyWith = command;
      return true;
    }
    case "done-when": {
      const text = stripQuotes(value).trim();
      if (text) args.doneWhen = text;
      return true;
    }
    case "strength": {
      const strength = value.trim().toLowerCase();
      if (STRENGTHS.has(strength)) {
        args.autonomousStrength = strength as AutopilotActionArgs["autonomousStrength"];
      }
      return true;
    }
    default:
      return false;
  }
}

const VALUE_FLAGS = new Set([
  "agent",
  "max",
  "duration",
  "tokens",
  "verify",
  "done-when",
  "strength",
]);

function extractFlags(line: string, args: AutopilotActionArgs): string {
  const tokens = tokenize(line);
  const objectiveWords: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";

    if (token === "--limited" || token === "limited") {
      args.permissionMode = "limited";
      continue;
    }
    if (token === "--allow-all" || token === "allow-all") {
      args.permissionMode = "allow-all";
      continue;
    }

    const flagMatch = token.match(/^--([a-z-]+)(?:=([\s\S]*))?$/);
    if (flagMatch?.[1] && VALUE_FLAGS.has(flagMatch[1])) {
      const name = flagMatch[1];
      let value = flagMatch[2];
      if (value === undefined) {
        value = tokens[index + 1] ?? "";
        index += 1;
      }
      applyFlagValue(args, name, value);
      continue;
    }

    if (token === "max") {
      const next = tokens[index + 1] ?? "";
      const parsed = parsePositiveInt(next);
      if (parsed !== undefined) {
        args.maxContinues = parsed;
        index += 1;
        continue;
      }
    }

    objectiveWords.push(token);
  }

  return objectiveWords.join(" ").trim();
}

export function parseAutopilotCommand(text: string): ParsedAutopilotCommand {
  const lines = text.split(/\r?\n/);
  const firstLine = lines[0] ?? "";
  const restLines = lines.slice(1).filter((line) => line.trim().length > 0);

  const args: AutopilotActionArgs = {};
  const objective = extractFlags(firstLine, args);
  const lowered = objective.toLowerCase();

  if (!objective && restLines.length === 0) {
    return { ...args, action: "help" };
  }

  if (KEYWORD_ACTIONS.has(lowered as AutopilotActionName) && restLines.length === 0) {
    return { ...args, action: lowered as AutopilotActionName };
  }

  const parsed: ParsedAutopilotCommand = { ...args, action: "start", objective };
  if (restLines.length > 0) {
    if (restLines.some((line) => LIST_LINE_RE.test(line))) {
      parsed.plan = restLines.join("\n");
    } else {
      parsed.objective = [objective, ...restLines].filter(Boolean).join("\n");
    }
  }
  return parsed;
}
