import type { AutopilotConfig } from "../config/autopilot-config.ts";
import type {
  AutonomousStrength,
  AutopilotRunStatus,
  Checkpoint,
  GoalContract,
  PlanStep,
  VerificationRecord,
} from "../types/state.ts";

export interface SessionCompactingHookDeps {
  getState: (sessionID: string) =>
    | {
        mode: "DISABLED" | "ENABLED";
        session_mode: "session-defaults" | "delegated-task";
        goal: string;
        objective?: string;
        run_mode?: "ambient" | "objective";
        status?: AutopilotRunStatus;
        done_when?: string;
        verify_with?: string;
        goal_contract?: GoalContract;
        checkpoints?: Checkpoint[];
        current_checkpoint?: string;
        last_verification?: VerificationRecord;
        plan?: PlanStep[];
        active_step_index?: number;
        continuation_count: number;
        max_continues: number;
        worker_agent: string;
        autonomous_strength: AutonomousStrength;
      }
    | undefined;
  getHistory: (sessionID: string) => string[];
  getConfig: () => AutopilotConfig;
  summarizeWorkflow: (config: AutopilotConfig) => string[];
}

interface SessionCompactingInput {
  sessionID: string;
}

interface SessionCompactingOutput {
  context: string[];
  prompt?: string;
}

function escapePromptBlockText(text: string): string {
  return String(text).replaceAll("</", "<\\/");
}

export function createSessionCompactingHook(
  deps: SessionCompactingHookDeps,
): (input: SessionCompactingInput, output: SessionCompactingOutput) => Promise<void> {
  return async (input: SessionCompactingInput, output: SessionCompactingOutput): Promise<void> => {
    const state = deps.getState(input.sessionID);

    if (!state || state.mode !== "ENABLED") {
      return;
    }

    if (!Array.isArray(output.context)) {
      output.context = [];
    }

    const history = deps.getHistory(input.sessionID);
    const config = deps.getConfig();
    const recentEvents =
      history.length > 0 ? history.map((item) => `- ${item}`).join("\n") : "- none";
    const workflowLines = deps.summarizeWorkflow(config);
    const configHints = config.promptInjection?.compaction ?? [];
    const runMode =
      state.run_mode ?? (state.session_mode === "delegated-task" ? "objective" : "ambient");
    const activeStep = state.plan?.[state.active_step_index ?? -1];
    const activeCheckpoint = state.checkpoints?.find(
      (checkpoint) => checkpoint.id === state.current_checkpoint,
    );
    const doneSteps = state.plan?.filter((step) => step.status === "done").length ?? 0;

    output.context.push(
      [
        "## Autopilot Continuation State",
        `Autopilot is ENABLED in ${state.session_mode} mode with ${state.autonomous_strength} autonomy.`,
        `Run mode: ${runMode}`,
        `Status: ${state.status ?? "active"}`,
        "Objective block:",
        "<autopilot_objective>",
        escapePromptBlockText(
          state.objective || state.goal || "Keep applying session-level autonomy defaults.",
        ),
        "</autopilot_objective>",
        state.done_when ? `Done when: ${state.done_when}` : undefined,
        state.verify_with ? `Verify with: ${state.verify_with}` : undefined,
        state.goal_contract ? `Goal quality: ${state.goal_contract.quality}` : undefined,
        state.goal_contract?.criteria.length
          ? `Acceptance criteria: ${state.goal_contract.criteria.map((criterion) => `${criterion.status}:${criterion.text}`).join("; ")}`
          : undefined,
        activeCheckpoint
          ? `Current checkpoint: ${activeCheckpoint.title} (${activeCheckpoint.status})`
          : undefined,
        state.last_verification
          ? `Last verification: ${state.last_verification.status} - ${state.last_verification.summary}`
          : undefined,
        state.plan && state.plan.length > 0
          ? `Plan progress: ${doneSteps}/${state.plan.length}`
          : undefined,
        activeStep ? `Current plan step: ${activeStep.title}` : undefined,
        `Worker agent: ${state.worker_agent}`,
        `Continuation count: ${state.continuation_count}/${state.max_continues}`,
        ...workflowLines,
        "Recent autopilot events:",
        recentEvents,
        "Continuation rule: after compaction, keep working without routine confirmation questions. If the next obvious step is inspect, edit, test, validate, or summarize, do it instead of asking whether to proceed.",
        "Escalate only for real blockers: denied permissions, missing required external information, high-impact irreversible decisions, or security/safety risks.",
        ...configHints,
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n"),
    );
  };
}
