import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { createSessionState } from "../state/factory.ts";
import { createAutopilotTool } from "../tools/autopilot.ts";
import { parsePlan } from "../tools/plan.ts";
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
    ask: () => Effect.void,
  };
}

describe("Autopilot Tool", () => {
  test("parses plain-text plans", () => {
    expect(parsePlan("1. Read PLAN.md\n2. Implement changes\n- Run tests")).toMatchObject([
      { id: "step-1", title: "Read PLAN.md", status: "pending" },
      { id: "step-2", title: "Implement changes", status: "pending" },
      { id: "step-3", title: "Run tests", status: "pending" },
    ]);
  });

  test("parses explicit plans with multiline step details", () => {
    const plan = parsePlan(
      [
        "1. Read PLAN.md",
        "   Capture constraints and commands",
        "2. Implement changes",
        "   - Keep edits minimal",
      ].join("\n"),
    );

    expect(plan).toHaveLength(2);
    expect(plan[0]?.title).toBe("Read PLAN.md");
    expect(plan[0]?.description).toContain("Capture constraints and commands");
    expect(plan[1]?.description).toContain("Keep edits minimal");
  });

  test("parses JSON-array plans", () => {
    expect(
      parsePlan(JSON.stringify([{ title: "Add tests", description: "Write regression tests" }])),
    ).toMatchObject([
      {
        id: "step-1",
        title: "Add tests",
        description: "Write regression tests",
        status: "pending",
      },
    ]);
  });

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
    expect(stateMap.get("s1")?.run_mode).toBe("ambient");
    expect(historyMap.get("s1")).toContain("session-defaults");
  });

  test("explicit on remains ambient even with objective text", async () => {
    const stateMap = new Map<string, ExtendedState>();
    const tool = createAutopilotTool({
      getState: (sessionID) => stateMap.get(sessionID),
      setState: (sessionID, state) => {
        stateMap.set(sessionID, state);
      },
      createSessionState,
      normalizeMaxContinues: () => 10,
      initSession: () => {},
      onArmed: async () => {},
      summarizeState: () => "unused",
      getHistory: () => [],
      onStop: () => {},
      defaultWorkerAgent: "general",
    });

    await tool.execute({ action: "on", objective: "Fix tests" }, createToolContext());

    const state = stateMap.get("s1");
    expect(state?.run_mode).toBe("ambient");
    expect(state?.objective).toBe("");
  });

  test("starts an objective run from objective aliases", async () => {
    const stateMap = new Map<string, ExtendedState>();

    const tool = createAutopilotTool({
      getState: (sessionID) => stateMap.get(sessionID),
      setState: (sessionID, state) => {
        stateMap.set(sessionID, state);
      },
      createSessionState,
      normalizeMaxContinues: () => 10,
      initSession: () => {},
      onArmed: async () => {},
      summarizeState: () => "unused",
      getHistory: () => [],
      onStop: () => {},
      defaultWorkerAgent: "general",
    });

    const result = await tool.execute(
      {
        action: "start",
        target: "Fix tests without stopping until bun test passes",
        doneWhen: "bun test passes",
        verifyWith: "bun test",
      },
      createToolContext(),
    );

    const state = stateMap.get("s1");
    expect(result).toContain("Autopilot objective run started");
    expect(state?.run_mode).toBe("objective");
    expect(state?.session_mode).toBe("delegated-task");
    expect(state?.objective).toBe("Fix tests without stopping until bun test passes");
    expect(state?.done_when).toBe("bun test passes");
    expect(state?.verify_with).toBe("bun test");
    expect(state?.goal_contract.quality).toBe("strong");
    expect(state?.goal_contract.criteria.map((criterion) => criterion.text)).toContain(
      "bun test passes",
    );
    expect(state?.goal_contract.criteria.map((criterion) => criterion.text)).toContain(
      "Verification command passes: bun test",
    );
    expect(state?.checkpoints[0]?.title).toBe("Start objective run");
  });

  test("starts a plan-backed objective run", async () => {
    const stateMap = new Map<string, ExtendedState>();

    const tool = createAutopilotTool({
      getState: (sessionID) => stateMap.get(sessionID),
      setState: (sessionID, state) => {
        stateMap.set(sessionID, state);
      },
      createSessionState,
      normalizeMaxContinues: () => 10,
      initSession: () => {},
      onArmed: async () => {},
      summarizeState: () => "unused",
      getHistory: () => [],
      onStop: () => {},
      defaultWorkerAgent: "general",
    });

    const result = await tool.execute(
      {
        action: "start",
        objective: "Implement PLAN.md",
        plan: "1. Read PLAN.md\n2. Implement changes",
      },
      createToolContext(),
    );

    const state = stateMap.get("s1");
    expect(result).toContain("Plan: 2 steps");
    expect(state?.plan).toHaveLength(2);
    expect(state?.active_step_index).toBe(0);
    expect(state?.plan[0]?.status).toBe("in_progress");
  });

  test("infers planning context from objective and repo artifacts", async () => {
    const stateMap = new Map<string, ExtendedState>();

    const tool = createAutopilotTool({
      getState: (sessionID) => stateMap.get(sessionID),
      setState: (sessionID, state) => {
        stateMap.set(sessionID, state);
      },
      createSessionState,
      normalizeMaxContinues: () => 10,
      initSession: () => {},
      onArmed: async () => {},
      summarizeState: () => "unused",
      getHistory: () => [],
      onStop: () => {},
      defaultWorkerAgent: "general",
    });

    const result = await tool.execute(
      { action: "start", objective: "Apply the Ito change for this feature" },
      createToolContext(),
    );

    const state = stateMap.get("s1");
    expect(result).toContain("Detected planning context: Ito");
    expect(state?.planning_framework).toBe("Ito");
    expect(state?.autonomous_strength).toBe("aggressive");
  });

  test("refuses objective run without a target", async () => {
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

    const result = await tool.execute({ action: "start" }, createToolContext());

    expect(result).toContain("need a target");
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

  test("pauses and resumes an objective run", async () => {
    const state = createSessionState("s1", "Fix tests");
    let initialized = 0;
    const tool = createAutopilotTool({
      getState: () => state,
      setState: () => {},
      createSessionState,
      normalizeMaxContinues: () => 10,
      initSession: () => {
        initialized += 1;
      },
      onArmed: async () => {},
      summarizeState: () => "unused",
      getHistory: () => [],
      onStop: () => {},
      defaultWorkerAgent: "general",
    });

    expect(await tool.execute({ action: "pause" }, createToolContext())).toContain("paused");
    expect(state.status).toBe("paused");
    expect(state.mode).toBe("DISABLED");

    expect(await tool.execute({ action: "resume" }, createToolContext())).toContain("resumed");
    expect(state.status).toBe("active");
    expect(state.mode).toBe("ENABLED");
    expect(initialized).toBe(1);
  });

  test("clears an objective run using stored objective", async () => {
    const state = createSessionState("s1", "Fix tests");
    let stoppedReason: string | undefined;
    const tool = createAutopilotTool({
      getState: () => state,
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

    const result = await tool.execute({ action: "clear" }, createToolContext());

    expect(result).toContain("Fix tests");
    expect(stoppedReason).toBe("Fix tests");
  });

  test("clear does not disable ambient autopilot", async () => {
    const state = createSessionState("s1", "", { sessionMode: "session-defaults" });
    let stopped = false;
    const tool = createAutopilotTool({
      getState: () => state,
      setState: () => {},
      createSessionState,
      normalizeMaxContinues: () => 10,
      initSession: () => {},
      onArmed: async () => {},
      summarizeState: () => "unused",
      getHistory: () => [],
      onStop: () => {
        stopped = true;
      },
      defaultWorkerAgent: "general",
    });

    const result = await tool.execute({ action: "clear" }, createToolContext());

    expect(result).toContain("No autopilot objective");
    expect(stopped).toBe(false);
  });

  test("accepts autonomousStrength parameter and sets it in state", async () => {
    const stateMap = new Map<string, ExtendedState>();

    const tool = createAutopilotTool({
      getState: (sessionID) => stateMap.get(sessionID),
      setState: (sessionID, state) => {
        stateMap.set(sessionID, state);
      },
      createSessionState,
      normalizeMaxContinues: () => 10,
      initSession: () => {},
      onArmed: async () => {},
      summarizeState: () => "unused",
      getHistory: () => [],
      onStop: () => {},
      defaultWorkerAgent: "general",
    });

    await tool.execute({ action: "on", autonomousStrength: "aggressive" }, createToolContext());

    const state = stateMap.get("s1");
    expect(state?.autonomous_strength).toBe("aggressive");
  });

  test("defaults autonomousStrength to balanced when not specified", async () => {
    const stateMap = new Map<string, ExtendedState>();

    const tool = createAutopilotTool({
      getState: (sessionID) => stateMap.get(sessionID),
      setState: (sessionID, state) => {
        stateMap.set(sessionID, state);
      },
      createSessionState,
      normalizeMaxContinues: () => 10,
      initSession: () => {},
      onArmed: async () => {},
      summarizeState: () => "unused",
      getHistory: () => [],
      onStop: () => {},
      defaultWorkerAgent: "general",
    });

    await tool.execute({ action: "on" }, createToolContext());

    const state = stateMap.get("s1");
    expect(state?.autonomous_strength).toBe("balanced");
  });
});
