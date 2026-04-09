import { describe, expect, test } from "bun:test";

import {
  AUTOPILOT_DEFAULT_MAX_CONTINUES,
  AUTOPILOT_MAX_CONTINUES_HARD_LIMIT,
  buildContinuationPrompt,
  inferAutopilotDirective,
  normalizeMaxContinues,
  parseAutopilotMarker,
  stripAutopilotMarker,
} from "../prompts/index.ts";
import { buildAutopilotSystemPrompt } from "../prompts/system-prompt.ts";

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
      parseAutopilotMarker('Done.\n<autopilot status="complete">All tasks finished.</autopilot>'),
    ).toEqual({
      status: "complete",
      reason: "All tasks finished.",
    });
  });

  test("strips the marker from assistant text", () => {
    expect(stripAutopilotMarker('Hello\n<autopilot status="continue">keep going</autopilot>')).toBe(
      "Hello",
    );
  });
});

describe("inferAutopilotDirective", () => {
  test("uses marker when present", () => {
    expect(
      inferAutopilotDirective('Hi\n<autopilot status="blocked">Missing token.</autopilot>'),
    ).toEqual({
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
      task: "Fix the failing tests",
    });

    expect(prompt).toContain("Autopilot continuation 2/5.");
    expect(prompt).toContain("Original task: Fix the failing tests");
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
      expect(prompt).toContain('<autopilot status="continue|validate|complete|blocked">');
      expect(prompt).toContain("Do not omit the marker");
    }
  });
});
