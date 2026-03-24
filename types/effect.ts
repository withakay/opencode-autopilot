import type { StopReason } from "./stop-reason.ts";

export type EffectMetadata = Record<string, unknown>;

export type EffectKind =
  | "REQUEST_APPROVAL"
  | "REQUEST_TRUST"
  | "RUN_TOOL"
  | "COMPACT_CONTEXT"
  | "WAIT_FOR_BACKGROUND_TASK"
  | "EMIT_FINAL_RESPONSE"
  | "PERSIST_SNAPSHOT"
  | "NO_OP";

export interface RequestApprovalEffect {
  kind: "REQUEST_APPROVAL";
  approval_scope: string;
  approved_action: string;
  justification: string;
  metadata: EffectMetadata;
}

export interface RequestTrustEffect {
  kind: "REQUEST_TRUST";
  requested_path: string;
  scope: "session" | "persistent";
  justification: string;
  metadata: EffectMetadata;
}

export interface RunToolEffect {
  kind: "RUN_TOOL";
  tool_name: string;
  invocation_id: string;
  arguments: Record<string, unknown>;
  target_paths: string[];
  summary: string;
  risky: boolean;
  metadata: EffectMetadata;
}

export interface CompactContextEffect {
  kind: "COMPACT_CONTEXT";
  reason: string;
  preserve_fields: string[];
  metadata: EffectMetadata;
}

export interface WaitForBackgroundTaskEffect {
  kind: "WAIT_FOR_BACKGROUND_TASK";
  task_id: string;
  timeout_ms: number | null;
  metadata: EffectMetadata;
}

export interface EmitFinalResponseEffect {
  kind: "EMIT_FINAL_RESPONSE";
  summary: string;
  stop_reason: StopReason | null;
  metadata: EffectMetadata;
}

export interface PersistSnapshotEffect {
  kind: "PERSIST_SNAPSHOT";
  session_id: string;
  risky_effect_kind: Exclude<EffectKind, "NO_OP"> | null;
  metadata: EffectMetadata;
}

export interface NoOpEffect {
  kind: "NO_OP";
}

export type Effect =
  | RequestApprovalEffect
  | RequestTrustEffect
  | RunToolEffect
  | CompactContextEffect
  | WaitForBackgroundTaskEffect
  | EmitFinalResponseEffect
  | PersistSnapshotEffect
  | NoOpEffect;
