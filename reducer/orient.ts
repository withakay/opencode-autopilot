import type { ExtendedState, StopReason } from "../types/index.ts";
import { contextUnsafe } from "./guards.ts";

function requiredOpenItemsRemain(state: ExtendedState): boolean {
  return state.plan_state.steps.some(
    (step) => step.required && step.status !== "completed" && step.status !== "skipped",
  );
}

function requiredBlockedItemsRemain(state: ExtendedState): boolean {
  return state.plan_state.steps.some(
    (step) => step.required && step.status === "blocked",
  );
}

function inferPlanProgress(state: ExtendedState): ExtendedState["plan_state"] {
  const completed = state.plan_state.steps
    .filter((step) => step.status === "completed")
    .map((step) => step.id);
  const blocked = state.plan_state.steps
    .filter((step) => step.status === "blocked")
    .map((step) => step.id);
  const open = state.plan_state.steps
    .filter((step) => step.status !== "completed" && step.status !== "skipped")
    .map((step) => step.id);

  return {
    ...state.plan_state,
    completed_items: completed,
    blocked_items: blocked,
    open_items: open,
    stale: false,
  };
}

export function completionPredicate(state: ExtendedState): boolean {
  if (state.goal.trim() === "") {
    return false;
  }

  if (state.foreground_action !== null) {
    return false;
  }

  if (requiredOpenItemsRemain(state)) {
    return false;
  }

  if (requiredBlockedItemsRemain(state)) {
    return false;
  }

  if (
    state.stop_reason === "WAITING_FOR_APPROVAL" ||
    state.stop_reason === "WAITING_FOR_DIRECTORY_TRUST" ||
    state.stop_reason === "WAITING_FOR_EXTERNAL_RESOURCE" ||
    state.stop_reason === "WAITING_FOR_USER_INPUT"
  ) {
    return false;
  }

  return state.completion_evidence.length > 0;
}

export function deriveBlockReason(state: ExtendedState): StopReason {
  if (state.latest_observations.last_interrupt !== null) {
    return "USER_STOP";
  }

  if (state.approval_state.status === "denied") {
    return "PERMISSION_DENIED";
  }

  if (state.approval_state.status === "pending") {
    return "WAITING_FOR_APPROVAL";
  }

  if (state.trust_state.status === "denied") {
    return "PATH_OR_TOOL_NOT_ALLOWED";
  }

  if (state.trust_state.status === "pending") {
    return "WAITING_FOR_DIRECTORY_TRUST";
  }

  if (contextUnsafe(state)) {
    return "CONTEXT_EXHAUSTED";
  }

  if (state.retry_counters.no_progress_count >= state.retry_counters.max_no_progress) {
    return "NON_PROGRESS_LIMIT";
  }

  if (state.retry_counters.global_retry_count >= state.retry_counters.max_global_retries) {
    return "RETRY_EXHAUSTED";
  }

  if (state.foreground_action?.kind === "WAIT_FOR_BACKGROUND_TASK") {
    return "WAITING_FOR_EXTERNAL_RESOURCE";
  }

  if (requiredBlockedItemsRemain(state)) {
    return "AMBIGUOUS_STATE_REQUIRES_ESCALATION";
  }

  if (state.latest_observations.last_tool_error !== null) {
    return "UNRECOVERABLE_ERROR";
  }

  return state.stop_reason ?? "AMBIGUOUS_STATE_REQUIRES_ESCALATION";
}

export function hardBlockDetected(state: ExtendedState): boolean {
  if (state.latest_observations.last_interrupt !== null) {
    return true;
  }

  if (state.approval_state.status === "pending" || state.approval_state.status === "denied") {
    return true;
  }

  if (state.trust_state.status === "pending" || state.trust_state.status === "denied") {
    return true;
  }

  if (contextUnsafe(state) && !state.resumable) {
    return true;
  }

  if (state.foreground_action?.kind === "WAIT_FOR_BACKGROUND_TASK") {
    return true;
  }

  if (state.retry_counters.no_progress_count >= state.retry_counters.max_no_progress) {
    return true;
  }

  if (state.retry_counters.global_retry_count >= state.retry_counters.max_global_retries) {
    return true;
  }

  return requiredBlockedItemsRemain(state);
}

export function orient(state: ExtendedState): ExtendedState {
  const plan_state = inferPlanProgress(state);
  const latestToolResult = state.latest_observations.last_tool_result;
  const latestToolError = state.latest_observations.last_tool_error;
  const lastEvidence = latestToolResult?.payload.summary ?? null;

  return {
    ...state,
    plan_state,
    completion_evidence:
      lastEvidence !== null && !state.completion_evidence.includes(lastEvidence)
        ? [...state.completion_evidence, lastEvidence]
        : state.completion_evidence,
    stop_reason:
      latestToolError !== null && state.stop_reason === null
        ? "UNRECOVERABLE_ERROR"
        : state.stop_reason,
  };
}
