import { tool } from "@opencode-ai/plugin";

const z = tool.schema;

const timestampSchema = z.string().datetime({ offset: true });
const metadataSchema = z.record(z.string(), z.unknown());

export const attachmentSchema = z.object({
  name: z.string(),
  mimeType: z.string().nullable(),
  uri: z.string().nullable(),
  metadata: metadataSchema,
});

export const userInputPayloadSchema = z.object({
  message: z.string(),
  attachments: z.array(attachmentSchema),
  requested_mode_change: z.enum(["DISABLED", "ENABLED"]).nullable(),
  referenced_paths: z.array(z.string()),
  metadata: metadataSchema,
});

export const toolResultPayloadSchema = z.object({
  tool_name: z.string(),
  invocation_id: z.string().min(1),
  status: z.literal("success"),
  summary: z.string(),
  output_ref: z.string().nullable(),
  changed_paths: z.array(z.string()),
  started_at: timestampSchema.nullable(),
  completed_at: timestampSchema,
  metadata: metadataSchema,
});

export const toolErrorPayloadSchema = z.object({
  tool_name: z.string(),
  invocation_id: z.string().min(1),
  status: z.literal("error"),
  error_code: z.string().nullable(),
  message: z.string(),
  stderr_ref: z.string().nullable(),
  retryable_hint: z.boolean().nullable(),
  started_at: timestampSchema.nullable(),
  completed_at: timestampSchema,
  metadata: metadataSchema,
});

export const approvalGrantedPayloadSchema = z.object({
  approval_scope: z.string(),
  approved_action: z.string(),
  approved_until: timestampSchema.nullable(),
  session_scoped: z.boolean(),
  metadata: metadataSchema,
});

export const approvalDeniedPayloadSchema = z.object({
  approval_scope: z.string(),
  denied_action: z.string(),
  user_feedback: z.string().nullable(),
  metadata: metadataSchema,
});

export const trustGrantedPayloadSchema = z.object({
  trusted_path: z.string(),
  scope: z.enum(["session", "persistent"]),
  metadata: metadataSchema,
});

export const trustDeniedPayloadSchema = z.object({
  requested_path: z.string(),
  user_feedback: z.string().nullable(),
  metadata: metadataSchema,
});

export const backgroundTaskUpdatedPayloadSchema = z.object({
  task_id: z.string().min(1),
  task_status: z.enum(["running", "idle", "completed", "failed", "cancelled"]),
  summary: z.string().nullable(),
  output_ref: z.string().nullable(),
  metadata: metadataSchema,
});

export const contextLowPayloadSchema = z.object({
  remaining_budget: z.number().int(),
  threshold: z.number().int(),
  compaction_recommended: z.boolean(),
  metadata: metadataSchema,
});

export const interruptPayloadSchema = z.object({
  interrupt_type: z.enum(["user_cancel", "session_shutdown", "runtime_abort"]),
  message: z.string().nullable(),
  metadata: metadataSchema,
});

export const resumeRequestedPayloadSchema = z.object({
  resume_token: z.string().nullable(),
  source_session_id: z.string().nullable(),
  metadata: metadataSchema,
});

export const timerPayloadSchema = z.object({
  timer_name: z.string(),
  deadline_at: timestampSchema.nullable(),
  metadata: metadataSchema,
});

export const eventTypeSchema = z.enum([
  "USER_INPUT",
  "TOOL_RESULT",
  "TOOL_ERROR",
  "APPROVAL_GRANTED",
  "APPROVAL_DENIED",
  "TRUST_GRANTED",
  "TRUST_DENIED",
  "BACKGROUND_TASK_UPDATED",
  "CONTEXT_LOW",
  "INTERRUPT",
  "RESUME_REQUESTED",
  "TIMER",
]);

export const eventSourceSchema = z.enum([
  "USER",
  "TOOL_DISPATCHER",
  "APPROVAL_SYSTEM",
  "TRUST_SYSTEM",
  "BACKGROUND_TASK_RUNNER",
  "CONTEXT_MANAGER",
  "SESSION_MANAGER",
  "RUNTIME",
]);

