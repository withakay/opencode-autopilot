// The `autopilot` tool definition for the v2 tool.transform registration.
// Keeps the v1 argument surface, expressed as JSON Schema.
import type { AutopilotActionArgs, AutopilotActionName } from "../command/parse.ts";

export const AUTOPILOT_TOOL_NAME = "autopilot";

export const AUTOPILOT_TOOL_DESCRIPTION =
  "Control session autopilot: enable ambient autonomy or start a durable objective run";

export const autopilotToolInput = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["on", "off", "stop", "status", "help", "start", "run", "pause", "resume", "clear"],
      description:
        "Autopilot command: start/run, on, off/stop, pause, resume, clear, status, or help",
    },
    task: {
      type: "string",
      description: "Deprecated alias for objective; starts a durable objective run when provided",
    },
    objective: {
      type: "string",
      description: "Durable objective to keep working toward until complete or blocked",
    },
    goal: { type: "string", description: "Alias for objective" },
    target: { type: "string", description: "Alias for objective" },
    doneWhen: {
      type: "string",
      description: "Verifiable stopping condition for the objective run",
    },
    verifyWith: {
      type: "string",
      description: "Command or artifact that proves the objective is complete",
    },
    plan: {
      type: "string",
      description: "Optional newline or JSON-array plan to execute step by step",
    },
    permissionMode: {
      type: "string",
      enum: ["limited", "allow-all"],
      description: "How permissions should behave while autopilot is active",
    },
    maxContinues: {
      type: "integer",
      minimum: 1,
      description: "Maximum number of autonomous continuation prompts",
    },
    maxDurationMs: {
      type: "integer",
      minimum: 1,
      description: "Maximum objective run duration in milliseconds",
    },
    maxTokens: {
      type: "integer",
      minimum: 1,
      description: "Maximum tracked worker message tokens before stopping",
    },
    noProgressTokenThreshold: {
      type: "integer",
      minimum: 1,
      description: "Worker output tokens below this threshold count as low-progress",
    },
    noProgressTurns: {
      type: "integer",
      minimum: 1,
      description: "Low-progress worker turns before pausing the objective",
    },
    workerAgent: {
      type: "string",
      description: "Delegate agent used for long-running autopilot objective runs",
    },
    autonomousStrength: {
      type: "string",
      enum: ["conservative", "balanced", "aggressive"],
      description:
        "How strongly autopilot prefers defaults: conservative (soft guidance), balanced (default, stronger guidance), aggressive (always pick recommended/safe defaults)",
    },
  },
  additionalProperties: false,
} as const;

const ACTIONS = new Set<AutopilotActionName>([
  "help",
  "on",
  "off",
  "stop",
  "pause",
  "resume",
  "clear",
  "status",
  "start",
  "run",
]);

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asPositiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/** Validates the untyped JSON-schema tool input into the shared action args. */
export function normalizeAutopilotToolInput(input: unknown): AutopilotActionArgs {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const args: AutopilotActionArgs = {};

  const action = asString(raw.action);
  if (action && ACTIONS.has(action as AutopilotActionName)) {
    args.action = action as AutopilotActionName;
  }
  args.objective = asString(raw.objective);
  args.goal = asString(raw.goal);
  args.target = asString(raw.target);
  args.task = asString(raw.task);
  args.doneWhen = asString(raw.doneWhen);
  args.verifyWith = asString(raw.verifyWith);
  args.plan = asString(raw.plan);
  args.workerAgent = asString(raw.workerAgent);

  const permissionMode = asString(raw.permissionMode);
  if (permissionMode === "limited" || permissionMode === "allow-all") {
    args.permissionMode = permissionMode;
  }
  const strength = asString(raw.autonomousStrength);
  if (strength === "conservative" || strength === "balanced" || strength === "aggressive") {
    args.autonomousStrength = strength;
  }

  args.maxContinues = asPositiveInt(raw.maxContinues);
  args.maxDurationMs = asPositiveInt(raw.maxDurationMs);
  args.maxTokens = asPositiveInt(raw.maxTokens);
  args.noProgressTokenThreshold = asPositiveInt(raw.noProgressTokenThreshold);
  args.noProgressTurns = asPositiveInt(raw.noProgressTurns);

  return args;
}
