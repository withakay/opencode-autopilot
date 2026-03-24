import { createEvent } from "../events/index.ts";
import { isAdmissible } from "../reducer/guards.ts";
import type {
  AgentPhase,
  CompactContextEffect,
  Effect,
  EmitFinalResponseEffect,
  EventEnvelope,
  EventType,
  ExtendedState,
  PersistSnapshotEffect,
  RequestApprovalEffect,
  RequestTrustEffect,
  RunToolEffect,
  WaitForBackgroundTaskEffect,
} from "../types/index.ts";
import { persistSnapshot } from "./snapshot.ts";

type DispatchedEvent = {
  [Type in EventType]: EventEnvelope<Type>;
}[EventType];

interface ToolExecutionSuccess {
  ok: true;
  summary: string;
  output_ref?: string | null;
  changed_paths?: string[];
  started_at?: string | null;
  completed_at?: string;
  metadata?: Record<string, unknown>;
}

interface ToolExecutionFailure {
  ok: false;
  message: string;
  error_code?: string | null;
  stderr_ref?: string | null;
  retryable_hint?: boolean | null;
  started_at?: string | null;
  completed_at?: string;
  metadata?: Record<string, unknown>;
}

interface ApprovalDecision {
  granted: boolean;
  approved_until?: string | null;
  session_scoped?: boolean;
  user_feedback?: string | null;
  metadata?: Record<string, unknown>;
}

interface TrustDecision {
  granted: boolean;
  scope?: "session" | "persistent";
  user_feedback?: string | null;
  metadata?: Record<string, unknown>;
}

interface CompactionResult {
  remaining_budget: number;
  threshold?: number;
  compaction_recommended: boolean;
  metadata?: Record<string, unknown>;
}

interface BackgroundWaitResult {
  task_status: "running" | "idle" | "completed" | "failed" | "cancelled";
  summary?: string | null;
  output_ref?: string | null;
  metadata?: Record<string, unknown>;
}

interface DispatchHandlers {
  runTool?: (effect: RunToolEffect) => Promise<ToolExecutionSuccess | ToolExecutionFailure>;
  requestApproval?: (effect: RequestApprovalEffect) => Promise<ApprovalDecision>;
  requestTrust?: (effect: RequestTrustEffect) => Promise<TrustDecision>;
  compactContext?: (effect: CompactContextEffect) => Promise<CompactionResult>;
  waitForBackgroundTask?: (
    effect: WaitForBackgroundTaskEffect,
  ) => Promise<BackgroundWaitResult>;
  emitFinalResponse?: (
    effect: EmitFinalResponseEffect,
  ) => Promise<{ summary?: string; metadata?: Record<string, unknown> }>;
  persistSnapshot?: (
    effect: PersistSnapshotEffect,
    state: ExtendedState,
  ) => Promise<{ metadata?: Record<string, unknown> }>;
}

export interface DispatchEffectContext {
  state: ExtendedState;
  phase_at_emit?: AgentPhase | null;
  correlation_id?: string | null;
  causation_id?: string | null;
  handlers?: DispatchHandlers;
}

function now(): string {
  return new Date().toISOString();
}

function toolErrorEvent(
  state: ExtendedState,
  message: string,
  metadata: Record<string, unknown>,
  context: DispatchEffectContext,
): DispatchedEvent {
  return createEvent(
    "TOOL_ERROR",
    {
      tool_name: "autopilot.dispatcher",
      invocation_id: `dispatch-${Date.now()}`,
      status: "error",
      error_code: "INADMISSIBLE_EFFECT",
      message,
      stderr_ref: null,
      retryable_hint: false,
      started_at: null,
      completed_at: now(),
      metadata,
    },
    {
      source: "TOOL_DISPATCHER",
      correlation_id: context.correlation_id ?? null,
      causation_id: context.causation_id ?? null,
      phase_at_emit: context.phase_at_emit ?? state.phase,
    },
  );
}

