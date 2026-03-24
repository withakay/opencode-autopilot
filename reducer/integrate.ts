import type { BackgroundTask, EventEnvelope, EventType, ExtendedState } from "../types/index.ts";

type IntegratedEvent = {
  [Type in EventType]: EventEnvelope<Type>;
}[EventType];

function mergeUnique(values: readonly string[], additions: readonly string[]): string[] {
  return [...new Set([...values, ...additions])];
}

function appendEvent(
  state: ExtendedState,
  event: EventEnvelope,
): ExtendedState["latest_observations"]["events"] {
  if (state.latest_observations.events.some((item) => item.event_id === event.event_id)) {
    return state.latest_observations.events;
  }

  return [...state.latest_observations.events, event];
}

function clearCompletedForegroundAction(
  state: ExtendedState,
  event: IntegratedEvent,
): ExtendedState["foreground_action"] {
  const action = state.foreground_action;

  if (action === null) {
    return null;
  }

  switch (event.event_type) {
    case "TOOL_RESULT":
    case "TOOL_ERROR":
      if (action.kind === "RUN_TOOL" || action.kind === "COMPACT_CONTEXT") {
        return null;
      }
      return action;
    case "APPROVAL_GRANTED":
    case "APPROVAL_DENIED":
      return action.kind === "REQUEST_APPROVAL" ? null : action;
    case "TRUST_GRANTED":
    case "TRUST_DENIED":
      return action.kind === "REQUEST_TRUST" ? null : action;
    case "BACKGROUND_TASK_UPDATED":
      if (
        action.kind === "WAIT_FOR_BACKGROUND_TASK" &&
        action.metadata.task_id === event.payload.task_id &&
        event.payload.task_status !== "running"
      ) {
        return null;
      }
      return action;
    default:
      return action;
  }
}

function upsertBackgroundTask(
  tasks: readonly BackgroundTask[],
  event: EventEnvelope<"BACKGROUND_TASK_UPDATED">,
): BackgroundTask[] {
  const existingIndex = tasks.findIndex((task) => task.task_id === event.payload.task_id);
  const existingTask = existingIndex >= 0 ? tasks[existingIndex] : null;
  const nextTask: BackgroundTask = {
    task_id: event.payload.task_id,
    status: event.payload.task_status,
    summary: event.payload.summary,
    output_ref: event.payload.output_ref,
    started_at:
      existingTask?.started_at ??
      (event.payload.task_status === "running" ? event.occurred_at : null),
    updated_at: event.occurred_at,
    metadata: {
      ...(existingTask?.metadata ?? {}),
      ...event.payload.metadata,
    },
  };

  if (existingIndex < 0) {
    return [...tasks, nextTask];
  }

  return tasks.map((task, index) => (index === existingIndex ? nextTask : task));
}

function appendEvidence(state: ExtendedState, entry: string | null): string[] {
  if (entry === null || entry.trim() === "") {
    return state.completion_evidence;
  }

  if (state.completion_evidence.includes(entry)) {
    return state.completion_evidence;
  }

  return [...state.completion_evidence, entry];
}

export function integrateEvent(state: ExtendedState, event: IntegratedEvent): ExtendedState {
  if (state.latest_observations.events.some((item) => item.event_id === event.event_id)) {
    return state;
  }

  let nextState: ExtendedState = {
    ...state,
    last_updated_at: event.occurred_at,
    foreground_action: clearCompletedForegroundAction(state, event),
    plan_state: {
      ...state.plan_state,
      stale: true,
    },
    latest_observations: {
      ...state.latest_observations,
      events: appendEvent(state, event),
    },
  };

  switch (event.event_type) {
    case "USER_INPUT": {
      nextState = {
        ...nextState,
        mode: event.payload.requested_mode_change ?? nextState.mode,
        latest_observations: {
          ...nextState.latest_observations,
          last_user_input: event,
        },
      };
      break;
    }

    case "TOOL_RESULT": {
      nextState = {
        ...nextState,
        completion_evidence: appendEvidence(
          nextState,
          `tool:${event.payload.tool_name}:${event.payload.summary}`,
        ),
        latest_observations: {
          ...nextState.latest_observations,
          last_tool_result: event,
        },
      };
      break;
    }

    case "TOOL_ERROR": {
      nextState = {
        ...nextState,
        latest_observations: {
          ...nextState.latest_observations,
          last_tool_error: event,
        },
      };
      break;
    }

    case "APPROVAL_GRANTED": {
      nextState = {
        ...nextState,
        completion_evidence: appendEvidence(nextState, `approval:${event.payload.approved_action}`),
        approval_state: {
          ...nextState.approval_state,
          status: "granted",
          pending_action: null,
          pending_scope: null,
          approved_scopes: mergeUnique(nextState.approval_state.approved_scopes, [
            event.payload.approval_scope,
          ]),
        },
      };
      break;
    }

    case "APPROVAL_DENIED": {
      nextState = {
        ...nextState,
        approval_state: {
          ...nextState.approval_state,
          status: "denied",
          pending_action: null,
          pending_scope: null,
          denied_scopes: mergeUnique(nextState.approval_state.denied_scopes, [
            event.payload.approval_scope,
          ]),
          last_feedback: event.payload.user_feedback,
        },
      };
      break;
    }

    case "TRUST_GRANTED": {
      nextState = {
        ...nextState,
        completion_evidence: appendEvidence(nextState, `trust:${event.payload.trusted_path}`),
        allowed_paths: mergeUnique(nextState.allowed_paths, [event.payload.trusted_path]),
        trust_state: {
          ...nextState.trust_state,
          status: "trusted",
          pending_path: null,
          trusted_paths: mergeUnique(nextState.trust_state.trusted_paths, [
            event.payload.trusted_path,
          ]),
        },
      };
      break;
    }

    case "TRUST_DENIED": {
      nextState = {
        ...nextState,
        trust_state: {
          ...nextState.trust_state,
          status: "denied",
          pending_path: null,
          denied_paths: mergeUnique(nextState.trust_state.denied_paths, [
            event.payload.requested_path,
          ]),
          last_feedback: event.payload.user_feedback,
        },
      };
      break;
    }

    case "BACKGROUND_TASK_UPDATED": {
      nextState = {
        ...nextState,
        completion_evidence:
          event.payload.task_status === "completed"
            ? appendEvidence(
                nextState,
                event.payload.summary === null
                  ? `background:${event.payload.task_id}`
                  : `background:${event.payload.task_id}:${event.payload.summary}`,
              )
            : nextState.completion_evidence,
        background_tasks: upsertBackgroundTask(nextState.background_tasks, event),
      };
      break;
    }

    case "CONTEXT_LOW": {
      const compactionNeeded =
        event.payload.compaction_recommended ||
        event.payload.remaining_budget <= event.payload.threshold;

      nextState = {
        ...nextState,
        context_state: {
          ...nextState.context_state,
          remaining_budget: event.payload.remaining_budget,
          threshold: event.payload.threshold,
          compaction_needed: compactionNeeded,
          unsafe_to_continue: compactionNeeded,
        },
      };
      break;
    }

    case "INTERRUPT": {
      nextState = {
        ...nextState,
        latest_observations: {
          ...nextState.latest_observations,
          last_interrupt: event,
        },
      };
      break;
    }

    case "RESUME_REQUESTED":
    case "TIMER": {
      break;
    }
  }

  return nextState;
}
