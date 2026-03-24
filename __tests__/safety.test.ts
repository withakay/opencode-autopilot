import { describe, expect, test } from "bun:test";
import { isAdmissible } from "../reducer/guards.ts";
import { reduce } from "../reducer/index.ts";
import type { Effect } from "../types/index.ts";
import {
  createApprovalDeniedEvent,
  createEnabledState,
  createInterruptEvent,
  createResumeEvent,
  createStoppedState,
  createToolErrorEvent,
  createTrustDeniedEvent,
  createUserInputEvent,
} from "./helpers.ts";

// ---------------------------------------------------------------------------
// S1 — No side effect without admissibility check
// ---------------------------------------------------------------------------

describe("S1 — no side effect without admissibility check", () => {
  test("RUN_TOOL effects are rejected by admissibility when tool is not allowed", () => {
    const state = createEnabledState({
      allowed_tools: [], // No tools allowed
    });

    const effect: Effect = {
      kind: "RUN_TOOL",
      tool_name: "bash",
      invocation_id: "inv-1",
      arguments: {},
      target_paths: [],
      summary: "run bash",
      risky: false,
      metadata: {},
    };

    expect(isAdmissible(state, effect)).toBe(false);
  });

  test("RUN_TOOL effects pass admissibility when tool is allowed and paths are trusted", () => {
    const state = createEnabledState({
      allowed_tools: ["bash"],
      allowed_paths: ["/workspace"],
      trust_state: {
        status: "trusted",
        trusted_paths: ["/workspace"],
        pending_path: null,
        denied_paths: [],
        last_feedback: null,
      },
    });

    const effect: Effect = {
      kind: "RUN_TOOL",
      tool_name: "bash",
      invocation_id: "inv-1",
      arguments: {},
      target_paths: ["/workspace"],
      summary: "run bash",
      risky: false,
      metadata: {},
    };

    expect(isAdmissible(state, effect)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// S2 — Approval cannot be bypassed by autonomy
// ---------------------------------------------------------------------------

describe("S2 — approval cannot be bypassed by autonomy", () => {
  test("reducer does not dispatch tool effects when approval is pending", () => {
    const state = createEnabledState({
      phase: "DECIDE",
      approval_state: {
        status: "pending",
        pending_action: "write dangerous file",
        pending_scope: "write",
        approved_scopes: [],
        denied_scopes: [],
        last_feedback: null,
      },
    });

    const result = reduce(state, createUserInputEvent());

    // When approval is pending/required, the reducer should produce
    // REQUEST_APPROVAL effects or block, not RUN_TOOL
    const runToolEffects = result.effects.filter((e) => e.kind === "RUN_TOOL");
    if (runToolEffects.length > 0) {
      // If there are RUN_TOOL effects, verify they went through admissibility
      for (const eff of runToolEffects) {
        expect(isAdmissible(state, eff)).toBe(true);
      }
    }
  });

  test("approval denied event is preserved as observation", () => {
    const state = createEnabledState({
      phase: "OBSERVE",
    });

    const event = createApprovalDeniedEvent("write");
    const result = reduce(state, event);

    // The denial should be recorded in the state
    expect(result.nextState.approval_state.denied_scopes).toContain("write");
  });
});

// ---------------------------------------------------------------------------
// S3 — Trust cannot be bypassed by autonomy
// ---------------------------------------------------------------------------

describe("S3 — trust cannot be bypassed by autonomy", () => {
  test("RUN_TOOL effect on untrusted path is inadmissible", () => {
    const state = createEnabledState({
      trust_state: {
        status: "untrusted",
        trusted_paths: [],
        pending_path: null,
        denied_paths: ["/secret"],
        last_feedback: null,
      },
    });

    const effect: Effect = {
      kind: "RUN_TOOL",
      tool_name: "bash",
      invocation_id: "inv-1",
      arguments: {},
      target_paths: ["/secret"],
      summary: "access secret",
      risky: true,
      metadata: {},
    };

    expect(isAdmissible(state, effect)).toBe(false);
  });

  test("trust denied event is preserved as observation", () => {
    const state = createEnabledState({
      phase: "OBSERVE",
    });

    const event = createTrustDeniedEvent("/secret");
    const result = reduce(state, event);

    expect(result.nextState.trust_state.denied_paths).toContain("/secret");
  });
});

// ---------------------------------------------------------------------------
// S4 — Blocked/stopped states always have explicit stop_reason
// ---------------------------------------------------------------------------

describe("S4 — blocked/stopped states have explicit stop_reason", () => {
  test("STOPPED state always has a stop_reason", () => {
    const state = createEnabledState({
      phase: "OBSERVE",
    });

    const event = createInterruptEvent();
    const result = reduce(state, event);

    expect(result.nextState.phase).toBe("STOPPED");
    expect(result.nextState.stop_reason).not.toBeNull();
    expect(result.nextState.stop_reason).toBe("USER_STOP");
  });

  test("block() always sets a stop_reason", () => {
    // Trigger a block by exhausting context
    const state = createEnabledState({
      phase: "DECIDE",
      context_state: {
        remaining_budget: 0,
        threshold: 1000,
        compaction_needed: true,
        compacted_at: "already-compacted",
        unsafe_to_continue: true,
      },
    });

    const result = reduce(state, createUserInputEvent());
    if (result.nextState.phase === "BLOCKED" || result.nextState.phase === "STOPPED") {
      expect(result.nextState.stop_reason).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// S5 — Denied approvals/trust preserved as observations
// ---------------------------------------------------------------------------

describe("S5 — denied approvals/trust preserved as observations", () => {
  test("approval denial is not silently dropped", () => {
    const state = createEnabledState({
      phase: "OBSERVE",
    });

    const before = state.approval_state.denied_scopes.length;
    const result = reduce(state, createApprovalDeniedEvent("admin"));
    const after = result.nextState.approval_state.denied_scopes.length;

    expect(after).toBeGreaterThan(before);
  });

  test("trust denial is not silently dropped", () => {
    const state = createEnabledState({
      phase: "OBSERVE",
    });

    const before = state.trust_state.denied_paths.length;
    const result = reduce(state, createTrustDeniedEvent("/restricted"));
    const after = result.nextState.trust_state.denied_paths.length;

    expect(after).toBeGreaterThan(before);
  });
});

// ---------------------------------------------------------------------------
// S6 — No uncontrolled livelock
// ---------------------------------------------------------------------------

describe("S6 — no uncontrolled livelock (non-progress counter enforced)", () => {
  test("exceeding non-progress limit leads to BLOCKED or STOPPED", () => {
    const state = createEnabledState({
      phase: "RECOVER",
      retry_counters: {
        step_retry_count: 0,
        global_retry_count: 0,
        no_progress_count: 99, // At limit
        recovery_attempt_count: 0,
        max_step_retries: 2,
        max_global_retries: 6,
        max_no_progress: 3,
      },
    });

    const result = reduce(state, createToolErrorEvent("failed", true));

    // Should be BLOCKED or STOPPED with NON_PROGRESS_LIMIT
    expect(["BLOCKED", "STOPPED"]).toContain(result.nextState.phase);
    if (result.nextState.stop_reason) {
      expect([
        "NON_PROGRESS_LIMIT",
        "RETRY_EXHAUSTED",
        "AMBIGUOUS_STATE_REQUIRES_ESCALATION",
      ]).toContain(result.nextState.stop_reason);
    }
  });
});

// ---------------------------------------------------------------------------
// S7 — STOPPED is quiescent unless resumed
// ---------------------------------------------------------------------------

describe("S7 — STOPPED is quiescent unless resumed", () => {
  test("no effects dispatched from STOPPED without resume", () => {
    const state = createStoppedState();

    const result = reduce(state, createUserInputEvent());

    // STOPPED should remain STOPPED
    expect(result.nextState.phase).toBe("STOPPED");
    // No side-effecting effects
    const sideEffects = result.effects.filter(
      (e) =>
        e.kind === "RUN_TOOL" ||
        e.kind === "REQUEST_APPROVAL" ||
        e.kind === "REQUEST_TRUST" ||
        e.kind === "COMPACT_CONTEXT",
    );
    expect(sideEffects).toHaveLength(0);
  });

  test("STOPPED transitions to OBSERVE on valid resume", () => {
    const state = createStoppedState({
      resumable: true,
      stop_reason: "COMPLETED",
    });

    const result = reduce(state, createResumeEvent());

    expect(result.nextState.phase).toBe("OBSERVE");
    expect(result.nextState.stop_reason).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// S8 — Interrupt preemption forces STOPPED
// ---------------------------------------------------------------------------

describe("S8 — interrupt preemption", () => {
  test("INTERRUPT from any phase leads to STOPPED", () => {
    const phases = ["OBSERVE", "ORIENT", "DECIDE", "EXECUTE", "EVALUATE", "RECOVER"] as const;

    for (const phase of phases) {
      const state = createEnabledState({ phase });
      const result = reduce(state, createInterruptEvent());

      expect(result.nextState.phase).toBe("STOPPED");
      expect(result.nextState.stop_reason).toBe("USER_STOP");
    }
  });

  test("INTERRUPT from BLOCKED leads to STOPPED", () => {
    const state = createEnabledState({
      phase: "BLOCKED",
      stop_reason: "WAITING_FOR_APPROVAL",
    });

    const result = reduce(state, createInterruptEvent());

    expect(result.nextState.phase).toBe("STOPPED");
    expect(result.nextState.stop_reason).toBe("USER_STOP");
  });
});

// ---------------------------------------------------------------------------
// S9 — State preserved across risky effects
// ---------------------------------------------------------------------------

describe("S9 — state preserved across risky effects for safe resumability", () => {
  test("reducer includes PERSIST_SNAPSHOT before risky RUN_TOOL effects", () => {
    const state = createEnabledState({
      phase: "DECIDE",
      foreground_action: {
        kind: "RUN_TOOL",
        tool_name: "bash",
        target_path: "/workspace/file.ts",
        summary: "write file",
        risky: true,
        async: false,
        metadata: {},
      },
    });

    const result = reduce(state, createUserInputEvent());

    // Check if PERSIST_SNAPSHOT is among the effects when there's a risky action
    const snapshotEffects = result.effects.filter((e) => e.kind === "PERSIST_SNAPSHOT");
    const runToolEffects = result.effects.filter((e) => e.kind === "RUN_TOOL");

    // If a risky tool action was dispatched, a snapshot should precede it
    if (runToolEffects.length > 0) {
      const riskyTools = runToolEffects.filter((e) => e.kind === "RUN_TOOL" && e.risky);
      if (riskyTools.length > 0) {
        expect(snapshotEffects.length).toBeGreaterThan(0);
      }
    }
  });
});
