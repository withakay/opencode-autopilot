import type { AgentMode, AgentPhase, AutonomousStrength, ExtendedState } from "../types/index.ts";

export interface CreateInitialStateOptions {
  sessionID?: string;
  mode?: AgentMode;
  phase?: AgentPhase;
  sessionMode?: ExtendedState["session_mode"];
  maxContinues?: number;
  workerAgent?: string;
  autonomousStrength?: AutonomousStrength;
}

const DEFAULT_MAX_CONTINUES = 25;
const DEFAULT_WORKER_AGENT = "pi";
const DEFAULT_AUTONOMOUS_STRENGTH: AutonomousStrength = "balanced";

export function createInitialState(
  goal: string,
  options: CreateInitialStateOptions = {},
): ExtendedState {
  const sessionID = options.sessionID ?? "";

  return {
    session_id: sessionID,
    mode: options.mode ?? "DISABLED",
    phase: options.phase ?? "STOPPED",
    session_mode: options.sessionMode ?? "delegated-task",
    goal,
    stop_reason: null,
    continuation_count: 0,
    max_continues: options.maxContinues ?? DEFAULT_MAX_CONTINUES,
    worker_agent: options.workerAgent ?? DEFAULT_WORKER_AGENT,
    autonomous_strength: options.autonomousStrength ?? DEFAULT_AUTONOMOUS_STRENGTH,
  };
}

export function createSessionState(
  sessionID: string,
  goal: string,
  options: Omit<CreateInitialStateOptions, "sessionID"> = {},
): ExtendedState {
  return createInitialState(goal, {
    ...options,
    sessionID,
    mode: options.mode ?? "ENABLED",
    phase: options.phase ?? "OBSERVE",
    sessionMode: options.sessionMode ?? "delegated-task",
  });
}
