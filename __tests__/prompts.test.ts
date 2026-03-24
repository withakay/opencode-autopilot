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

describe("normalizeMaxContinues", () => {
  test("falls back for invalid input", () => {
    expect(normalizeMaxContinues(undefined)).toBe(
      AUTOPILOT_DEFAULT_MAX_CONTINUES,
    );
    expect(normalizeMaxContinues(0)).toBe(AUTOPILOT_DEFAULT_MAX_CONTINUES);
    expect(normalizeMaxContinues(-3)).toBe(AUTOPILOT_DEFAULT_MAX_CONTINUES);
  });

  test("caps values at the hard limit", () => {
    expect(
      normalizeMaxContinues(AUTOPILOT_MAX_CONTINUES_HARD_LIMIT + 25),
    ).toBe(AUTOPILOT_MAX_CONTINUES_HARD_LIMIT);
  });
});

describe("autopilot markers", () => {
  test("parses an explicit marker", () => {
    expect(
      parseAutopilotMarker(
        'Done.\n<autopilot status="complete">All tasks finished.</autopilot>',
      ),
    ).toEqual({
      status: "complete",
      reason: "All tasks finished.",
    });
  });

  test("strips the marker from assistant text", () => {
    expect(
      stripAutopilotMarker(
        'Hello\n<autopilot status="continue">keep going</autopilot>',
      ),
    ).toBe("Hello");
  });
});

describe("inferAutopilotDirective", () => {
  test("uses marker when present", () => {
    expect(
      inferAutopilotDirective(
        'Hi\n<autopilot status="blocked">Missing token.</autopilot>',
      ),
    ).toEqual({
      status: "blocked",
      reason: "Missing token.",
    });
  });

  test("detects blocking language without a marker", () => {
    expect(
      inferAutopilotDirective("I need more information before I can continue."),
    ).toEqual({
      status: "blocked",
      reason: "Assistant requested input or reported it could not continue.",
    });
  });

  test("falls back to continue when the response is otherwise usable", () => {
    expect(
      inferAutopilotDirective(
        "I updated the docs and will tackle the remaining files next.",
      ),
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