export const agentPhaseSchema = z.enum([
  "OBSERVE",
  "ORIENT",
  "DECIDE",
  "EXECUTE",
  "EVALUATE",
  "RECOVER",
  "BLOCKED",
  "STOPPED",
]);

const eventEnvelopeBaseSchema = {
  event_id: z.string().min(1),
  occurred_at: timestampSchema,
  source: eventSourceSchema,
  correlation_id: z.string().nullable(),
  causation_id: z.string().nullable(),
  phase_at_emit: agentPhaseSchema.nullable(),
};

export const eventPayloadSchemas = {
  USER_INPUT: userInputPayloadSchema,
  TOOL_RESULT: toolResultPayloadSchema,
  TOOL_ERROR: toolErrorPayloadSchema,
  APPROVAL_GRANTED: approvalGrantedPayloadSchema,
  APPROVAL_DENIED: approvalDeniedPayloadSchema,
  TRUST_GRANTED: trustGrantedPayloadSchema,
  TRUST_DENIED: trustDeniedPayloadSchema,
  BACKGROUND_TASK_UPDATED: backgroundTaskUpdatedPayloadSchema,
  CONTEXT_LOW: contextLowPayloadSchema,
  INTERRUPT: interruptPayloadSchema,
  RESUME_REQUESTED: resumeRequestedPayloadSchema,
  TIMER: timerPayloadSchema,
} as const;

export const userInputEventSchema = z.object({
  ...eventEnvelopeBaseSchema,
  event_type: z.literal("USER_INPUT"),
  payload: userInputPayloadSchema,
});

export const toolResultEventSchema = z.object({
  ...eventEnvelopeBaseSchema,
  event_type: z.literal("TOOL_RESULT"),
  payload: toolResultPayloadSchema,
});

export const toolErrorEventSchema = z.object({
  ...eventEnvelopeBaseSchema,
  event_type: z.literal("TOOL_ERROR"),
  payload: toolErrorPayloadSchema,
});

export const approvalGrantedEventSchema = z.object({
  ...eventEnvelopeBaseSchema,
  event_type: z.literal("APPROVAL_GRANTED"),
  payload: approvalGrantedPayloadSchema,
});

export const approvalDeniedEventSchema = z.object({
  ...eventEnvelopeBaseSchema,
  event_type: z.literal("APPROVAL_DENIED"),
  payload: approvalDeniedPayloadSchema,
});

export const trustGrantedEventSchema = z.object({
  ...eventEnvelopeBaseSchema,
  event_type: z.literal("TRUST_GRANTED"),
  payload: trustGrantedPayloadSchema,
});

export const trustDeniedEventSchema = z.object({
  ...eventEnvelopeBaseSchema,
  event_type: z.literal("TRUST_DENIED"),
  payload: trustDeniedPayloadSchema,
});

export const backgroundTaskUpdatedEventSchema = z.object({
  ...eventEnvelopeBaseSchema,
  event_type: z.literal("BACKGROUND_TASK_UPDATED"),
  payload: backgroundTaskUpdatedPayloadSchema,
});

export const contextLowEventSchema = z.object({
  ...eventEnvelopeBaseSchema,
  event_type: z.literal("CONTEXT_LOW"),
  payload: contextLowPayloadSchema,
});

export const interruptEventSchema = z.object({
  ...eventEnvelopeBaseSchema,
  event_type: z.literal("INTERRUPT"),
  payload: interruptPayloadSchema,
});

export const resumeRequestedEventSchema = z.object({
  ...eventEnvelopeBaseSchema,
  event_type: z.literal("RESUME_REQUESTED"),
  payload: resumeRequestedPayloadSchema,
});

export const timerEventSchema = z.object({
  ...eventEnvelopeBaseSchema,
  event_type: z.literal("TIMER"),
  payload: timerPayloadSchema,
});

export const eventEnvelopeSchema = z.discriminatedUnion("event_type", [
  userInputEventSchema,
  toolResultEventSchema,
  toolErrorEventSchema,
  approvalGrantedEventSchema,
  approvalDeniedEventSchema,
  trustGrantedEventSchema,
  trustDeniedEventSchema,
  backgroundTaskUpdatedEventSchema,
  contextLowEventSchema,
  interruptEventSchema,
  resumeRequestedEventSchema,
  timerEventSchema,
]);
