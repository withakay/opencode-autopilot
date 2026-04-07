import { tool } from "@opencode-ai/plugin";

interface ExecutableTool<TArgs> {
  execute: (args: TArgs, context: unknown) => Promise<string> | string;
}

export interface AutopilotToolDeps {
  startTool: ExecutableTool<{
    task: string;
    permissionMode?: "limited" | "allow-all";
    maxContinues?: number;
    workerAgent?: string;
  }>;
  statusTool: ExecutableTool<Record<string, never>>;
  stopTool: ExecutableTool<{ reason?: string }>;
  helpTool: ExecutableTool<Record<string, never>>;
}

export function createAutopilotTool(deps: AutopilotToolDeps) {
  return tool({
    description: "Control autopilot for the current session",
    args: {
      action: tool.schema
        .enum(["start", "status", "stop", "help"])
        .optional()
        .describe("Autopilot action to perform; inferred from other arguments when omitted"),
      task: tool.schema
        .string()
        .optional()
        .describe("Task for the autonomous worker to execute when starting autopilot"),
      permissionMode: tool.schema
        .enum(["limited", "allow-all"])
        .optional()
        .describe("How permissions should behave while autopilot is active"),
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
        .describe("Agent used for autonomous follow-up turns"),
      reason: tool.schema
        .string()
        .optional()
        .describe("Optional reason to include when stopping autopilot"),
    },
    async execute(args, context) {
      const task = args.task?.trim();
      const reason = args.reason?.trim() || undefined;
      const action = args.action ?? (reason ? "stop" : task ? "start" : "status");

      switch (action) {
        case "help":
          return deps.helpTool.execute({}, context);
        case "status":
          return deps.statusTool.execute({}, context);
        case "stop":
          return deps.stopTool.execute({ reason }, context);
        case "start":
          if (!task) {
            return "A task is required to start autopilot.";
          }

          return deps.startTool.execute(
            {
              task,
              permissionMode: args.permissionMode,
              maxContinues: args.maxContinues,
              workerAgent: args.workerAgent?.trim() || undefined,
            },
            context,
          );
      }
    },
  });
}
