import { describe, expect, test } from "bun:test";

import { createEvent, validateEvent } from "../events/index.ts";

describe("validateEvent", () => {
  test("accepts a valid user input event", () => {
    const result = validateEvent({
      event_id: "evt-1",
      event_type: "USER_INPUT",
      occurred_at: "2026-03-24T10:30:00Z",
      source: "USER",
      correlation_id: null,
      causation_id: null,
      phase_at_emit: "OBSERVE",
      payload: {
        message: "Continue",
        attachments: [],
        requested_mode_change: "ENABLED",
        referenced_paths: ["plugins/autopilot"],
        metadata: {},
      },
    });

    expect(result.ok).toBe(true);
  });

  test("rejects malformed payloads", () => {
    const result = validateEvent({
      event_id: "evt-2",
      event_type: "TOOL_RESULT",
      occurred_at: "2026-03-24T10:30:00Z",
      source: "TOOL_DISPATCHER",
      correlation_id: null,
      causation_id: null,
      phase_at_emit: "EXECUTE",
      payload: {
        tool_name: "bash",
        invocation_id: "inv-1",
        status: "success",
        summary: "ok",
        output_ref: null,
        changed_paths: [],
        completed_at: "2026-03-24T10:30:10Z",
        metadata: {},
      },
    });

    expect(result.ok).toBe(false);
  });

  test("rejects malformed identifiers", () => {
    const result = validateEvent({
      event_id: "evt invalid",
      event_type: "INTERRUPT",
      occurred_at: "2026-03-24T10:30:00Z",
      source: "SESSION_MANAGER",
      correlation_id: null,
      causation_id: null,
      phase_at_emit: "DECIDE",
      payload: {
        interrupt_type: "user_cancel",
        message: null,
        metadata: {},
      },
    });

    expect(result).toEqual({
      ok: false,
      error: "event_id is not well-formed",
    });
  });
});

describe("createEvent", () => {
  test("factory output validates", () => {
    const event = createEvent(
      "TOOL_ERROR",
      {
        tool_name: "bash",
        invocation_id: "inv-55",
        status: "error",
        error_code: "EXIT_NONZERO",
        message: "Tests failed",
        stderr_ref: "artifact://stderr/inv-55",
        retryable_hint: true,
        started_at: "2026-03-24T10:29:45Z",
        completed_at: "2026-03-24T10:30:00Z",
        metadata: {},
      },
      {
        source: "TOOL_DISPATCHER",
        correlation_id: "op-88",
        causation_id: "evt-1041",
        phase_at_emit: "EXECUTE",
      },
    );

    const result = validateEvent(event);
    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.event.event_type).toBe("TOOL_ERROR");
      expect(result.event.source).toBe("TOOL_DISPATCHER");
    }
  });
});
