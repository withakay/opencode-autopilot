import { describe, expect, test } from "bun:test";
import { createHelpTool } from "../tools/help.ts";
import { createStartTool } from "../tools/start.ts";

describe("Help Tool", () => {
  test("autopilot_help returns usage instructions", async () => {
    const tool = createHelpTool();
    const result = await tool.execute({}, { sessionID: "s1", messageID: "m1", agent: "pi" } as any);
    expect(result).toContain("Autopilot Usage");
    expect(result).toContain("Autopilot");
    expect(result).toContain("status");
  });
});

describe("Start Tool Help Fallback", () => {
  test("returns help when task is 'help'", async () => {
    const deps = {
      getState: () => undefined,
      setState: () => {},
      createSessionState: () => ({}) as any,
      normalizeMaxContinues: () => 10,
      initSession: () => {},
      onArmed: async () => {},
      defaultWorkerAgent: "pi",
    };
    const tool = createStartTool(deps);
    const result = await tool.execute({ task: "help" }, {
      sessionID: "s1",
      messageID: "m1",
      agent: "pi",
    } as any);
    expect(result).toContain("Autopilot Usage");
    expect(result).toContain("Autopilot");
  });

  test("returns help when task is 'Help' (case insensitive)", async () => {
    const deps = {
      getState: () => undefined,
      setState: () => {},
      createSessionState: () => ({}) as any,
      normalizeMaxContinues: () => 10,
      initSession: () => {},
      onArmed: async () => {},
      defaultWorkerAgent: "pi",
    };
    const tool = createStartTool(deps);
    const result = await tool.execute({ task: "Help" }, {
      sessionID: "s1",
      messageID: "m1",
      agent: "pi",
    } as any);
    expect(result).toContain("Autopilot Usage");
  });
});
