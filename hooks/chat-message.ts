// ---------------------------------------------------------------------------
// chat.message hook — tracks optional autopilot orchestrator turns for suppression
// ---------------------------------------------------------------------------

export const CONTROL_AGENT = "autopilot";

export interface ChatMessageHookDeps {
  getState: (sessionID: string) => { mode: "DISABLED" | "ENABLED" } | undefined;
  incrementSuppressCount: (sessionID: string) => void;
}

interface ChatMessageInput {
  sessionID: string;
  agent?: string;
  model?: { providerID: string; modelID: string };
  messageID?: string;
  variant?: string;
}

interface ChatMessageOutput {
  message: Record<string, unknown>;
  parts: unknown[];
}

export function createChatMessageHook(
  deps: ChatMessageHookDeps,
): (input: ChatMessageInput, output: ChatMessageOutput) => Promise<void> {
  const { getState, incrementSuppressCount } = deps;

  return async (input: ChatMessageInput, _output: ChatMessageOutput): Promise<void> => {
    const state = getState(input.sessionID);

    if (!state || state.mode !== "ENABLED") {
      return;
    }

    if (input.agent === CONTROL_AGENT) {
      incrementSuppressCount(input.sessionID);
    }
  };
}
