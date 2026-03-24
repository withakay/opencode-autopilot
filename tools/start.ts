import { tool } from "@opencode-ai/plugin";
import type { ExtendedState } from "../types/index.ts";

// ---------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------

export interface StartToolDeps {
  getState: (sessionID: string) => ExtendedState | undefined;
  setState: (sessionID: string, state: ExtendedState) => void;
  createSessionState: (
    sessionID: string,
    goal: string,
    options: {
      maxContinues?: number;
      workerAgent?: string;
    },
  ) => ExtendedState;
  normalizeMaxContinues: (value: unknown) => number;
  initSession: (sessionID: string) => void;
  onArmed: (sessionID: string, state: ExtendedState) => Promise<void>;
  defaultWorkerAgent: string;
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

const AUTOPILOT_FALLBACK_AGENT = "pi";

export function createStartTool(deps: StartToolDeps) {
  return tool({
    description: "Arm autopilot mode for the current session",
    args: {
      task: tool.schema
        .string()
        .min(1)
        .describe("Task for the autonomous worker to execute"),
      permissionMode: tool.schema
        .enum(["limited", "allow-all"])
        .optional()
        .describe(
          "How permissions should behave while autopilot is active",
        ),
      maxContinues: tool.schema
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "Maximum number of autonomous continuation prompts after the initial task prompt",
        ),
      workerAgent: tool.schema
        .string()
        .optional()
        .describe(
          "Agent used for autonomous follow-up turns (defaults to pi)",
        ),
    },
    async execute(args, context) {
      if (args.task.trim().toLowerCase() === "help") {
        return `
## Autopilot Usage

Use the global \`Autopilot\` agent to control the autopilot plugin.

**Start Autopilot:**
Switch to the \`Autopilot\` agent, then send the task you want delegated.

Examples:
- \`Fix the failing tests\`
- \`Use allow-all mode and build-high to refactor the reducer\`

**Check Status:**
- \`status\`
- \`is autopilot running?\`

**Stop Autopilot:**
- \`stop\`
- \`stop because I want to inspect manually\`

Defaults:
- permission mode: \`limited\`
- continuation limit: \`10\`
- worker agent: \`pi\`
`.trim();
      }

      const permissionMode = args.permissionMode ?? "limited";
      const maxContinues = deps.normalizeMaxContinues(args.maxContinues);
      const workerAgent =
        args.workerAgent?.trim() || deps.defaultWorkerAgent || AUTOPILOT_FALLBACK_AGENT;

      const state = deps.createSessionState(context.sessionID, args.task.trim(), {
        maxContinues,
        workerAgent,
      });

      // Store permission mode alongside the state.
      // We set it via Object.defineProperty to keep strict types clean.
      Object.defineProperty(state, "permissionMode", {
        value: permissionMode,
        writable: true,
        enumerable: true,
        configurable: true,
      });

      deps.setState(context.sessionID, state);
      deps.initSession(context.sessionID);

      context.metadata({
        title: "Autopilot armed",
        metadata: {
          permissionMode,
          maxContinues,
          workerAgent,
        },
      });

      await deps.onArmed(context.sessionID, state);

      return `Autopilot armed in ${permissionMode} mode with ${workerAgent}. It will start after this response and may continue up to ${maxContinues} times.`;
    },
  });
}
