import { describe, expect, test } from "bun:test";

import { createEvent } from "../events/index.ts";
import {
  backgroundWaitIsBestOption,
  completionPredicate,
  noProgressDetected,
  recoverable,
  reduce,
  retryableFailure,
} from "../reducer/index.ts";
import { createSessionState } from "../state/factory.ts";
import type { ExtendedState, PlanItem } from "../types/index.ts";

function createPlanItem(
  id: string,
  description: string,
  overrides: Partial<PlanItem> = {},
): PlanItem {
  return {
    id,
    description,
    status: "pending",
    required: true,
    dependencies: [],
    evidence: [],
    metadata: {},
    ...overrides,
  };
}

function createBaseState(overrides: Partial<ExtendedState> = {}): ExtendedState {
  return {
    ...createSessionState("session-1", "Ship the autopilot reducer", {
      allowedPaths: ["plugins/autopilot"],
      trustedPaths: ["plugins/autopilot"],
      allowedTools: ["bash", "read", "glob", "grep", "apply_patch"],
    }),
    ...overrides,
  };
}

describe("reduce", () => {
  test("normal completion path", () => {
    const state = createBaseState({
      phase: "ORIENT",
      plan_state: {
        steps: [createPlanItem("step-1", "Finish reducer", { status: "completed" })],
        open_items: [],
        completed_items: [],
        blocked_items: [],
        dependencies: {},
        stale: true,
      },
      completion_evidence: ["tests passed"],
    });

    const result = reduce(
      state,
      createEvent(
        "TIMER",
        { timer_name: "tick", deadline_at: null, metadata: {} },
        { phase_at_emit: "ORIENT" },
      ),
    );

    expect(result.nextState.phase).toBe("STOPPED");
    expect(result.nextState.stop_reason).toBe("COMPLETED");
    expect(result.effects.some((effect) => effect.kind === "EMIT_FINAL_RESPONSE")).toBe(true);
  });

  test("approval-required path", () => {
    const state = createBaseState({
      phase: "DECIDE",
      foreground_action: {
        kind: "RUN_TOOL",
        tool_name: "bash",
        target_path: "plugins/autopilot",
        summary: "Run tests",
        risky: true,
        async: false,
        metadata: {},
      },
    });

    const result = reduce(
      state,
      createEvent(
        "TIMER",
        { timer_name: "tick", deadline_at: null, metadata: {} },
        { phase_at_emit: "DECIDE" },
      ),
    );

    expect(result.nextState.phase).toBe("EXECUTE");
    expect(result.effects.some((effect) => effect.kind === "REQUEST_APPROVAL")).toBe(true);
  });

  test("trust-required path", () => {
    const state = createBaseState({
      phase: "DECIDE",
      trust_state: {
        status: "untrusted",
        trusted_paths: [],
        pending_path: null,
        denied_paths: [],
        last_feedback: null,
      },
      foreground_action: {
        kind: "RUN_TOOL",
        tool_name: "read",
        target_path: "plugins/autopilot",
        summary: "Inspect plugin code",
        risky: false,
        async: false,
        metadata: {},
      },
    });

    const result = reduce(
      state,
      createEvent(
        "TIMER",
        { timer_name: "tick", deadline_at: null, metadata: {} },
        { phase_at_emit: "DECIDE" },
      ),
    );

    expect(result.nextState.phase).toBe("EXECUTE");
    expect(result.effects.some((effect) => effect.kind === "REQUEST_TRUST")).toBe(true);
  });

  test("context-compaction path", () => {
    const state = createBaseState({
      phase: "DECIDE",
      context_state: {
        remaining_budget: 100,
        threshold: 200,
        compaction_needed: true,
        compacted_at: null,
        unsafe_to_continue: true,
      },
    });

    const result = reduce(
      state,
      createEvent(
        "CONTEXT_LOW",
        {
          remaining_budget: 100,
          threshold: 200,
          compaction_recommended: true,
          metadata: {},
        },
        { phase_at_emit: "DECIDE", source: "CONTEXT_MANAGER" },
      ),
    );

    expect(result.nextState.phase).toBe("EXECUTE");
    expect(result.effects.some((effect) => effect.kind === "COMPACT_CONTEXT")).toBe(true);
  });

  test("retryable tool failure path", () => {
    const state = createBaseState({
      phase: "EVALUATE",
      latest_observations: {
        ...createBaseState().latest_observations,
        last_tool_error: createEvent(
          "TOOL_ERROR",
          {
            tool_name: "bash",
            invocation_id: "inv-1",
            status: "error",
            error_code: "EXIT_1",
            message: "retry me",
            stderr_ref: null,
            retryable_hint: true,
            started_at: null,
            completed_at: "2026-03-24T10:30:00Z",
            metadata: {},
          },
          { phase_at_emit: "EXECUTE", source: "TOOL_DISPATCHER" },
        ),
      },
    });

    expect(retryableFailure(state)).toBe(true);

    const result = reduce(
      state,
      createEvent(
        "TIMER",
        { timer_name: "tick", deadline_at: null, metadata: {} },
        { phase_at_emit: "EVALUATE" },
      ),
    );

    expect(result.nextState.phase).toBe("RECOVER");
  });

  test("irrecoverable failure path", () => {
    const state = createBaseState({
      phase: "EVALUATE",
      retry_counters: {
        ...createBaseState().retry_counters,
        step_retry_count: 3,
        max_step_retries: 3,
      },
      latest_observations: {
        ...createBaseState().latest_observations,
        last_tool_error: createEvent(
          "TOOL_ERROR",
          {
            tool_name: "bash",
            invocation_id: "inv-2",
            status: "error",
            error_code: "EXIT_1",
            message: "fatal",
            stderr_ref: null,
            retryable_hint: false,
            started_at: null,
            completed_at: "2026-03-24T10:30:00Z",
            metadata: {},
          },
          { phase_at_emit: "EXECUTE", source: "TOOL_DISPATCHER" },
        ),
      },
    });

    expect(retryableFailure(state)).toBe(false);
  });

  test("non-progress limit behavior", () => {
    const state = createBaseState({
      retry_counters: {
        ...createBaseState().retry_counters,
        no_progress_count: 3,
        max_no_progress: 3,
      },
    });

    expect(noProgressDetected(state)).toBe(true);
  });

  test("blocked-to-resumed path", () => {
    const state = createBaseState({
      phase: "BLOCKED",
      stop_reason: "WAITING_FOR_APPROVAL",
    });

    const result = reduce(
      state,
      createEvent(
        "APPROVAL_GRANTED",
        {
          approval_scope: "plugins/autopilot",
          approved_action: "Run tests",
          approved_until: null,
          session_scoped: true,
          metadata: {},
        },
        { phase_at_emit: "BLOCKED", source: "APPROVAL_SYSTEM" },
      ),
    );

    expect(result.nextState.phase).toBe("OBSERVE");
    expect(result.nextState.stop_reason).toBeNull();
  });

  test("stopped-to-resumed path", () => {
    const state = createBaseState({
      phase: "STOPPED",
      stop_reason: "USER_STOP",
    });

    const result = reduce(
      state,
      createEvent(
        "RESUME_REQUESTED",
        {
          resume_token: null,
          source_session_id: "session-1",
          metadata: {},
        },
        { phase_at_emit: "STOPPED", source: "SESSION_MANAGER" },
      ),
    );

    expect(result.nextState.phase).toBe("OBSERVE");
    expect(result.nextState.stop_reason).toBeNull();
  });

  test("background task integration", () => {
    const state = createBaseState({
      background_tasks: [
        {
          task_id: "bg-1",
          status: "running",
          summary: "Long test run",
          output_ref: null,
          started_at: "2026-03-24T10:00:00Z",
          updated_at: "2026-03-24T10:00:00Z",
          metadata: {},
        },
      ],
    });

    expect(backgroundWaitIsBestOption(state)).toBe(true);
    expect(recoverable(state)).toBe(true);
  });
});

describe("completionPredicate", () => {
  test("requires evidence and no open items", () => {
    const incomplete = createBaseState({
      completion_evidence: [],
      plan_state: {
        steps: [createPlanItem("step-1", "Do work")],
        open_items: ["step-1"],
        completed_items: [],
        blocked_items: [],
        dependencies: {},
        stale: false,
      },
    });

    const complete = createBaseState({
      completion_evidence: ["done"],
      plan_state: {
        steps: [createPlanItem("step-1", "Do work", { status: "completed" })],
        open_items: [],
        completed_items: ["step-1"],
        blocked_items: [],
        dependencies: {},
        stale: false,
      },
    });

    expect(completionPredicate(incomplete)).toBe(false);
    expect(completionPredicate(complete)).toBe(true);
  });
});
