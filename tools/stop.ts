import { tool } from "@opencode-ai/plugin";
import type { ExtendedState } from "../types/index.ts";

// ---------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------

export interface StopToolDeps {
  getState: (sessionID: string) => ExtendedState | undefined;
  onStop: (sessionID: string, reason: string | undefined) => void;
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createStopTool(deps: StopToolDeps) {
  return tool({
    description: "Stop autopilot mode for the current session",
    args: {
      reason: tool.schema
        .string()
        .optional()
        .describe("Optional reason to include in the stop message"),
    },
    async execute(args, context) {
      const state = deps.getState(context.sessionID);

      if (!state || state.mode !== "ENABLED") {
        return "Autopilot is not running in this session.";
      }

      deps.onStop(context.sessionID, args.reason);

      return args.reason
        ? `Autopilot stopped: ${args.reason}`
        : "Autopilot stopped for this session.";
    },
  });
}
