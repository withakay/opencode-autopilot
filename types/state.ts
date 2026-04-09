import type { EventEnvelope } from "./event.ts";
import type { AgentMode } from "./mode.ts";
import type { AgentPhase } from "./phase.ts";
import type { StopReason } from "./stop-reason.ts";

export interface PlanItem {
  id: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "blocked" | "skipped";
  required: boolean;
  dependencies: string[];
  evidence: string[];
  metadata: Record<string, unknown>;
}

export interface PlanState {
  steps: PlanItem[];
  open_items: string[];
  completed_items: string[];
  blocked_items: string[];
  dependencies: Record<string, string[]>;
  stale: boolean;
}

export interface RetryCounters {
  step_retry_count: number;
  global_retry_count: number;
  no_progress_count: number;
  recovery_attempt_count: number;
  max_step_retries: number;
  max_global_retries: number;
  max_no_progress: number;
}

export interface ContextState {
  remaining_budget: number | null;
  threshold: number;
  compaction_needed: boolean;
  compacted_at: string | null;
  unsafe_to_continue: boolean;
}

export interface ApprovalState {
  status: "idle" | "pending" | "granted" | "denied";
  pending_action: string | null;
  pending_scope: string | null;
  approved_scopes: string[];
  denied_scopes: string[];
  last_feedback: string | null;
}

export interface TrustState {
  status: "trusted" | "untrusted" | "pending" | "denied";
  trusted_paths: string[];
  pending_path: string | null;
  denied_paths: string[];
  last_feedback: string | null;
}

export interface BackgroundTask {
  task_id: string;
  status: "running" | "idle" | "completed" | "failed" | "cancelled";
  summary: string | null;
  output_ref: string | null;
  started_at: string | null;
  updated_at: string | null;
  metadata: Record<string, unknown>;
}

export interface ForegroundAction {
  kind:
    | "REQUEST_APPROVAL"
    | "REQUEST_TRUST"
    | "RUN_TOOL"
    | "COMPACT_CONTEXT"
    | "WAIT_FOR_BACKGROUND_TASK"
    | "EMIT_FINAL_RESPONSE"
    | "PERSIST_SNAPSHOT";
  tool_name: string | null;
  target_path: string | null;
  summary: string;
  risky: boolean;
  async: boolean;
  metadata: Record<string, unknown>;
}

export interface LatestObservations {
  events: EventEnvelope[];
  last_user_input: EventEnvelope<"USER_INPUT"> | null;
  last_tool_result: EventEnvelope<"TOOL_RESULT"> | null;
  last_tool_error: EventEnvelope<"TOOL_ERROR"> | null;
  last_interrupt: EventEnvelope<"INTERRUPT"> | null;
}

export type AutonomousStrength = "conservative" | "balanced" | "aggressive";

export interface ExtendedState {
  session_id: string;
  mode: AgentMode;
  phase: AgentPhase;
  session_mode: "session-defaults" | "delegated-task";
  goal: string;
  plan_state: PlanState;
  completion_evidence: string[];
  allowed_tools: string[];
  allowed_paths: string[];
  approval_state: ApprovalState;
  trust_state: TrustState;
  context_state: ContextState;
  foreground_action: ForegroundAction | null;
  background_tasks: BackgroundTask[];
  retry_counters: RetryCounters;
  stop_reason: StopReason | null;
  latest_observations: LatestObservations;
  continuation_count: number;
  max_continues: number;
  worker_agent: string;
  autonomous_strength: AutonomousStrength;
  last_updated_at: string | null;
  resumable: boolean;
}
