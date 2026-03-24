import { tool } from "@opencode-ai/plugin";
import type { ExtendedState } from "../types/index.ts";

// ---------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------

export interface StatusToolDeps {
  getState: (sessionID: string) => ExtendedState | undefined;
  summarizeState: (state: ExtendedState | null | undefined) => string;
  getHistory: (sessionID: string) => string[];
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createStatusTool(deps: StatusToolDeps) {
  return tool({
    description: "Show autopilot status for the current session",
    args: {},
    async execute(_args, context) {
      const state = deps.getState(context.sessionID);

      if (!state) {
        return deps.summarizeState(state);
      }

      const history = deps.getHistory(context.sessionID);
      const historyStr =
        history.length > 0
          ? `\nRecent events:\n- ${history.join("\n- ")}`
          : "";

      return `${deps.summarizeState(state)}${historyStr}`;
    },
  });
}
