import { describe, expect, test } from "bun:test";

import { dispatchEffect, persistSnapshot, restoreSnapshot } from "../effects/index.ts";
import { createSessionState } from "../state/factory.ts";
import type { ExtendedState } from "../types/index.ts";

function createState(overrides: Partial<ExtendedState> = {}): ExtendedState {
  return {
    ...createSessionState("effects-session", "Exercise effects", {
      allowedPaths: ["plugins/autopilot"],
      trustedPaths: ["plugins/autopilot"],
      allowedTools: ["bash", "read", "glob", "grep", "apply_patch"],
    }),
    ...overrides,
  };
}

describe("dispatchEffect", () => {
  test("rejects inadmissible run-tool effects", async () => {
    const state = createState({
      trust_state: {
        status: "untrusted",
        trusted_paths: [],
        pending_path: null,
        denied_paths: [],
        last_feedback: null,
      },
    });

    const event = await dispatchEffect(
      {
        kind: "RUN_TOOL",
        tool_name: "read",
        invocation_id: "inv-1",
        arguments: {},
        target_paths: ["plugins/autopilot"],
        summary: "Inspect plugin",
        risky: false,
        metadata: {},
      },
      { state },
    );

    expect(event.event_type).toBe("TOOL_ERROR");
    if (event.event_type === "TOOL_ERROR") {
      expect(event.payload.error_code).toBe("INADMISSIBLE_EFFECT");
    }
  });

  test("converts tool success into TOOL_RESULT", async () => {
    const state = createState();

    const event = await dispatchEffect(
      {
        kind: "RUN_TOOL",
        tool_name: "read",
        invocation_id: "inv-2",
        arguments: {},
        target_paths: ["plugins/autopilot"],
        summary: "Inspect plugin",
        risky: false,
        metadata: {},
      },
      {
        state,
        handlers: {
          runTool: async () => ({
            ok: true,
            summary: "Read succeeded",
            changed_paths: [],
            completed_at: "2026-03-24T10:30:00Z",
          }),
        },
      },
    );

    expect(event.event_type).toBe("TOOL_RESULT");
    if (event.event_type === "TOOL_RESULT") {
      expect(event.payload.summary).toBe("Read succeeded");
    }
  });

  test("converts approval decisions into approval events", async () => {
    const state = createState();

    const granted = await dispatchEffect(
      {
        kind: "REQUEST_APPROVAL",
        approval_scope: "plugins/autopilot",
        approved_action: "Run tests",
        justification: "Need validation",
        metadata: {},
      },
      {
        state,
        handlers: {
          requestApproval: async () => ({ granted: true }),
        },
      },
    );

    const denied = await dispatchEffect(
      {
        kind: "REQUEST_APPROVAL",
        approval_scope: "plugins/autopilot",
        approved_action: "Run tests",
        justification: "Need validation",
        metadata: {},
      },
      {
        state,
        handlers: {
          requestApproval: async () => ({
            granted: false,
            user_feedback: "Not now",
          }),
        },
      },
    );

    expect(granted.event_type).toBe("APPROVAL_GRANTED");
    expect(denied.event_type).toBe("APPROVAL_DENIED");
  });
});

describe("snapshot persistence", () => {
  test("round-trips state safely", () => {
    const state = createState({
      completion_evidence: ["before snapshot"],
    });

    persistSnapshot(state);
    const restored = restoreSnapshot(state.session_id);

    expect(restored).not.toBeNull();
    expect(restored?.completion_evidence).toEqual(["before snapshot"]);

    if (restored) {
      restored.completion_evidence.push("after restore");
    }

    expect(restoreSnapshot(state.session_id)?.completion_evidence).toEqual([
      "before snapshot",
    ]);
  });
});
