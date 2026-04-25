import type { AutopilotConfig } from "../config/autopilot-config.ts";
import type { AutonomousStrength } from "../types/state.ts";

export interface SessionCompactingHookDeps {
  getState: (sessionID: string) =>
    | {
        mode: "DISABLED" | "ENABLED";
        session_mode: "session-defaults" | "delegated-task";
        goal: string;
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

    output.context.push(
      [
        "## Autopilot Continuation State",
        `Autopilot is ENABLED in ${state.session_mode} mode with ${state.autonomous_strength} autonomy.`,
        `Goal: ${state.goal || "Keep applying session-level autonomy defaults."}`,
        `Worker agent: ${state.worker_agent}`,
        `Continuation count: ${state.continuation_count}/${state.max_continues}`,
        ...workflowLines,
        "Recent autopilot events:",
        recentEvents,
        "Continuation rule: after compaction, keep working without routine confirmation questions. If the next obvious step is inspect, edit, test, validate, or summarize, do it instead of asking whether to proceed.",
        "Escalate only for real blockers: denied permissions, missing required external information, high-impact irreversible decisions, or security/safety risks.",
        ...configHints,
      ].join("\n"),
    );
  };
}
