// ---------------------------------------------------------------------------
// experimental.chat.system.transform hook
// Injects autopilot system prompt while autopilot is enabled.
// ---------------------------------------------------------------------------

import type { AutopilotConfig } from "../config/autopilot-config.ts";
import type { AutonomousStrength } from "../types/state.ts";

export interface SystemTransformHookDeps {
  getState: (sessionID: string) =>
    | {
        mode: "DISABLED" | "ENABLED";
        session_mode: "session-defaults" | "delegated-task";
        worker_agent: string;
        autonomous_strength: AutonomousStrength;
      }
    | undefined;
  consumePendingAgent: (sessionID: string) => string | undefined;
  getConfig: () => AutopilotConfig;
  buildSystemPrompt: (
    strength: AutonomousStrength,
    includeStatusMarkers: boolean,
    config: AutopilotConfig,
  ) => string;
}

interface SystemTransformInput {
  sessionID?: string;
  model: Record<string, unknown>;
}

interface SystemTransformOutput {
  system: string[];
}

export function createSystemTransformHook(
  deps: SystemTransformHookDeps,
): (input: SystemTransformInput, output: SystemTransformOutput) => Promise<void> {
  const { getState, consumePendingAgent, getConfig, buildSystemPrompt } = deps;

  return async (input: SystemTransformInput, output: SystemTransformOutput): Promise<void> => {
    const { sessionID } = input;

    if (sessionID === undefined) {
      return;
    }

    const state = getState(sessionID);

    if (!state || state.mode !== "ENABLED") {
      return;
    }

    const pendingAgent = consumePendingAgent(sessionID);
    if (
      state.session_mode === "delegated-task" &&
      pendingAgent !== undefined &&
      pendingAgent !== state.worker_agent
    ) {
      return;
    }

    if (!Array.isArray(output.system)) {
      output.system = [];
    }

    output.system.push(
      buildSystemPrompt(
        state.autonomous_strength,
        state.session_mode === "delegated-task",
        getConfig(),
      ),
    );
  };
}
