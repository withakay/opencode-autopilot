import { describe, expect, test } from "bun:test";
import { createSessionState } from "../state/factory.ts";
import { createAutopilotTool } from "../tools/autopilot.ts";
import type { ExtendedState } from "../types/index.ts";

type ToolContext = Parameters<ReturnType<typeof createAutopilotTool>["execute"]>[1];

function createToolContext(): ToolContext {
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
  test("returns help text", async () => {
    const tool = createAutopilotTool({
      getState: () => undefined,
      setState: () => {},
      createSessionState,
      normalizeMaxContinues: () => 10,
      initSession: () => {},
      onArmed: async () => {},
      summarizeState: () => "unused",
      getHistory: () => [],
      onStop: () => {},
      defaultWorkerAgent: "general",
    });

    const result = await tool.execute({ action: "help" }, createToolContext());

    expect(result).toContain("Autopilot Usage");
    expect(result).toContain("/autopilot on");
    expect(result).toContain("delegate agent");
  });

  test("turns on session autopilot without dispatching a delegated task", async () => {
    const stateMap = new Map<string, ExtendedState>();
    const historyMap = new Map<string, string[]>();

    const tool = createAutopilotTool({
      getState: (sessionID) => stateMap.get(sessionID),
      setState: (sessionID, state) => {
        stateMap.set(sessionID, state);
      },
      createSessionState,
      normalizeMaxContinues: () => 10,
      initSession: (sessionID) => {
        historyMap.set(sessionID, []);
      },
      onArmed: async (sessionID, state) => {
        historyMap.set(sessionID, [
          state.goal ? `task:${state.goal}` : "session-defaults",
          `agent:${state.worker_agent}`,
        ]);
      },
      summarizeState: () => "unused",
      getHistory: (sessionID) => historyMap.get(sessionID) ?? [],
      onStop: () => {},
      defaultWorkerAgent: "general",
    });

    const result = await tool.execute({ action: "on" }, createToolContext());

    expect(result).toContain("Autopilot is enabled");
    expect(stateMap.get("s1")?.goal).toBe("");
    expect(historyMap.get("s1")).toContain("session-defaults");
  });

  test("returns combined status and history", async () => {
    const state = createSessionState("s1", "Fix tests", { workerAgent: "general" });
    const tool = createAutopilotTool({
      getState: () => state,
      setState: () => {},
      createSessionState,
      normalizeMaxContinues: () => 10,
      initSession: () => {},
      onArmed: async () => {},
      summarizeState: () => "Autopilot status: mode=ENABLED",
      getHistory: () => ["enabled", "delegated task started"],
      onStop: () => {},
      defaultWorkerAgent: "general",
    });

    const result = await tool.execute({ action: "status" }, createToolContext());

    expect(result).toContain("Autopilot status: mode=ENABLED");
    expect(result).toContain("delegated task started");
  });

  test("stops an active session", async () => {
    let stoppedReason: string | undefined;
    const tool = createAutopilotTool({
      getState: () => createSessionState("s1", "Fix tests"),
      setState: () => {},
      createSessionState,
      normalizeMaxContinues: () => 10,
      initSession: () => {},
      onArmed: async () => {},
      summarizeState: () => "unused",
      getHistory: () => [],
      onStop: (_sessionID, reason) => {
        stoppedReason = reason;
      },
      defaultWorkerAgent: "general",
    });

    const result = await tool.execute(
      { action: "off", task: "manual takeover" },
      createToolContext(),
    );

    expect(result).toContain("Autopilot stopped");
    expect(stoppedReason).toBe("manual takeover");
  });
});
