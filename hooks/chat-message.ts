export interface ChatMessageHookDeps {
  getState: (sessionID: string) => { mode: "DISABLED" | "ENABLED" } | undefined;
  setPendingAgent: (sessionID: string, agent: string | undefined) => void;
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
  return async (input: ChatMessageInput, _output: ChatMessageOutput): Promise<void> => {
    const state = deps.getState(input.sessionID);

    if (!state || state.mode !== "ENABLED") {
      return;
    }

    deps.setPendingAgent(input.sessionID, input.agent);
  };
}
