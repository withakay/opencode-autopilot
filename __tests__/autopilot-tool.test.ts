import { describe, expect, test } from "bun:test";
import { createAutopilotPlugin } from "../plugin.ts";
import { normalizeAutopilotToolInput } from "../tools/autopilot.ts";
import { parsePlan } from "../tools/plan.ts";
import type { FakeContext, ToolDef } from "./helpers.ts";
import { createFakeContext } from "./helpers.ts";

async function startTool(harness: FakeContext): Promise<{
  tool: ToolDef;
  cleanup: (() => Promise<void> | void) | void;
}> {
  const cleanup = await createAutopilotPlugin(harness.ctx);
  const tool = harness.tools.find((definition) => definition.name === "autopilot");
  if (!tool) throw new Error("expected the autopilot tool to be registered");
  return { tool, cleanup };
}

describe("plan parsing", () => {
  test("parses plain-text plans", () => {
    expect(parsePlan("1. Read PLAN.md\n2. Implement changes\n- Run tests")).toMatchObject([
      { id: "step-1", title: "Read PLAN.md", status: "pending" },
      { id: "step-2", title: "Implement changes", status: "pending" },
      { id: "step-3", title: "Run tests", status: "pending" },
    ]);
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
});

describe("normalizeAutopilotToolInput", () => {
  test("keeps valid fields and drops invalid ones", () => {
    const args = normalizeAutopilotToolInput({
      action: "start",
      objective: "Fix tests",
      permissionMode: "limited",
      autonomousStrength: "warp",
      maxContinues: 5,
      maxTokens: -1,
      workerAgent: "  ",
    });
    expect(args.action).toBe("start");
    expect(args.objective).toBe("Fix tests");
    expect(args.permissionMode).toBe("limited");
    expect(args.autonomousStrength).toBeUndefined();
    expect(args.maxContinues).toBe(5);
    expect(args.maxTokens).toBeUndefined();
    expect(args.workerAgent).toBeUndefined();
  });

  test("tolerates non-object input", () => {
    expect(normalizeAutopilotToolInput(null)).toEqual(normalizeAutopilotToolInput("nope"));
  });
});

describe("autopilot tool (registered through tool.transform)", () => {
  test("help returns usage text", async () => {
    const harness = createFakeContext();
    const { tool, cleanup } = await startTool(harness);

    const result = await tool.execute({ action: "help" }, { sessionID: "s1" });
    expect(result.content).toContain("Autopilot Usage");
    expect(result.content).toContain("/autopilot on");

    await cleanup?.();
  });

  test("on enables ambient autonomy without dispatching a worker prompt", async () => {
    const harness = createFakeContext();
    const { tool, cleanup } = await startTool(harness);

    const result = await tool.execute({ action: "on" }, { sessionID: "s1" });
    expect(result.content).toContain("Autopilot is enabled");
    expect(harness.syntheticCalls).toHaveLength(0);

    const status = await harness.status("s1");
    expect(status.active).toBe(true);
    expect(status.text).toContain("run_mode=ambient");

    await cleanup?.();
  });

  test("start dispatches the first worker prompt in the same call", async () => {
    const harness = createFakeContext();
    const { tool, cleanup } = await startTool(harness);

    const result = await tool.execute(
      {
        action: "start",
        objective: "Fix tests without stopping until bun test passes",
        doneWhen: "bun test passes",
        verifyWith: "bun test",
      },
      { sessionID: "s1" },
    );

    expect(result.content).toContain("Autopilot objective run started");
    expect(harness.syntheticCalls).toHaveLength(1);
    const status = await harness.status("s1");
    expect(status.text).toContain("run_mode=objective");
    expect(status.text).toContain('done_when="bun test passes"');

    await cleanup?.();
  });

  test("objective aliases start a run", async () => {
    const harness = createFakeContext();
    const { tool, cleanup } = await startTool(harness);

    const result = await tool.execute({ target: "Fix the tests" }, { sessionID: "s1" });
    expect(result.content).toContain("Autopilot objective run started");
    expect(harness.syntheticCalls).toHaveLength(1);

    await cleanup?.();
  });

  test("refuses an objective run without a target", async () => {
    const harness = createFakeContext();
    const { tool, cleanup } = await startTool(harness);

    const result = await tool.execute({ action: "start" }, { sessionID: "s1" });
    expect(result.content).toContain("need a target");
    expect(harness.syntheticCalls).toHaveLength(0);

    await cleanup?.();
  });

  test("stop and clear manage the run and interrupt the worker", async () => {
    const harness = createFakeContext();
    const { tool, cleanup } = await startTool(harness);

    await tool.execute({ action: "start", objective: "Fix tests" }, { sessionID: "s1" });
    const stopped = await tool.execute({ action: "off" }, { sessionID: "s1" });
    expect(stopped.content).toContain("Autopilot stopped");
    expect(harness.interruptCalls).toHaveLength(1);

    const cleared = await tool.execute({ action: "clear" }, { sessionID: "s1" });
    expect(cleared.content).toContain("cleared");
    expect(harness.storageMap.has("state/s1")).toBe(false);

    await cleanup?.();
  });

  test("status output contains the run card and stripped markers", async () => {
    const harness = createFakeContext();
    const { tool, cleanup } = await startTool(harness);

    await tool.execute({ action: "start", objective: "Fix tests" }, { sessionID: "s1" });
    const status = await tool.execute({ action: "status" }, { sessionID: "s1" });
    expect(status.content).toContain("Autopilot Run Card");
    expect(status.content).not.toMatch(/\*\*Autopilot status: (continue|complete)\*\*\s*$/);

    await cleanup?.();
  });

  test("worker agent switch is requested for --agent style starts", async () => {
    const harness = createFakeContext({ agent: "pi" });
    const { tool, cleanup } = await startTool(harness);

    await tool.execute(
      { action: "start", objective: "Fix tests", workerAgent: "builder" },
      { sessionID: "s1" },
    );
    expect(harness.switchAgentCalls).toEqual([{ sessionID: "s1", agent: "builder" }]);

    await cleanup?.();
  });
});
