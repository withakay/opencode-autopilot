import type {
  AgentPhase,
  Effect,
  ExtendedState,
  ReducerResult,
  StopReason,
} from "../types/index.ts";

const DEFAULT_BLOCKED_REASON: StopReason = "AMBIGUOUS_STATE_REQUIRES_ESCALATION";

const DEFAULT_STOPPED_REASON: StopReason = "USER_STOP";

const BLOCKED_REASONS = new Set<StopReason>([
  "WAITING_FOR_APPROVAL",
  "WAITING_FOR_DIRECTORY_TRUST",
  "WAITING_FOR_USER_INPUT",
  "WAITING_FOR_EXTERNAL_RESOURCE",
  "PERMISSION_DENIED",
  "POLICY_BLOCKED",
  "PATH_OR_TOOL_NOT_ALLOWED",
  "CONTEXT_EXHAUSTED",
  "AMBIGUOUS_STATE_REQUIRES_ESCALATION",
]);

function copyEffects(effects: readonly Effect[]): Effect[] {
  return [...effects];
}

function clearStopReasonForPhase(
  phase: AgentPhase,
  stopReason: StopReason | null,
): StopReason | null {
  if (phase === "BLOCKED" || phase === "STOPPED") {
    return stopReason;
  }

  return null;
}

export function isBlockedReason(reason: StopReason): boolean {
  return BLOCKED_REASONS.has(reason);
}

export function transition(
  state: ExtendedState,
  phase: AgentPhase,
  effects: readonly Effect[] = [],
): ReducerResult {
  return {
    nextState: {
      ...state,
      phase,
      stop_reason: clearStopReasonForPhase(phase, state.stop_reason),
    },
    effects: copyEffects(effects),
  };
}

export function stop(
  state: ExtendedState,
  reason: StopReason,
  effects: readonly Effect[] = [],
): ReducerResult {
  return {
    nextState: {
      ...state,
      phase: "STOPPED",
      foreground_action: null,
      stop_reason: reason,
    },
    effects: copyEffects(effects),
  };
}

export function block(
  state: ExtendedState,
  reason: StopReason,
  effects: readonly Effect[] = [],
): ReducerResult {
  return {
    nextState: {
      ...state,
      phase: "BLOCKED",
      foreground_action: null,
      stop_reason: reason,
    },
    effects: copyEffects(effects),
  };
}

export function blockOrStop(
  state: ExtendedState,
  reason: StopReason,
  effects: readonly Effect[] = [],
): ReducerResult {
  if (isBlockedReason(reason)) {
    return block(state, reason, effects);
  }

  return stop(state, reason, effects);
}

export function stayBlocked(state: ExtendedState, effects: readonly Effect[] = []): ReducerResult {
  return {
    nextState: {
      ...state,
      phase: "BLOCKED",
      foreground_action: null,
      stop_reason: state.stop_reason ?? DEFAULT_BLOCKED_REASON,
    },
    effects: copyEffects(effects),
  };
}

export function remainStopped(
  state: ExtendedState,
  effects: readonly Effect[] = [],
): ReducerResult {
  return {
    nextState: {
      ...state,
      phase: "STOPPED",
      foreground_action: null,
      stop_reason: state.stop_reason ?? DEFAULT_STOPPED_REASON,
    },
    effects: copyEffects(effects),
  };
}
