import type { ExtendedState } from "../types/index.ts";
import { createInitialState } from "../state/factory.ts";
import { createEvent } from "../events/factory.ts";
import type { EventEnvelope, EventType, EventPayloadMap } from "../types/index.ts";

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

export function createTestState(
  overrides: Partial<ExtendedState> = {},
): ExtendedState {
  const base = createInitialState("test goal", {
    sessionID: "test-session",
    mode: "ENABLED",
    phase: "OBSERVE",
  });
  return { ...base, ...overrides };
}

export function createEnabledState(
  overrides: Partial<ExtendedState> = {},
): ExtendedState {
  return createTestState({
    mode: "ENABLED",
    phase: "OBSERVE",
    ...overrides,
  });
}

export function createStoppedState(
  overrides: Partial<ExtendedState> = {},
): ExtendedState {
  return createTestState({
    mode: "ENABLED",
    phase: "STOPPED",
    stop_reason: "COMPLETED",
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Event helpers
// ---------------------------------------------------------------------------

export function createTestEvent<T extends EventType>(
  type: T,
  payload: EventPayloadMap[T],
  overrides: Partial<EventEnvelope<T>> = {},
): EventEnvelope<T> {
  const base = createEvent(type, payload);
  return { ...base, ...overrides };
}

export function createUserInputEvent(
  message: string = "test input",
): EventEnvelope<"USER_INPUT"> {
  return createEvent("USER_INPUT", {
    message,
    attachments: [],
    requested_mode_change: null,
    referenced_paths: [],
    metadata: {},
  }, { source: "USER" });
}

export function createToolResultEvent(
  summary: string = "success",
  toolName: string = "bash",
): EventEnvelope<"TOOL_RESULT"> {
  return createEvent("TOOL_RESULT", {
    tool_name: toolName,
    invocation_id: `inv-${Date.now()}`,
    status: "success",
    summary,
    output_ref: null,
    changed_paths: [],
    started_at: null,
    completed_at: new Date().toISOString(),
    metadata: {},
  }, { source: "TOOL_DISPATCHER" });
}

export function createToolErrorEvent(
  message: string = "error",
  retryable: boolean = true,
): EventEnvelope<"TOOL_ERROR"> {
  return createEvent("TOOL_ERROR", {
    tool_name: "bash",
    invocation_id: `inv-${Date.now()}`,
    status: "error",
    error_code: "EXIT_NONZERO",
    message,
    stderr_ref: null,
    retryable_hint: retryable,
    started_at: null,
    completed_at: new Date().toISOString(),
    metadata: {},
  }, { source: "TOOL_DISPATCHER" });
}

export function createInterruptEvent(): EventEnvelope<"INTERRUPT"> {
  return createEvent("INTERRUPT", {
    interrupt_type: "user_cancel",
    message: "User cancelled",
    metadata: {},
  }, { source: "SESSION_MANAGER" });
}

export function createResumeEvent(): EventEnvelope<"RESUME_REQUESTED"> {
  return createEvent("RESUME_REQUESTED", {
    resume_token: null,
    source_session_id: null,
    metadata: {},
  }, { source: "SESSION_MANAGER" });
}

export function createApprovalGrantedEvent(
  scope: string = "write",
): EventEnvelope<"APPROVAL_GRANTED"> {
  return createEvent("APPROVAL_GRANTED", {
    approval_scope: scope,
    approved_action: "write file",
    approved_until: null,
    session_scoped: true,
    metadata: {},
  }, { source: "APPROVAL_SYSTEM" });
}

export function createApprovalDeniedEvent(
  scope: string = "write",
): EventEnvelope<"APPROVAL_DENIED"> {
  return createEvent("APPROVAL_DENIED", {
    approval_scope: scope,
    denied_action: "write file",
    user_feedback: null,
    metadata: {},
  }, { source: "APPROVAL_SYSTEM" });
}

export function createTrustGrantedEvent(
  path: string = "/workspace",
): EventEnvelope<"TRUST_GRANTED"> {
  return createEvent("TRUST_GRANTED", {
    trusted_path: path,
    scope: "session",
    metadata: {},
  }, { source: "TRUST_SYSTEM" });
}

export function createTrustDeniedEvent(
  path: string = "/workspace",
): EventEnvelope<"TRUST_DENIED"> {
  return createEvent("TRUST_DENIED", {
    requested_path: path,
    user_feedback: null,
    metadata: {},
  }, { source: "TRUST_SYSTEM" });
}

export function createContextLowEvent(
  remaining: number = 100,
  threshold: number = 500,
): EventEnvelope<"CONTEXT_LOW"> {
  return createEvent("CONTEXT_LOW", {
    remaining_budget: remaining,
    threshold,
    compaction_recommended: true,
    metadata: {},
  }, { source: "CONTEXT_MANAGER" });
}

export function createBackgroundTaskEvent(
  taskId: string = "task-1",
  status: "running" | "idle" | "completed" | "failed" | "cancelled" = "completed",
): EventEnvelope<"BACKGROUND_TASK_UPDATED"> {
  return createEvent("BACKGROUND_TASK_UPDATED", {
    task_id: taskId,
    task_status: status,
    summary: null,
    output_ref: null,
    metadata: {},
  }, { source: "BACKGROUND_TASK_RUNNER" });
}

// ---------------------------------------------------------------------------
// Mock client factory
// ---------------------------------------------------------------------------

export interface MockClient {
  session: {
    promptAsync: ReturnType<typeof createMockFn>;
  };
  tui: {
    showToast: ReturnType<typeof createMockFn>;
  };
}

interface MockFn {
  (...args: unknown[]): Promise<unknown>;
  calls: unknown[][];
  callCount: number;
  reset: () => void;
}

function createMockFn(returnValue: unknown = undefined): MockFn {
  const calls: unknown[][] = [];
  const fn = (async (...args: unknown[]) => {
    calls.push(args);
    return returnValue;
  }) as MockFn;
  fn.calls = calls;
  Object.defineProperty(fn, "callCount", {
    get() {
      return calls.length;
    },
  });
  fn.reset = () => {
    calls.length = 0;
  };
  return fn;
}

export function createMockClient(): MockClient {
  return {
    session: {
      promptAsync: createMockFn(),
    },
    tui: {
      showToast: createMockFn(),
    },
  };
}

export { createMockFn };
