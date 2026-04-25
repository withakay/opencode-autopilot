import type { AutopilotConfig } from "../config/autopilot-config.ts";

export type AutopilotDirectiveStatus = "continue" | "validate" | "complete" | "blocked";

export interface AutopilotDirective {
  status: AutopilotDirectiveStatus;
  reason: string;
}

const AUTOPILOT_MARKER_RE =
  /\n?<autopilot\s+status="(continue|validate|complete|blocked)">([\s\S]*?)<\/autopilot>\s*$/i;
const BLOCKED_HINT_RE =
  /(need (more|additional) information|cannot continue|can't continue|blocked|waiting for user|please provide|which option|what should i|what would you like)/i;
const ROUTINE_CONFIRMATION_RE =
  /(do you want me to|would you like me to|should i|shall i|want me to|should we|may i proceed|can i proceed)/i;
const OBVIOUS_NEXT_STEP_RE =
  /(next|continue|proceed|inspect|read|edit|update|fix|implement|refactor|verify|validate|run (the )?(tests|test|checks|build|lint|typecheck))/i;
const HIGH_IMPACT_RE =
  /(delete|destroy|drop( (table|database|schema))?|truncate|wipe|purge|overwrite|force.?push|production|staging|billing|payment|secret|credential|api.?key|token|env(ironment)?\s+var(iable)?|security|migration|schema.change|irreversible|one.way|cannot be undone|major refactor|breaking change)/i;

export function parseAutopilotMarker(text: string): AutopilotDirective | null {
  const match = text.match(AUTOPILOT_MARKER_RE);

  if (!match) {
    return null;
  }

  const [, rawStatus, rawReason] = match;

  if (!rawStatus || rawReason === undefined) {
    return null;
  }

  const status = rawStatus.toLowerCase() as AutopilotDirectiveStatus;
  return {
    status,
    reason: rawReason.trim() || defaultReason(status),
  };
}

export function stripAutopilotMarker(text: string): string {
  return text.replace(AUTOPILOT_MARKER_RE, "").trimEnd();
}

function configRegex(patterns: string[] | undefined): RegExp | null {
  if (!patterns || patterns.length === 0) {
    return null;
  }

  const escaped = patterns.map((pattern) => pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(escaped.join("|"), "i");
}

export function inferAutopilotDirective(
  text: string,
  config: AutopilotConfig = {},
): AutopilotDirective {
  const marker = parseAutopilotMarker(text);

  if (marker) {
    return marker;
  }

  const source = text.trim();
  const blockedPatternRe = configRegex(config.directiveRules?.blockedPatterns);
  const highImpactPatternRe = configRegex(config.directiveRules?.highImpactPatterns);
  const blockedHint = BLOCKED_HINT_RE.test(source) || blockedPatternRe?.test(source) === true;
  const highImpactHint = HIGH_IMPACT_RE.test(source) || highImpactPatternRe?.test(source) === true;

  if (!source) {
    return {
      status: "blocked",
      reason: "Assistant returned no usable response.",
    };
  }

  if (
    source.length < 300 &&
    !blockedHint &&
    ROUTINE_CONFIRMATION_RE.test(source) &&
    OBVIOUS_NEXT_STEP_RE.test(source) &&
    !highImpactHint
  ) {
    return {
      status: "continue",
      reason: "Assistant asked for routine confirmation; continuing with the obvious next step.",
    };
  }

  if (ROUTINE_CONFIRMATION_RE.test(source) && highImpactHint) {
    return {
      status: "blocked",
      reason: "Assistant requested input for a high-impact decision.",
    };
  }

  if (blockedHint) {
    return {
      status: "blocked",
      reason: "Assistant requested input or reported it could not continue.",
    };
  }

  return {
    status: "continue",
    reason: "No autopilot marker emitted; continuing with fallback policy.",
  };
}

function defaultReason(status: AutopilotDirectiveStatus): string {
  if (status === "complete") {
    return "Task complete.";
  }

  if (status === "blocked") {
    return "Task is blocked.";
  }

  if (status === "validate") {
    return "Task needs validation before marking complete.";
  }

  return "More work remains.";
}