export async function dispatchEffect(
  effect: Effect,
  context: DispatchEffectContext,
): Promise<DispatchedEvent> {
  if (!isAdmissible(context.state, effect)) {
    return toolErrorEvent(
      context.state,
      `Effect ${effect.kind} rejected by admissibility guard.`,
      { effect_kind: effect.kind },
      context,
    );
  }

  switch (effect.kind) {
    case "NO_OP":
      return createEvent(
        "TIMER",
        {
          timer_name: "autopilot.noop",
          deadline_at: null,
          metadata: {},
        },
        {
          source: "RUNTIME",
          correlation_id: context.correlation_id ?? null,
          causation_id: context.causation_id ?? null,
          phase_at_emit: context.phase_at_emit ?? context.state.phase,
        },
      );
    case "RUN_TOOL": {
      const result =
        (await context.handlers?.runTool?.(effect)) ?? {
          ok: true,
          summary: effect.summary,
          output_ref: null,
          changed_paths: effect.target_paths,
          started_at: null,
          completed_at: now(),
          metadata: effect.metadata,
        };

      if (result.ok) {
        return createEvent(
          "TOOL_RESULT",
          {
            tool_name: effect.tool_name,
            invocation_id: effect.invocation_id,
            status: "success",
            summary: result.summary,
            output_ref: result.output_ref ?? null,
            changed_paths: result.changed_paths ?? effect.target_paths,
            started_at: result.started_at ?? null,
            completed_at: result.completed_at ?? now(),
            metadata: result.metadata ?? effect.metadata,
          },
          {
            source: "TOOL_DISPATCHER",
            correlation_id: context.correlation_id ?? null,
            causation_id: context.causation_id ?? null,
            phase_at_emit: context.phase_at_emit ?? context.state.phase,
          },
        );
      }

      return createEvent(
        "TOOL_ERROR",
        {
          tool_name: effect.tool_name,
          invocation_id: effect.invocation_id,
          status: "error",
          error_code: result.error_code ?? null,
          message: result.message,
          stderr_ref: result.stderr_ref ?? null,
          retryable_hint: result.retryable_hint ?? null,
          started_at: result.started_at ?? null,
          completed_at: result.completed_at ?? now(),
          metadata: result.metadata ?? effect.metadata,
        },
        {
          source: "TOOL_DISPATCHER",
          correlation_id: context.correlation_id ?? null,
          causation_id: context.causation_id ?? null,
          phase_at_emit: context.phase_at_emit ?? context.state.phase,
        },
      );
    }
    case "REQUEST_APPROVAL": {
      const decision =
        (await context.handlers?.requestApproval?.(effect)) ?? {
          granted: true,
          approved_until: null,
          session_scoped: true,
          metadata: effect.metadata,
        };

      return decision.granted
        ? createEvent(
            "APPROVAL_GRANTED",
            {
              approval_scope: effect.approval_scope,
              approved_action: effect.approved_action,
              approved_until: decision.approved_until ?? null,
              session_scoped: decision.session_scoped ?? true,
              metadata: decision.metadata ?? effect.metadata,
            },
            {
              source: "APPROVAL_SYSTEM",
              correlation_id: context.correlation_id ?? null,
              causation_id: context.causation_id ?? null,
              phase_at_emit: context.phase_at_emit ?? context.state.phase,
            },
          )
        : createEvent(
            "APPROVAL_DENIED",
            {
              approval_scope: effect.approval_scope,
              denied_action: effect.approved_action,
              user_feedback: decision.user_feedback ?? null,
              metadata: decision.metadata ?? effect.metadata,
            },
            {
              source: "APPROVAL_SYSTEM",
              correlation_id: context.correlation_id ?? null,
              causation_id: context.causation_id ?? null,
              phase_at_emit: context.phase_at_emit ?? context.state.phase,
            },
          );
    }
    case "REQUEST_TRUST": {
      const decision =
        (await context.handlers?.requestTrust?.(effect)) ?? {
          granted: true,
          scope: effect.scope,
          metadata: effect.metadata,
        };

      return decision.granted
        ? createEvent(
            "TRUST_GRANTED",
            {
              trusted_path: effect.requested_path,
              scope: decision.scope ?? effect.scope,
              metadata: decision.metadata ?? effect.metadata,
            },
            {
              source: "TRUST_SYSTEM",
              correlation_id: context.correlation_id ?? null,
              causation_id: context.causation_id ?? null,
              phase_at_emit: context.phase_at_emit ?? context.state.phase,
            },
          )
        : createEvent(
            "TRUST_DENIED",
            {
              requested_path: effect.requested_path,
              user_feedback: decision.user_feedback ?? null,
              metadata: decision.metadata ?? effect.metadata,
            },
            {
              source: "TRUST_SYSTEM",
              correlation_id: context.correlation_id ?? null,
              causation_id: context.causation_id ?? null,
              phase_at_emit: context.phase_at_emit ?? context.state.phase,
            },
          );
    }
    case "COMPACT_CONTEXT": {
      const result =
        (await context.handlers?.compactContext?.(effect)) ?? {
          remaining_budget: Math.max(context.state.context_state.threshold * 2, 1),
          threshold: context.state.context_state.threshold,
          compaction_recommended: false,
          metadata: effect.metadata,
        };

      return createEvent(
        "CONTEXT_LOW",
        {
          remaining_budget: result.remaining_budget,
          threshold: result.threshold ?? context.state.context_state.threshold,
          compaction_recommended: result.compaction_recommended,
          metadata: result.metadata ?? effect.metadata,
        },
        {
          source: "CONTEXT_MANAGER",
          correlation_id: context.correlation_id ?? null,
          causation_id: context.causation_id ?? null,
          phase_at_emit: context.phase_at_emit ?? context.state.phase,
        },
      );
    }
    case "WAIT_FOR_BACKGROUND_TASK": {
      const result =
        (await context.handlers?.waitForBackgroundTask?.(effect)) ?? {
          task_status: "completed",
          summary: null,
          output_ref: null,
          metadata: effect.metadata,
        };

      return createEvent(
        "BACKGROUND_TASK_UPDATED",
        {
          task_id: effect.task_id,
          task_status: result.task_status,
          summary: result.summary ?? null,
          output_ref: result.output_ref ?? null,
          metadata: result.metadata ?? effect.metadata,
        },
        {
          source: "BACKGROUND_TASK_RUNNER",
          correlation_id: context.correlation_id ?? null,
          causation_id: context.causation_id ?? null,
          phase_at_emit: context.phase_at_emit ?? context.state.phase,
        },
      );
    }
    case "EMIT_FINAL_RESPONSE": {
      const result =
        (await context.handlers?.emitFinalResponse?.(effect)) ?? {
          summary: effect.summary,
          metadata: effect.metadata,
        };

      return createEvent(
        "TOOL_RESULT",
        {
          tool_name: "autopilot.final_response",
          invocation_id: `final-${Date.now()}`,
          status: "success",
          summary: result.summary ?? effect.summary,
          output_ref: null,
          changed_paths: [],
          started_at: null,
          completed_at: now(),
          metadata: result.metadata ?? effect.metadata,
        },
        {
          source: "RUNTIME",
          correlation_id: context.correlation_id ?? null,
          causation_id: context.causation_id ?? null,
          phase_at_emit: context.phase_at_emit ?? context.state.phase,
        },
      );
    }
    case "PERSIST_SNAPSHOT": {
      persistSnapshot(context.state);
      const result =
        (await context.handlers?.persistSnapshot?.(effect, context.state)) ?? {
          metadata: effect.metadata,
        };

      return createEvent(
        "TOOL_RESULT",
        {
          tool_name: "autopilot.snapshot",
          invocation_id: `snapshot-${Date.now()}`,
          status: "success",
          summary: `Persisted snapshot for ${effect.session_id}`,
          output_ref: null,
          changed_paths: [],
          started_at: null,
          completed_at: now(),
          metadata: result.metadata ?? effect.metadata,
        },
        {
          source: "RUNTIME",
          correlation_id: context.correlation_id ?? null,
          causation_id: context.causation_id ?? null,
          phase_at_emit: context.phase_at_emit ?? context.state.phase,
        },
      );
    }
  }
}
