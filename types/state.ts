import type { AgentMode } from "./mode.ts";
import type { AgentPhase } from "./phase.ts";
import type { StopReason } from "./stop-reason.ts";

export type AutonomousStrength = "conservative" | "balanced" | "aggressive";
export type AutopilotRunMode = "ambient" | "objective";
export type AutopilotRunStatus =
  | "active"
  | "waiting_for_reply"
  | "validating"
  | "paused"
  | "blocked"
  | "completed"
  | "failed"
  | "cleared";
export type PlanStepStatus = "pending" | "in_progress" | "done";

export interface PlanStep {
  id: string;
  title: string;
  description: string;
  status: PlanStepStatus;
  evidence?: string;
}

export interface ExtendedState {
  session_id: string;
  mode: AgentMode;
  phase: AgentPhase;
  session_mode: "session-defaults" | "delegated-task";
  /** @deprecated Use objective for new code. Kept as a compatibility alias. */
  goal: string;
  objective: string;
  run_mode: AutopilotRunMode;
  status: AutopilotRunStatus;
  done_when?: string;
  verify_with?: string;
  plan_source?: string;
  planning_framework?: string;
  candidate_completion?: string;
  plan: PlanStep[];
  active_step_index: number;
  stop_reason: StopReason | null;
  continuation_count: number;
  max_continues: number;
  worker_agent: string;
  autonomous_strength: AutonomousStrength;
}
