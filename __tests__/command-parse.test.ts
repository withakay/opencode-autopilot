import { describe, expect, test } from "bun:test";
import { parseAutopilotCommand } from "../command/parse.ts";

describe("parseAutopilotCommand — keywords", () => {
  test("empty text is help", () => {
    expect(parseAutopilotCommand("")).toEqual({ action: "help" });
    expect(parseAutopilotCommand("   ")).toEqual({ action: "help" });
  });

  test("help keyword", () => {
    expect(parseAutopilotCommand("help").action).toBe("help");
    expect(parseAutopilotCommand("HELP").action).toBe("help");
  });

  test("all keyword actions", () => {
    for (const keyword of ["on", "off", "stop", "pause", "resume", "clear", "status"] as const) {
      expect(parseAutopilotCommand(keyword).action).toBe(keyword);
    }
  });

  test("keyword with flags keeps the keyword action", () => {
    const parsed = parseAutopilotCommand("on --limited --max=5");
    expect(parsed.action).toBe("on");
    expect(parsed.permissionMode).toBe("limited");
    expect(parsed.maxContinues).toBe(5);
  });

  test("resume with permission flag", () => {
    const parsed = parseAutopilotCommand("resume --allow-all");
    expect(parsed.action).toBe("resume");
    expect(parsed.permissionMode).toBe("allow-all");
  });
});

describe("parseAutopilotCommand — objectives", () => {
  test("plain objective becomes a start action", () => {
    const parsed = parseAutopilotCommand("Fix the failing tests");
    expect(parsed.action).toBe("start");
    expect(parsed.objective).toBe("Fix the failing tests");
  });

  test("keyword-looking text with extra words is an objective", () => {
    const parsed = parseAutopilotCommand("stop the server from crashing");
    expect(parsed.action).toBe("start");
    expect(parsed.objective).toBe("stop the server from crashing");
  });

  test("flags are removed from the objective", () => {
    const parsed = parseAutopilotCommand("Fix tests --agent=builder --max=3 --limited");
    expect(parsed.objective).toBe("Fix tests");
    expect(parsed.workerAgent).toBe("builder");
    expect(parsed.maxContinues).toBe(3);
    expect(parsed.permissionMode).toBe("limited");
  });

  test("space-separated flag values", () => {
    const parsed = parseAutopilotCommand("Fix tests --agent builder --max 7");
    expect(parsed.objective).toBe("Fix tests");
    expect(parsed.workerAgent).toBe("builder");
    expect(parsed.maxContinues).toBe(7);
  });

  test("bare max/limited/allow-all forms", () => {
    const parsed = parseAutopilotCommand("Fix tests max 4 allow-all");
    expect(parsed.objective).toBe("Fix tests");
    expect(parsed.maxContinues).toBe(4);
    expect(parsed.permissionMode).toBe("allow-all");

    const limited = parseAutopilotCommand("Fix tests limited");
    expect(limited.permissionMode).toBe("limited");
    expect(limited.objective).toBe("Fix tests");
  });

  test("bare max without a number stays in the objective", () => {
    const parsed = parseAutopilotCommand("raise the max limit");
    expect(parsed.objective).toBe("raise the max limit");
    expect(parsed.maxContinues).toBeUndefined();
  });
});

describe("parseAutopilotCommand — value flags", () => {
  test("duration units", () => {
    expect(parseAutopilotCommand("obj --duration=15m").maxDurationMs).toBe(900_000);
    expect(parseAutopilotCommand("obj --duration=900s").maxDurationMs).toBe(900_000);
    expect(parseAutopilotCommand("obj --duration=900000ms").maxDurationMs).toBe(900_000);
    expect(parseAutopilotCommand("obj --duration=1h").maxDurationMs).toBe(3_600_000);
    expect(parseAutopilotCommand("obj --duration=500").maxDurationMs).toBe(500);
    expect(parseAutopilotCommand("obj --duration=bogus").maxDurationMs).toBeUndefined();
  });

  test("token counts", () => {
    expect(parseAutopilotCommand("obj --tokens=100k").maxTokens).toBe(100_000);
    expect(parseAutopilotCommand("obj --tokens=123456").maxTokens).toBe(123_456);
    expect(parseAutopilotCommand("obj --tokens=abc").maxTokens).toBeUndefined();
  });

  test("quoted verify and done-when", () => {
    const parsed = parseAutopilotCommand('Fix it --verify="bun test" --done-when="tests pass"');
    expect(parsed.objective).toBe("Fix it");
    expect(parsed.verifyWith).toBe("bun test");
    expect(parsed.doneWhen).toBe("tests pass");
  });

  test("strength flag", () => {
    expect(parseAutopilotCommand("obj --strength=aggressive").autonomousStrength).toBe(
      "aggressive",
    );
    expect(parseAutopilotCommand("obj --strength=warp").autonomousStrength).toBeUndefined();
  });
});

describe("parseAutopilotCommand — multi-line input", () => {
  test("list-like extra lines become the plan", () => {
    const parsed = parseAutopilotCommand("Implement PLAN.md\n1. Read PLAN.md\n2. Implement");
    expect(parsed.action).toBe("start");
    expect(parsed.objective).toBe("Implement PLAN.md");
    expect(parsed.plan).toBe("1. Read PLAN.md\n2. Implement");
  });

  test("bullet lines become the plan", () => {
    const parsed = parseAutopilotCommand("Do the thing\n- first\n- second");
    expect(parsed.plan).toBe("- first\n- second");
  });

  test("non-list extra lines extend the objective", () => {
    const parsed = parseAutopilotCommand("Do the thing\nwith care and detail");
    expect(parsed.objective).toBe("Do the thing\nwith care and detail");
    expect(parsed.plan).toBeUndefined();
  });

  test("multi-line with a keyword first line is still an objective run", () => {
    const parsed = parseAutopilotCommand("resume\n1. step one");
    expect(parsed.action).toBe("start");
    expect(parsed.objective).toBe("resume");
    expect(parsed.plan).toBe("1. step one");
  });

  test("deterministic: same input yields same output", () => {
    const text = "Fix tests --max=3\n1. a\n2. b";
    expect(parseAutopilotCommand(text)).toEqual(parseAutopilotCommand(text));
  });
});
