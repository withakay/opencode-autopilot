import type { EventEnvelope, EventType, ExtendedState } from "../types/index.ts";

type RecoveryEvent = {
  [Type in EventType]: EventEnvelope<Type>;
}[EventType];

export function alternateStrategyExists(state: ExtendedState): boolean {
  const currentTool = state.foreground_action?.tool_name;

  if (state.plan_state.steps.some((step) => step.status === "pending" || step.status === "in_progress")) {
    return true;
  }

  if (currentTool === "bash") {
    return state.allowed_tools.includes("read") || state.allowed_tools.includes("glob");
  }

  if (state.latest_observations.last_tool_error !== null) {
    return state.allowed_tools.some((tool) => tool !== currentTool);
  }

  return false;
}

export function backgroundWaitIsBestOption(state: ExtendedState): boolean {
  return state.background_tasks.some((task) => task.status === "running");
}

export function recoverable(state: ExtendedState): boolean {
  if (state.latest_observations.last_interrupt !== null) {
    return false;
  }

  if (state.retry_counters.global_retry_count >= state.retry_counters.max_global_retries) {
    return false;
  }

  if (state.retry_counters.no_progress_count >= state.retry_counters.max_no_progress) {
    return false;
  }

  if (state.approval_state.status === "denied" || state.trust_state.status === "denied") {
    return false;
  }

  return alternateStrategyExists(state) || backgroundWaitIsBestOption(state);
}

export function unblockEventPresent(
  event: RecoveryEvent,
  state: ExtendedState,
): boolean {
  switch (event.event_type) {
    case "APPROVAL_GRANTED":
      return (
        state.stop_reason === "WAITING_FOR_APPROVAL" ||
        state.stop_reason === "PERMISSION_DENIED"
      );
    case "TRUST_GRANTED":
      return (
        state.stop_reason === "WAITING_FOR_DIRECTORY_TRUST" ||
        state.stop_reason === "PATH_OR_TOOL_NOT_ALLOWED"
      );
    case "BACKGROUND_TASK_UPDATED":
      return (
        state.stop_reason === "WAITING_FOR_EXTERNAL_RESOURCE" &&
        event.payload.task_status !== "running"
      );
    case "USER_INPUT":
      return state.stop_reason === "WAITING_FOR_USER_INPUT";
    case "RESUME_REQUESTED":
      return state.resumable;
    default:
      return false;
  }
}

export function resumable(state: ExtendedState): boolean {
  if (!state.resumable) {
    return false;
  }

  if (state.mode !== "ENABLED") {
    return false;
  }

  return state.goal.trim() !== "";
}

export function recover(state: ExtendedState): ExtendedState {
  if (!recoverable(state)) {
    return {
      ...state,
      foreground_action: null,
    };
  }

  if (backgroundWaitIsBestOption(state)) {
    const runningTask = state.background_tasks.find((task) => task.status === "running") ?? null;

    return {
      ...state,
      foreground_action:
        runningTask === null
          ? null
          : {
              kind: "WAIT_FOR_BACKGROUND_TASK",
              tool_name: null,
              target_path: null,
              summary: runningTask.summary ?? `Wait for ${runningTask.task_id}`,
              risky: false,
              async: true,
              metadata: {
                task_id: runningTask.task_id,
              },
            },
      retry_counters: {
        ...state.retry_counters,
        recovery_attempt_count: state.retry_counters.recovery_attempt_count + 1,
      },
      stop_reason: "WAITING_FOR_EXTERNAL_RESOURCE",
    };
  }

  const nextTool =
    state.foreground_action?.tool_name === "bash" && state.allowed_tools.includes("read")
      ? "read"
      : state.allowed_tools.find((tool) => tool !== state.foreground_action?.tool_name) ?? null;

  return {
    ...state,
    foreground_action:
      nextTool === null
        ? null
        : {
            kind: "RUN_TOOL",
            tool_name: nextTool,
            target_path: state.foreground_action?.target_path ?? state.allowed_paths[0] ?? null,
            summary:
              state.foreground_action === null
                ? `Recover using ${nextTool}`
                : `Recover from ${state.foreground_action.summary} with ${nextTool}`,
            risky: nextTool === "bash",
            async: false,
            metadata: {
              recovered_from: state.foreground_action?.summary ?? null,
            },
          },
    retry_counters: {
      ...state.retry_counters,
      recovery_attempt_count: state.retry_counters.recovery_attempt_count + 1,
    },
    stop_reason: null,
  };
}
