import type { AgentMode } from "./mode.ts";
import type { AgentPhase } from "./phase.ts";
import type { StopReason } from "./stop-reason.ts";

export type AutonomousStrength = "conservative" | "balanced" | "aggressive";

export interface ExtendedState {
  session_id: string;
  mode: AgentMode;
  phase: AgentPhase;
  session_mode: "session-defaults" | "delegated-task";
  goal: string;
  stop_reason: StopReason | null;
  continuation_count: number;
  max_continues: number;
  worker_agent: string;
  autonomous_strength: AutonomousStrength;
}
