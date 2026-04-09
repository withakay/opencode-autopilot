// ---------------------------------------------------------------------------
// experimental.chat.system.transform hook
// Injects autopilot system prompt for worker turns, suppresses for control turns
// ---------------------------------------------------------------------------

import type { AutonomousStrength } from "../types/state.ts";

export interface SystemTransformHookDeps {
  getState: (
    sessionID: string,
  ) => { mode: "DISABLED" | "ENABLED"; autonomous_strength: AutonomousStrength } | undefined;
  getSuppressCount: (sessionID: string) => number;
  decrementSuppressCount: (sessionID: string) => void;
  buildSystemPrompt: (strength: AutonomousStrength) => string;
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
  const { getState, getSuppressCount, decrementSuppressCount, buildSystemPrompt } = deps;

  return async (input: SystemTransformInput, output: SystemTransformOutput): Promise<void> => {
    const { sessionID } = input;

    if (sessionID === undefined) {
      return;
    }

    const state = getState(sessionID);

    if (!state || state.mode !== "ENABLED") {
      return;
    }

    const suppressCount = getSuppressCount(sessionID);

    if (suppressCount > 0) {
      decrementSuppressCount(sessionID);
      return;
    }

    if (!Array.isArray(output.system)) {
      output.system = [];
    }

    output.system.push(buildSystemPrompt(state.autonomous_strength));
  };
}
