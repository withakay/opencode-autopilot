import type {
  Effect,
  EventEnvelope,
  EventType,
  ExtendedState,
  ReducerResult,
} from "../types/index.ts";
import { decide, selectAdmissibleAction } from "./decide.ts";
import { evaluate, meaningfulProgress, noProgressDetected, retryableFailure } from "./evaluate.ts";
import { approvalRequired, compactionAllowed, contextUnsafe, trustRequired } from "./guards.ts";
import { integrateEvent } from "./integrate.ts";
import { observe } from "./observe.ts";
import { completionPredicate, deriveBlockReason, hardBlockDetected, orient } from "./orient.ts";
import {
  alternateStrategyExists,
  backgroundWaitIsBestOption,
  recover,
  recoverable,
  resumable,
  unblockEventPresent,
} from "./recover.ts";
import { blockOrStop, remainStopped, stayBlocked, stop, transition } from "./transitions.ts";

type ReducedEvent = {
  [Type in EventType]: EventEnvelope<Type>;
}[EventType];

/**
 * Generate a deterministic invocation ID from state, ensuring reducer purity.
 * The ID is based on the session, continuation count, and retry counters
 * — all of which change on each reducer step.
 */
function createInvocationID(state: ExtendedState): string {
  const counter =
    state.continuation_count +
    state.retry_counters.global_retry_count +
    state.retry_counters.recovery_attempt_count;
  return `inv-${state.session_id}-${counter}`;
}

function summaryForState(state: ExtendedState): string {
  return `goal=${state.goal}; evidence=${state.completion_evidence.join(" | ")}`;
}

function buildExecutionEffects(state: ExtendedState): Effect[] {
  const action = state.foreground_action;

  if (action === null) {
    return [{ kind: "NO_OP" }];
  }

  const effects: Effect[] = [];

  if (action.risky || action.kind === "COMPACT_CONTEXT") {
    effects.push({
      kind: "PERSIST_SNAPSHOT",
      session_id: state.session_id,
      risky_effect_kind: action.kind,
      metadata: {
        summary: action.summary,
      },
    });
  }

  switch (action.kind) {
    case "REQUEST_APPROVAL":
      effects.push({
        kind: "REQUEST_APPROVAL",
        approval_scope:
          typeof action.metadata.approval_scope === "string"
            ? action.metadata.approval_scope
            : (action.target_path ?? state.goal),
        approved_action: action.summary,
        justification: action.summary,
        metadata: {
          ...action.metadata,
        },
      });
      return effects;
    case "REQUEST_TRUST":
      effects.push({
        kind: "REQUEST_TRUST",
        requested_path:
          typeof action.metadata.requested_path === "string"
            ? action.metadata.requested_path
            : (action.target_path ?? state.allowed_paths[0] ?? state.goal),
        scope: "session",
        justification: action.summary,
        metadata: {
          ...action.metadata,
        },
      });
      return effects;
    case "RUN_TOOL": {
      const targetPaths = Array.isArray(action.metadata.target_paths)
        ? action.metadata.target_paths.filter((value): value is string => typeof value === "string")
        : action.target_path === null
          ? []
          : [action.target_path];

      effects.push({
        kind: "RUN_TOOL",
        tool_name: action.tool_name ?? "bash",
        invocation_id: createInvocationID(state),
        arguments: {
          summary: action.summary,
          target_path: action.target_path,
        },
        target_paths: targetPaths,
        summary: action.summary,
        risky: action.risky,
        metadata: {
          ...action.metadata,
        },
      });
      return effects;
    }
    case "COMPACT_CONTEXT":
      effects.push({
        kind: "COMPACT_CONTEXT",
        reason: action.summary,
        preserve_fields: [
          "goal",
          "plan_state",
          "completion_evidence",
          "retry_counters",
          "stop_reason",
        ],
        metadata: {
          ...action.metadata,
        },
      });
      return effects;
    case "WAIT_FOR_BACKGROUND_TASK":
      effects.push({
        kind: "WAIT_FOR_BACKGROUND_TASK",
        task_id:
          typeof action.metadata.task_id === "string" ? action.metadata.task_id : action.summary,
        timeout_ms: null,
        metadata: {
          ...action.metadata,
        },
      });
      return effects;
    case "EMIT_FINAL_RESPONSE":
      effects.push({
        kind: "EMIT_FINAL_RESPONSE",
        summary: action.summary,
        stop_reason: state.stop_reason,
        metadata: {
          ...action.metadata,
        },
      });
      return effects;
    case "PERSIST_SNAPSHOT":
      effects.push({
        kind: "PERSIST_SNAPSHOT",
        session_id: state.session_id,
        risky_effect_kind: null,
        metadata: {
          ...action.metadata,
        },
      });
      return effects;
  }
}

