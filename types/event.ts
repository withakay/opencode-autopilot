import type { AgentMode } from "./mode.ts";
import type { AgentPhase } from "./phase.ts";

export type EventType =
  | "USER_INPUT"
  | "TOOL_RESULT"
  | "TOOL_ERROR"
  | "APPROVAL_GRANTED"
  | "APPROVAL_DENIED"
  | "TRUST_GRANTED"
  | "TRUST_DENIED"
  | "BACKGROUND_TASK_UPDATED"
  | "CONTEXT_LOW"
  | "INTERRUPT"
  | "RESUME_REQUESTED"
  | "TIMER";

export type EventSource =
  | "USER"
  | "TOOL_DISPATCHER"
  | "APPROVAL_SYSTEM"
  | "TRUST_SYSTEM"
  | "BACKGROUND_TASK_RUNNER"
  | "CONTEXT_MANAGER"
  | "SESSION_MANAGER"
  | "RUNTIME";

export type Timestamp = string;

export type EventMetadata = Record<string, unknown>;

export interface Attachment {
  name: string;
  mimeType: string | null;
  uri: string | null;
  metadata: EventMetadata;
}

export interface UserInputPayload {
  message: string;
  attachments: Attachment[];
  requested_mode_change: AgentMode | null;
  referenced_paths: string[];
  metadata: EventMetadata;
}

export interface ToolResultPayload {
  tool_name: string;
  invocation_id: string;
  status: "success";
  summary: string;
  output_ref: string | null;
  changed_paths: string[];
  started_at: Timestamp | null;
  completed_at: Timestamp;
  metadata: EventMetadata;
}

export interface ToolErrorPayload {
  tool_name: string;
  invocation_id: string;
  status: "error";
  error_code: string | null;
  message: string;
  stderr_ref: string | null;
  retryable_hint: boolean | null;
  started_at: Timestamp | null;
  completed_at: Timestamp;
  metadata: EventMetadata;
}

export interface ApprovalGrantedPayload {
  approval_scope: string;
  approved_action: string;
  approved_until: Timestamp | null;
  session_scoped: boolean;
  metadata: EventMetadata;
}

export interface ApprovalDeniedPayload {
  approval_scope: string;
  denied_action: string;
  user_feedback: string | null;
  metadata: EventMetadata;
}

export interface TrustGrantedPayload {
  trusted_path: string;
  scope: "session" | "persistent";
  metadata: EventMetadata;
}

export interface TrustDeniedPayload {
  requested_path: string;
  user_feedback: string | null;
  metadata: EventMetadata;
}

export interface BackgroundTaskUpdatedPayload {
  task_id: string;
  task_status: "running" | "idle" | "completed" | "failed" | "cancelled";
  summary: string | null;
  output_ref: string | null;
  metadata: EventMetadata;
}

export interface ContextLowPayload {
  remaining_budget: number;
  threshold: number;
  compaction_recommended: boolean;
  metadata: EventMetadata;
}

export interface InterruptPayload {
  interrupt_type: "user_cancel" | "session_shutdown" | "runtime_abort";
  message: string | null;
  metadata: EventMetadata;
}

export interface ResumeRequestedPayload {
  resume_token: string | null;
  source_session_id: string | null;
  metadata: EventMetadata;
}

export interface TimerPayload {
  timer_name: string;
  deadline_at: Timestamp | null;
  metadata: EventMetadata;
}

export interface EventPayloadMap {
  USER_INPUT: UserInputPayload;
  TOOL_RESULT: ToolResultPayload;
  TOOL_ERROR: ToolErrorPayload;
  APPROVAL_GRANTED: ApprovalGrantedPayload;
  APPROVAL_DENIED: ApprovalDeniedPayload;
  TRUST_GRANTED: TrustGrantedPayload;
  TRUST_DENIED: TrustDeniedPayload;
  BACKGROUND_TASK_UPDATED: BackgroundTaskUpdatedPayload;
  CONTEXT_LOW: ContextLowPayload;
  INTERRUPT: InterruptPayload;
  RESUME_REQUESTED: ResumeRequestedPayload;
  TIMER: TimerPayload;
}

export type EventEnvelope<TType extends EventType = EventType> = {
  event_id: string;
  event_type: TType;
  occurred_at: Timestamp;
  source: EventSource;
  correlation_id: string | null;
  causation_id: string | null;
  phase_at_emit: AgentPhase | null;
  payload: EventPayloadMap[TType];
};
