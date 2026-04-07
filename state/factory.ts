import type {
  AgentMode,
  AgentPhase,
  ApprovalState,
  ContextState,
  ExtendedState,
  PlanState,
  RetryCounters,
  TrustState,
} from "../types/index.ts";

export interface CreateInitialStateOptions {
  sessionID?: string;
  mode?: AgentMode;
  phase?: AgentPhase;
  sessionMode?: ExtendedState["session_mode"];
  allowedTools?: string[];
  allowedPaths?: string[];
  maxContinues?: number;
  workerAgent?: string;
  remainingBudget?: number | null;
  contextThreshold?: number;
  maxStepRetries?: number;
  maxGlobalRetries?: number;
  maxNoProgress?: number;
  trustedPaths?: string[];
}

const DEFAULT_ALLOWED_TOOLS = ["bash", "read", "glob", "grep", "apply_patch"];
const DEFAULT_CONTEXT_THRESHOLD = 8_000;
const DEFAULT_MAX_CONTINUES = 25;
const DEFAULT_MAX_STEP_RETRIES = 2;
const DEFAULT_MAX_GLOBAL_RETRIES = 6;
const DEFAULT_MAX_NO_PROGRESS = 3;
const DEFAULT_WORKER_AGENT = "pi";

function createPlanState(): PlanState {
  return {
    steps: [],
    open_items: [],
    completed_items: [],
    blocked_items: [],
    dependencies: {},
    stale: false,
  };
}

function createApprovalState(): ApprovalState {
  return {
    status: "idle",
    pending_action: null,
    pending_scope: null,
    approved_scopes: [],
    denied_scopes: [],
    last_feedback: null,
  };
}

function createTrustState(trustedPaths: string[]): TrustState {
  return {
    status: trustedPaths.length > 0 ? "trusted" : "untrusted",
    trusted_paths: [...trustedPaths],
    pending_path: null,
    denied_paths: [],
    last_feedback: null,
  };
}

function createContextState(remainingBudget: number | null, threshold: number): ContextState {
  const resolvedBudget = remainingBudget ?? null;
  const compactionNeeded = resolvedBudget === null ? false : resolvedBudget <= threshold;

  return {
    remaining_budget: resolvedBudget,
    threshold,
    compaction_needed: compactionNeeded,
    compacted_at: null,
    unsafe_to_continue: compactionNeeded,
  };
}

function createRetryCounters(options: CreateInitialStateOptions): RetryCounters {
  return {
    step_retry_count: 0,
    global_retry_count: 0,
    no_progress_count: 0,
    recovery_attempt_count: 0,
    max_step_retries: options.maxStepRetries ?? DEFAULT_MAX_STEP_RETRIES,
    max_global_retries: options.maxGlobalRetries ?? DEFAULT_MAX_GLOBAL_RETRIES,
    max_no_progress: options.maxNoProgress ?? DEFAULT_MAX_NO_PROGRESS,
  };
}

export function createInitialState(
  goal: string,
  options: CreateInitialStateOptions = {},
): ExtendedState {
  const sessionID = options.sessionID ?? "";
  const allowedPaths = options.allowedPaths ?? [];

  return {
    session_id: sessionID,
    mode: options.mode ?? "DISABLED",
    phase: options.phase ?? "STOPPED",
    session_mode: options.sessionMode ?? "delegated-task",
    goal,
    plan_state: createPlanState(),
    completion_evidence: [],
    allowed_tools: [...(options.allowedTools ?? DEFAULT_ALLOWED_TOOLS)],
    allowed_paths: [...allowedPaths],
    approval_state: createApprovalState(),
    trust_state: createTrustState(options.trustedPaths ?? allowedPaths),
    context_state: createContextState(
      options.remainingBudget ?? null,
      options.contextThreshold ?? DEFAULT_CONTEXT_THRESHOLD,
    ),
    foreground_action: null,
    background_tasks: [],
    retry_counters: createRetryCounters(options),
    stop_reason: null,
    latest_observations: {
      events: [],
      last_user_input: null,
      last_tool_result: null,
      last_tool_error: null,
      last_interrupt: null,
    },
    continuation_count: 0,
    max_continues: options.maxContinues ?? DEFAULT_MAX_CONTINUES,
    worker_agent: options.workerAgent ?? DEFAULT_WORKER_AGENT,
    last_updated_at: null,
    resumable: true,
  };
}

export function createSessionState(
  sessionID: string,
  goal: string,
  options: Omit<CreateInitialStateOptions, "sessionID"> = {},
): ExtendedState {
  return createInitialState(goal, {
    ...options,
    sessionID,
    mode: options.mode ?? "ENABLED",
    phase: options.phase ?? "OBSERVE",
    sessionMode: options.sessionMode ?? "delegated-task",
  });
}
