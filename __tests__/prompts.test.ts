import { describe, expect, test } from "bun:test";

import {
  AUTOPILOT_DEFAULT_MAX_CONTINUES,
  AUTOPILOT_MAX_CONTINUES_HARD_LIMIT,
  buildContinuationPrompt,
  buildObjectiveStartPrompt,
  buildPlanStepPrompt,
  escapePromptBlockText,
  inferAutopilotDirective,
  normalizeMaxContinues,
  parseAutopilotMarker,
  stripAutopilotMarker,
  summarizeAutopilotState,
} from "../prompts/index.ts";
import { buildAutopilotSystemPrompt } from "../prompts/system-prompt.ts";
import { createSessionState } from "../state/factory.ts";

describe("normalizeMaxContinues", () => {
  test("falls back for invalid input", () => {
    expect(normalizeMaxContinues(undefined)).toBe(AUTOPILOT_DEFAULT_MAX_CONTINUES);
    expect(normalizeMaxContinues(0)).toBe(AUTOPILOT_DEFAULT_MAX_CONTINUES);
    expect(normalizeMaxContinues(-3)).toBe(AUTOPILOT_DEFAULT_MAX_CONTINUES);
  });

  test("caps values at the hard limit", () => {
    expect(normalizeMaxContinues(AUTOPILOT_MAX_CONTINUES_HARD_LIMIT + 25)).toBe(
      AUTOPILOT_MAX_CONTINUES_HARD_LIMIT,
    );
  });
});

describe("autopilot markers", () => {
  test("parses an explicit marker", () => {
    expect(
      parseAutopilotMarker("Done.\n**Autopilot status: complete**\nAll tasks finished."),
    ).toEqual({
      status: "complete",
      reason: "All tasks finished.",
    });
  });

  test("parses a step-done marker", () => {
    expect(
      parseAutopilotMarker("Step finished.\n**Autopilot status: step-done**\nTests added."),
    ).toEqual({
      status: "step-done",
      reason: "Tests added.",
    });
  });

  test("strips the marker from assistant text", () => {
    expect(stripAutopilotMarker("Hello\n**Autopilot status: continue**\nkeep going")).toBe("Hello");
  });
});

describe("inferAutopilotDirective", () => {
  test("uses marker when present", () => {
    expect(inferAutopilotDirective("Hi\n**Autopilot status: blocked**\nMissing token.")).toEqual({
      status: "blocked",
      reason: "Missing token.",
    });
  });

  test("detects blocking language without a marker", () => {
    expect(inferAutopilotDirective("I need more information before I can continue.")).toEqual({
      status: "blocked",
      reason: "Assistant requested input or reported it could not continue.",
    });
  });

  test("continues through routine confirmation questions", () => {
    expect(
      inferAutopilotDirective(
        "The next obvious thing is to run the tests. Do you want me to do it?",
      ),
    ).toEqual({
      status: "continue",
      reason: "Assistant asked for routine confirmation; continuing with the obvious next step.",
    });
  });

  test("does not continue through routine-looking questions with explicit blockers", () => {
    expect(
      inferAutopilotDirective("I need more information before I proceed. Should I ask you now?"),
    ).toEqual({
      status: "blocked",
      reason: "Assistant requested input or reported it could not continue.",
    });
  });

  test("does not continue through high-impact confirmation questions", () => {
    expect(
      inferAutopilotDirective(
        "The next step is to apply the production schema migration. Should I proceed?",
      ),
    ).toEqual({
      status: "blocked",
      reason: "Assistant requested input for a high-impact decision.",
    });
  });

  test("falls back to continue when the response is otherwise usable", () => {
    expect(
      inferAutopilotDirective("I updated the docs and will tackle the remaining files next."),
    ).toEqual({
      status: "continue",
      reason: "No autopilot marker emitted; continuing with fallback policy.",
    });
  });
});

