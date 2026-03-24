import type {
  BackgroundTask,
  EventEnvelope,
  EventType,
  ExtendedState,
} from "../types/index.ts";

type ObservedEvent = {
  [Type in EventType]: EventEnvelope<Type>;
}[EventType];

function getLatestTask(
  state: ExtendedState,
  taskID: string,
): BackgroundTask | null {
  return state.background_tasks.find((task) => task.task_id === taskID) ?? null;
}

function shouldClearStopReason(state: ExtendedState): boolean {
  const latestEvent = (state.latest_observations.events.at(-1) ?? null) as ObservedEvent | null;

  if (!latestEvent) {
    return false;
  }

  switch (latestEvent.event_type) {
    case "USER_INPUT":
      return state.stop_reason === "WAITING_FOR_USER_INPUT";
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
        latestEvent.payload.task_status !== "running"
      );
    default:
      return false;
  }
}

export function observe(state: ExtendedState): ExtendedState {
  const latestEvent = (state.latest_observations.events.at(-1) ?? null) as ObservedEvent | null;
  const latestBackgroundTaskEvent =
    latestEvent?.event_type === "BACKGROUND_TASK_UPDATED" ? latestEvent : null;
  let nextState: ExtendedState = {
    ...state,
    plan_state: {
      ...state.plan_state,
      stale: false,
    },
    stop_reason: shouldClearStopReason(state) ? null : state.stop_reason,
  };

  const action = nextState.foreground_action;

  if (action?.kind === "REQUEST_APPROVAL") {
    const pendingScope =
      typeof action.metadata.approval_scope === "string"
        ? action.metadata.approval_scope
        : action.summary;

    nextState = {
      ...nextState,
      approval_state: {
        ...nextState.approval_state,
        status: nextState.approval_state.status === "granted" ? "granted" : "pending",
        pending_action: action.summary,
        pending_scope: pendingScope,
      },
    };
  }

  if (action?.kind === "REQUEST_TRUST") {
    const pendingPath = action.target_path;

    nextState = {
      ...nextState,
      trust_state: {
        ...nextState.trust_state,
        status: nextState.trust_state.status === "trusted" ? "trusted" : "pending",
        pending_path: pendingPath,
      },
    };
  }

  if (action?.kind === "WAIT_FOR_BACKGROUND_TASK") {
    const taskID =
      typeof action.metadata.task_id === "string"
        ? action.metadata.task_id
        : null;
    const trackedTask = taskID === null ? null : getLatestTask(nextState, taskID);

    if (trackedTask === null || trackedTask.status === "running") {
      nextState = {
        ...nextState,
        stop_reason:
          nextState.stop_reason === null
            ? "WAITING_FOR_EXTERNAL_RESOURCE"
            : nextState.stop_reason,
      };
    }
  }

  if (latestBackgroundTaskEvent !== null) {
    if (
      nextState.stop_reason === "WAITING_FOR_EXTERNAL_RESOURCE" &&
      latestBackgroundTaskEvent.payload.task_status !== "running"
    ) {
      nextState = {
        ...nextState,
        stop_reason: null,
      };
    }
  }

  if (latestEvent?.event_type === "TOOL_RESULT") {
    nextState = {
      ...nextState,
      retry_counters: {
        ...nextState.retry_counters,
        step_retry_count: 0,
      },
    };
  }

  return nextState;
}
