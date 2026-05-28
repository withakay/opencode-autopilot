import type {
  AgentMode,
  AgentPhase,
  AutonomousStrength,
  AutopilotRunStatus,
  ExtendedState,
  PlanStep,
} from "../types/index.ts";
import { createGoalContract, createInitialCheckpoint } from "./goal-contract.ts";

export interface CreateInitialStateOptions {
  sessionID?: string;
  mode?: AgentMode;
  phase?: AgentPhase;
  sessionMode?: ExtendedState["session_mode"];
  maxContinues?: number;
  workerAgent?: string;
  autonomousStrength?: AutonomousStrength;
  doneWhen?: string;
  verifyWith?: string;
  planSource?: string;
  planningFramework?: string;
  status?: AutopilotRunStatus;
  plan?: PlanStep[];
}

const DEFAULT_MAX_CONTINUES = 25;
const DEFAULT_WORKER_AGENT = "pi";
const DEFAULT_AUTONOMOUS_STRENGTH: AutonomousStrength = "balanced";

export function createInitialState(
  objective: string,
  options: CreateInitialStateOptions = {},
): ExtendedState {
  const sessionID = options.sessionID ?? "";
  const sessionMode = options.sessionMode ?? "delegated-task";
  const mode = options.mode ?? "DISABLED";
  const normalizedObjective = objective.trim();
  const plan: PlanStep[] = (options.plan ?? []).map((step, index) => {
    const status = index === 0 ? "in_progress" : step.status === "done" ? "done" : "pending";
    return {
      ...step,
      status,
    };
  });
  const checkpoints = createInitialCheckpoint({ objective: normalizedObjective, plan });

  return {
    session_id: sessionID,
    mode,
    phase: options.phase ?? "STOPPED",
    session_mode: sessionMode,
    goal: normalizedObjective,
    objective: normalizedObjective,
    run_mode: sessionMode === "delegated-task" ? "objective" : "ambient",
    status: options.status ?? (mode === "ENABLED" ? "active" : "cleared"),
    done_when: options.doneWhen,
    verify_with: options.verifyWith,
    plan_source: options.planSource,
    planning_framework: options.planningFramework,
    plan,
    goal_contract: createGoalContract({
      objective: normalizedObjective,
      doneWhen: options.doneWhen,
      verifyWith: options.verifyWith,
      planSource: options.planSource,
      planningFramework: options.planningFramework,
      plan,
    }),
    checkpoints,
    current_checkpoint: checkpoints[0]?.id,
    active_step_index: plan.length > 0 ? 0 : -1,
    stop_reason: null,
    continuation_count: 0,
    max_continues: options.maxContinues ?? DEFAULT_MAX_CONTINUES,
    worker_agent: options.workerAgent ?? DEFAULT_WORKER_AGENT,
    autonomous_strength: options.autonomousStrength ?? DEFAULT_AUTONOMOUS_STRENGTH,
  };
}

export function createSessionState(
  sessionID: string,
  objective: string,
  options: Omit<CreateInitialStateOptions, "sessionID"> = {},
): ExtendedState {
  return createInitialState(objective, {
    ...options,
    sessionID,
    mode: options.mode ?? "ENABLED",
    phase: options.phase ?? "OBSERVE",
    sessionMode: options.sessionMode ?? "delegated-task",
  });
}