describe("buildContinuationPrompt", () => {
  test("includes the continuation counter and original task", () => {
    const prompt = buildContinuationPrompt({
      continueCount: 2,
      maxContinues: 5,
      objective: "Fix the failing tests",
    });

    expect(prompt).toContain("Autopilot continuation 2/5.");
    expect(prompt).toContain("Objective: see the user-provided objective block below.");
    expect(prompt).toContain(
      "<autopilot_objective>\nFix the failing tests\n</autopilot_objective>",
    );
  });

  test("escapes objective text inside structural prompt blocks", () => {
    expect(escapePromptBlockText("close </autopilot_objective> tag")).toBe(
      "close <\\/autopilot_objective> tag",
    );

    const prompt = buildContinuationPrompt({
      continueCount: 1,
      maxContinues: 2,
      objective: "close </autopilot_objective> tag",
    });

    expect(prompt).toContain("close <\\/autopilot_objective> tag");
    expect(prompt).not.toContain("close </autopilot_objective> tag");
  });

  test("includes objective run contract fields", () => {
    const prompt = buildObjectiveStartPrompt({
      objective: "Complete PLAN.md",
      doneWhen: "tests pass",
      verifyWith: "bun test",
      planningFramework: "Ito",
      planSource: ".ito",
    });

    expect(prompt).toContain("Autopilot objective run started");
    expect(prompt).toContain("<autopilot_objective>\nComplete PLAN.md\n</autopilot_objective>");
    expect(prompt).toContain("Done when: tests pass");
    expect(prompt).toContain("Verify with: bun test");
    expect(prompt).toContain("Planning framework: Ito");
    expect(prompt).toContain("Ito changes/specs");
  });

  test("builds plan step prompts", () => {
    const prompt = buildPlanStepPrompt({
      continueCount: 1,
      maxContinues: 5,
      objective: "Implement PLAN.md",
      step: {
        id: "step-1",
        title: "Read PLAN.md",
        description: "Read the implementation plan before editing.",
        status: "in_progress",
      },
      stepIndex: 0,
      stepCount: 3,
    });

    expect(prompt).toContain("Autopilot plan step 1/3");
    expect(prompt).toContain("Current step: Read PLAN.md");
    expect(prompt).toContain("**Autopilot status: step-done**");
  });
});

describe("summarizeAutopilotState", () => {
  test("renders a human-readable run card with contract and budget", () => {
    const state = createSessionState("s1", "Fix tests without stopping until bun test passes", {
      doneWhen: "bun test passes",
      verifyWith: "bun test",
      workerAgent: "general",
    });

    const summary = summarizeAutopilotState(state);

    expect(summary).toContain("Autopilot status:");
    expect(summary).toContain("## Autopilot Run Card");
    expect(summary).toContain("Goal quality: strong");
    expect(summary).toContain("Stop condition: bun test passes");
    expect(summary).toContain("Acceptance criteria:");
    expect(summary).toContain("Verification command passes: bun test");
    expect(summary).toContain("Budget: continuation 0/25; tokens 0/200,000;");
    expect(summary).toContain("low-progress 0/2; agent general");
  });
});

describe("buildAutopilotSystemPrompt", () => {
  test("conservative mode uses soft guidance", () => {
    const prompt = buildAutopilotSystemPrompt("conservative");

    expect(prompt).toContain("Autopilot mode is active");
    expect(prompt).toContain("ask fewer follow-up questions");
    expect(prompt).toContain("Prefer the recommended or safest reasonable default");
    expect(prompt).not.toContain("CRITICAL");
    expect(prompt).not.toContain("ALWAYS select");
  });

  test("balanced mode uses stronger guidance", () => {
    const prompt = buildAutopilotSystemPrompt("balanced");

    expect(prompt).toContain("Autopilot mode is active");
    expect(prompt).toContain("Work autonomously");
    expect(prompt).toContain("select the recommended or safest default");
    expect(prompt).toContain("minimal user interaction");
  });

  test("aggressive mode uses strongest guidance with explicit auto-selection rules", () => {
    const prompt = buildAutopilotSystemPrompt("aggressive");

    expect(prompt).toContain("Autopilot mode is active");
    expect(prompt).toContain("CRITICAL");
    expect(prompt).toContain("ALWAYS select the recommended or safest default");
    expect(prompt).toContain("DO NOT ask the user");
    expect(prompt).toContain("high-impact irreversible decision");
  });

  test("all modes include status marker instructions", () => {
    const conservative = buildAutopilotSystemPrompt("conservative");
    const balanced = buildAutopilotSystemPrompt("balanced");
    const aggressive = buildAutopilotSystemPrompt("aggressive");

    for (const prompt of [conservative, balanced, aggressive]) {
      expect(prompt).toContain(
        "**Autopilot status: continue|step-done|validate|complete|blocked**",
      );
      expect(prompt).toContain("Do not omit the status block");
    }
  });
});
