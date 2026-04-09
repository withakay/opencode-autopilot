export type AutopilotDirectiveStatus = "continue" | "validate" | "complete" | "blocked";

export interface AutopilotDirective {
  status: AutopilotDirectiveStatus;
  reason: string;
}

const AUTOPILOT_MARKER_RE =
  /\n?<autopilot\s+status="(continue|validate|complete|blocked)">([\s\S]*?)<\/autopilot>\s*$/i;
const BLOCKED_HINT_RE =
  /(need (more|additional) information|cannot continue|can't continue|blocked|waiting for user|please provide|which option|what should i|what would you like)/i;

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

export function inferAutopilotDirective(text: string): AutopilotDirective {
  const marker = parseAutopilotMarker(text);

  if (marker) {
    return marker;
  }

  const source = text.trim();
  if (!source) {
    return {
      status: "blocked",
      reason: "Assistant returned no usable response.",
    };
  }

  if (BLOCKED_HINT_RE.test(source)) {
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
