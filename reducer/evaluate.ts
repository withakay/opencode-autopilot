import type { ExtendedState } from "../types/index.ts";

function evidenceCount(state: ExtendedState): number {
  return state.completion_evidence.length;
}

export function meaningfulProgress(
  previousState: ExtendedState,
  nextState: ExtendedState,
): boolean {
  if (evidenceCount(nextState) > evidenceCount(previousState)) {
    return true;
  }

  if (
    previousState.plan_state.completed_items.length < nextState.plan_state.completed_items.length
  ) {
    return true;
  }

  if (previousState.background_tasks.length < nextState.background_tasks.length) {
    return true;
  }

  return previousState.stop_reason !== nextState.stop_reason && nextState.stop_reason === null;
}

export function retryableFailure(state: ExtendedState): boolean {
  const lastToolError = state.latest_observations.last_tool_error;

  if (lastToolError === null) {
    return false;
  }

  if (lastToolError.payload.retryable_hint === true) {
    return true;
  }

  return state.retry_counters.step_retry_count < state.retry_counters.max_step_retries;
}

export function noProgressDetected(state: ExtendedState): boolean {
  return state.retry_counters.no_progress_count >= state.retry_counters.max_no_progress;
}

export function evaluate(state: ExtendedState): ExtendedState {
  const lastToolResult = state.latest_observations.last_tool_result;
  const lastToolError = state.latest_observations.last_tool_error;
  const hasProgress =
    lastToolResult !== null ||
    state.plan_state.completed_items.length > 0 ||
    state.background_tasks.some((task) => task.status === "completed");

  if (lastToolResult !== null) {
    return {
      ...state,
      foreground_action: null,
      retry_counters: {
        ...state.retry_counters,
        step_retry_count: 0,
        no_progress_count: 0,
      },
      stop_reason: null,
    };
  }

  if (lastToolError !== null) {
    return {
      ...state,
      foreground_action: null,
      retry_counters: {
        ...state.retry_counters,
        step_retry_count: state.retry_counters.step_retry_count + 1,
        global_retry_count: state.retry_counters.global_retry_count + 1,
        no_progress_count: state.retry_counters.no_progress_count + 1,
      },
      stop_reason: "UNRECOVERABLE_ERROR",
    };
  }

  if (hasProgress) {
    return {
      ...state,
      retry_counters: {
        ...state.retry_counters,
        no_progress_count: 0,
      },
      stop_reason: null,
    };
  }

  return {
    ...state,
    retry_counters: {
      ...state.retry_counters,
      no_progress_count: state.retry_counters.no_progress_count + 1,
    },
  };
}
