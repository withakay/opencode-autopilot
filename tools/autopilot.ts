import { tool } from "@opencode-ai/plugin";
import type { ExtendedState } from "../types/index.ts";
import { buildAutopilotUsage } from "./usage.ts";

export interface AutopilotToolDeps {
  getState: (sessionID: string) => ExtendedState | undefined;
  setState: (sessionID: string, state: ExtendedState) => void;
  createSessionState: (
    sessionID: string,
    goal: string,
    options: {
      maxContinues?: number;
      sessionMode?: ExtendedState["session_mode"];
      workerAgent?: string;
    },
  ) => ExtendedState;
  normalizeMaxContinues: (value: unknown) => number;
  initSession: (sessionID: string) => void;
  onArmed: (sessionID: string, state: ExtendedState) => Promise<void>;
  summarizeState: (state: ExtendedState | null | undefined) => string;
  getHistory: (sessionID: string) => string[];
  onStop: (sessionID: string, reason: string | undefined) => void;
  defaultWorkerAgent: string;
}

const AUTOPILOT_FALLBACK_AGENT = "pi";

export function createAutopilotTool(deps: AutopilotToolDeps) {
  return tool({
    description:
      "Control session autopilot: turn it on or off, check status, or start a long-running delegated task",
    args: {
      action: tool.schema
        .enum(["on", "off", "status", "help"])
        .optional()
        .describe("Autopilot command: on, off, status, or help"),
      task: tool.schema
        .string()
        .optional()
        .describe("Optional delegated task to hand to the configured agent"),
      permissionMode: tool.schema
        .enum(["limited", "allow-all"])
        .optional()
        .describe("How permissions should behave while autopilot is active"),
      maxContinues: tool.schema
        .number()
        .int()
        .positive()
        .optional()
        .describe("Maximum number of autonomous continuation prompts"),
      workerAgent: tool.schema
        .string()
        .optional()
        .describe("Delegate agent used for long-running autopilot tasks"),
    },
    async execute(args, context) {
      const task = args.task?.trim() ?? "";
      const action = args.action ?? (task ? "on" : "help");

      if (action === "help" || (!args.action && task.toLowerCase() === "help")) {
        return buildAutopilotUsage();
      }

      if (action === "status") {
        const state = deps.getState(context.sessionID);
        if (!state) {
          return deps.summarizeState(state);
        }

        const history = deps.getHistory(context.sessionID);
        const historyStr = history.length > 0 ? `\nRecent events:\n- ${history.join("\n- ")}` : "";
        return `${deps.summarizeState(state)}${historyStr}`;
      }

      if (action === "off") {
        const state = deps.getState(context.sessionID);
        if (!state || state.mode !== "ENABLED") {
          return "Autopilot is not running in this session.";
        }

        deps.onStop(context.sessionID, task || undefined);
        return task ? `Autopilot stopped: ${task}` : "Autopilot stopped for this session.";
      }

      const permissionMode = args.permissionMode ?? "limited";
      const maxContinues = deps.normalizeMaxContinues(args.maxContinues);
      const workerAgent =
        args.workerAgent?.trim() || deps.defaultWorkerAgent || AUTOPILOT_FALLBACK_AGENT;

      const state = deps.createSessionState(context.sessionID, task, {
        maxContinues,
        workerAgent,
        sessionMode: task ? "delegated-task" : "session-defaults",
      });

      Object.defineProperty(state, "permissionMode", {
        value: permissionMode,
        writable: true,
        enumerable: true,
        configurable: true,
      });

      deps.setState(context.sessionID, state);
      deps.initSession(context.sessionID);

      context.metadata({
        title: task ? "Autopilot task started" : "Autopilot enabled",
        metadata: {
          action,
          permissionMode,
          maxContinues,
          workerAgent,
          task: task || null,
        },
      });

      await deps.onArmed(context.sessionID, state);

      if (state.session_mode === "session-defaults") {
        return `Autopilot is enabled in ${permissionMode} mode for this session. OpenCode will prefer reasonable defaults, ask fewer questions, and keep using ${workerAgent} for delegated work when you hand it a task.`;
      }

      return `Autopilot enabled in ${permissionMode} mode with ${workerAgent}. It will start the delegated task after this response and may continue up to ${maxContinues} times.`;
    },
  });
}
