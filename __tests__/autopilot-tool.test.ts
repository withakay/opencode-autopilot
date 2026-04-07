import { describe, expect, test } from "bun:test";
import { createAutopilotTool } from "../tools/autopilot.ts";

type AutopilotToolContext = Parameters<ReturnType<typeof createAutopilotTool>["execute"]>[1];

function createToolContext(): AutopilotToolContext {
  return {
    sessionID: "s1",
    messageID: "m1",
    agent: "pi",
    directory: "/tmp",
    worktree: "/tmp",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  };
}

describe("Autopilot Tool", () => {
  test("defaults to status when no action is provided", async () => {
    const calls: string[] = [];
    const tool = createAutopilotTool({
      startTool: { execute: async () => "start" },
      statusTool: {
        execute: async () => {
          calls.push("status");
          return "status";
        },
      },
      stopTool: { execute: async () => "stop" },
      helpTool: { execute: async () => "help" },
    });

    const result = await tool.execute({}, createToolContext());

    expect(result).toBe("status");
    expect(calls).toEqual(["status"]);
  });

  test("infers start from a task and forwards trimmed arguments", async () => {
    let received:
      | {
          task: string;
          permissionMode?: "limited" | "allow-all";
          maxContinues?: number;
          workerAgent?: string;
        }
      | undefined;

    const tool = createAutopilotTool({
      startTool: {
        execute: async (args) => {
          received = args;
          return "started";
        },
      },
      statusTool: { execute: async () => "status" },
      stopTool: { execute: async () => "stop" },
      helpTool: { execute: async () => "help" },
    });

    const result = await tool.execute(
      {
        task: "  fix tests  ",
        permissionMode: "allow-all",
        maxContinues: 3,
        workerAgent: "  build-high  ",
      },
      createToolContext(),
    );

    expect(result).toBe("started");
    expect(received).toEqual({
      task: "fix tests",
      permissionMode: "allow-all",
      maxContinues: 3,
      workerAgent: "build-high",
    });
  });

  test("infers stop from a reason", async () => {
    let received: { reason?: string } | undefined;
    const tool = createAutopilotTool({
      startTool: { execute: async () => "start" },
      statusTool: { execute: async () => "status" },
      stopTool: {
        execute: async (args) => {
          received = args;
          return "stopped";
        },
      },
      helpTool: { execute: async () => "help" },
    });

    const result = await tool.execute({ reason: "  inspect manually  " }, createToolContext());

    expect(result).toBe("stopped");
    expect(received).toEqual({ reason: "inspect manually" });
  });

  test("returns an error when explicit start has no task", async () => {
    const tool = createAutopilotTool({
      startTool: { execute: async () => "start" },
      statusTool: { execute: async () => "status" },
      stopTool: { execute: async () => "stop" },
      helpTool: { execute: async () => "help" },
    });

    const result = await tool.execute({ action: "start" }, createToolContext());

    expect(result).toBe("A task is required to start autopilot.");
  });
});
