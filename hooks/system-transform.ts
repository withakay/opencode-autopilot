// ---------------------------------------------------------------------------
// experimental.chat.system.transform hook
// Injects autopilot system prompt for worker turns, suppresses for control turns
// ---------------------------------------------------------------------------

export interface SystemTransformHookDeps {
  getState: (sessionID: string) => { mode: "DISABLED" | "ENABLED" } | undefined;
  getSuppressCount: (sessionID: string) => number;
  decrementSuppressCount: (sessionID: string) => void;
  buildSystemPrompt: () => string;
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

    output.system.push(buildSystemPrompt());
  };
}