function deriveTerminalReason(state: ExtendedState): ExtendedState["stop_reason"] {
  if (state.latest_observations.last_interrupt !== null) {
    return "USER_STOP";
  }

  if (state.mode === "DISABLED") {
    return "AUTOPILOT_DISABLED";
  }

  return deriveBlockReason(state);
}

function executeState(state: ExtendedState): ReducerResult {
  return transition(state, "EXECUTE", buildExecutionEffects(state));
}

export function reduce(state: ExtendedState, event: ReducedEvent): ReducerResult {
  const integrated = integrateEvent(state, event);

  if (event.event_type === "INTERRUPT") {
    return stop(integrated, "USER_STOP");
  }

  if (integrated.mode === "DISABLED") {
    return stop(integrated, "AUTOPILOT_DISABLED");
  }

  switch (integrated.phase) {
    case "OBSERVE": {
      return transition(observe(integrated), "ORIENT");
    }

    case "ORIENT": {
      const oriented = orient(integrated);

      if (completionPredicate(oriented)) {
        return stop(oriented, "COMPLETED", [
          {
            kind: "EMIT_FINAL_RESPONSE",
            summary: summaryForState(oriented),
            stop_reason: "COMPLETED",
            metadata: {},
          },
        ]);
      }

      if (hardBlockDetected(oriented)) {
        return blockOrStop(oriented, deriveBlockReason(oriented));
      }

      return transition(oriented, "DECIDE");
    }

    case "DECIDE": {
      const decided = decide(integrated);

      if (
        decided.foreground_action?.kind === "COMPACT_CONTEXT" ||
        decided.foreground_action?.kind === "REQUEST_APPROVAL" ||
        decided.foreground_action?.kind === "REQUEST_TRUST"
      ) {
        return executeState(decided);
      }

      if (contextUnsafe(decided)) {
        if (compactionAllowed(decided)) {
          return executeState(decided);
        }

        return blockOrStop(decided, "CONTEXT_EXHAUSTED");
      }

      if (approvalRequired(decided) || trustRequired(decided)) {
        return executeState(decided);
      }

      const action = selectAdmissibleAction(decided);
      if (action !== null) {
        return executeState({
          ...decided,
          foreground_action: action,
        });
      }

      if (recoverable(decided)) {
        return transition(decided, "RECOVER");
      }

      return blockOrStop(
        decided,
        deriveTerminalReason(decided) ?? "AMBIGUOUS_STATE_REQUIRES_ESCALATION",
      );
    }

    case "EXECUTE": {
      if (integrated.foreground_action?.async === true) {
        return transition(integrated, "OBSERVE");
      }

      return transition(integrated, "EVALUATE");
    }

    case "EVALUATE": {
      const evaluated = evaluate(integrated);

      if (completionPredicate(evaluated)) {
        return stop(evaluated, "COMPLETED", [
          {
            kind: "EMIT_FINAL_RESPONSE",
            summary: summaryForState(evaluated),
            stop_reason: "COMPLETED",
            metadata: {},
          },
        ]);
      }

      if (meaningfulProgress(integrated, evaluated)) {
        return transition(evaluated, "OBSERVE");
      }

      if (retryableFailure(evaluated) || noProgressDetected(evaluated)) {
        return transition(
          {
            ...evaluated,
            retry_counters: {
              ...evaluated.retry_counters,
              recovery_attempt_count: evaluated.retry_counters.recovery_attempt_count + 1,
            },
          },
          "RECOVER",
        );
      }

      return blockOrStop(evaluated, deriveTerminalReason(evaluated) ?? "UNRECOVERABLE_ERROR");
    }

    case "RECOVER": {
      const recovered = recover(integrated);

      if (
        recovered.retry_counters.global_retry_count >= recovered.retry_counters.max_global_retries
      ) {
        return blockOrStop(recovered, "RETRY_EXHAUSTED");
      }

      if (recovered.retry_counters.no_progress_count >= recovered.retry_counters.max_no_progress) {
        return blockOrStop(recovered, "NON_PROGRESS_LIMIT");
      }

      if (alternateStrategyExists(recovered)) {
        return transition(recovered, "DECIDE");
      }

      if (backgroundWaitIsBestOption(recovered)) {
        return transition(recovered, "OBSERVE");
      }

      return blockOrStop(
        recovered,
        deriveTerminalReason(recovered) ?? "AMBIGUOUS_STATE_REQUIRES_ESCALATION",
      );
    }

    case "BLOCKED": {
      if (unblockEventPresent(event, integrated)) {
        return transition(
          {
            ...integrated,
            stop_reason: null,
          },
          "OBSERVE",
        );
      }

      return stayBlocked(integrated);
    }

    case "STOPPED": {
      if (event.event_type === "RESUME_REQUESTED" && resumable(integrated)) {
        return transition(
          {
            ...integrated,
            stop_reason: null,
          },
          "OBSERVE",
        );
      }

      return remainStopped(integrated);
    }
  }
}
