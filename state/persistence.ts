import type { Plugin } from "@opencode-ai/plugin";
import {
  AUTOPILOT_DEFAULT_MAX_DURATION_MS,
  AUTOPILOT_DEFAULT_MAX_TOKENS,
  AUTOPILOT_DEFAULT_NO_PROGRESS_TOKEN_THRESHOLD,
  AUTOPILOT_DEFAULT_NO_PROGRESS_TURNS,
  normalizeMaxContinues,
  normalizePositiveInteger,
} from "../prompts/index.ts";
import type {
  AgentMode,
  AgentPhase,
  AutopilotRunMode,
  AutopilotRunStatus,
  ExtendedState,
} from "../types/index.ts";
import type { StopReason } from "../types/stop-reason.ts";
import { ensureGoalContract } from "./goal-contract.ts";

export interface PersistedSessionEntry {
  version: 2;
  state: ExtendedState;
  history: string[];
  permissionMode: "allow-all" | "limited";
}

const STATE_KEY_PREFIX = "state/";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNonNegativeInteger(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

export function normalizeState(sessionID: string, rawState: unknown): ExtendedState | null {
  if (!isObject(rawState)) return null;

  const objective = asString(rawState.objective, asString(rawState.goal)).trim();
  const sessionMode = oneOf(
    rawState.session_mode,
    ["session-defaults", "delegated-task"] as const,
    objective ? "delegated-task" : "session-defaults",
  );
  const mode = oneOf<AgentMode>(rawState.mode, ["DISABLED", "ENABLED"] as const, "DISABLED");
  const status = oneOf<AutopilotRunStatus>(
    rawState.status,
    [
      "active",
      "waiting_for_reply",
      "validating",
      "paused",
      "blocked",
      "completed",
      "failed",
      "cleared",
    ] as const,
    mode === "ENABLED" ? "active" : "cleared",
  );
  const state: ExtendedState = {
    session_id: asString(rawState.session_id, sessionID) || sessionID,
    mode,
    phase: oneOf<AgentPhase>(
      rawState.phase,
      ["OBSERVE", "STOPPED"] as const,
      mode === "ENABLED" ? "OBSERVE" : "STOPPED",
    ),
    session_mode: sessionMode,
    goal: asString(rawState.goal, objective),
    objective,
    run_mode: oneOf<AutopilotRunMode>(
      rawState.run_mode,
      ["ambient", "objective"] as const,
      sessionMode === "delegated-task" ? "objective" : "ambient",
    ),
    status,
    done_when: asString(rawState.done_when) || undefined,
    verify_with: asString(rawState.verify_with) || undefined,
    plan_source: asString(rawState.plan_source) || undefined,
    planning_framework: asString(rawState.planning_framework) || undefined,
    candidate_completion: asString(rawState.candidate_completion) || undefined,
    plan: Array.isArray(rawState.plan) ? (rawState.plan as ExtendedState["plan"]) : [],
    goal_contract: isObject(rawState.goal_contract)
      ? (rawState.goal_contract as unknown as ExtendedState["goal_contract"])
      : (undefined as unknown as ExtendedState["goal_contract"]),
    checkpoints: Array.isArray(rawState.checkpoints)
      ? (rawState.checkpoints as ExtendedState["checkpoints"])
      : [],
    current_checkpoint: asString(rawState.current_checkpoint) || undefined,
    last_verification: isObject(rawState.last_verification)
      ? (rawState.last_verification as unknown as ExtendedState["last_verification"])
      : undefined,
    final_digest: isObject(rawState.final_digest)
      ? (rawState.final_digest as unknown as ExtendedState["final_digest"])
      : undefined,
    active_step_index: asNonNegativeInteger(rawState.active_step_index, -1),
    stop_reason:
      oneOf<StopReason | "">(
        rawState.stop_reason,
        [
          "",
          "COMPLETED",
          "USER_STOP",
          "WAITING_FOR_USER_INPUT",
          "PERMISSION_DENIED",
          "BUDGET_EXHAUSTED",
          "NO_PROGRESS",
          "RECOVERED_AFTER_RESTART",
          "RETRY_EXHAUSTED",
          "UNRECOVERABLE_ERROR",
        ] as const,
        "",
      ) || null,
    started_at: normalizePositiveInteger(rawState.started_at, Date.now()),
    continuation_count: asNonNegativeInteger(rawState.continuation_count),
    max_continues: normalizeMaxContinues(rawState.max_continues),
    total_tokens: asNonNegativeInteger(rawState.total_tokens),
    max_tokens: normalizePositiveInteger(rawState.max_tokens, AUTOPILOT_DEFAULT_MAX_TOKENS),
    max_duration_ms: normalizePositiveInteger(
      rawState.max_duration_ms,
      AUTOPILOT_DEFAULT_MAX_DURATION_MS,
    ),
    no_progress_token_threshold: normalizePositiveInteger(
      rawState.no_progress_token_threshold,
      AUTOPILOT_DEFAULT_NO_PROGRESS_TOKEN_THRESHOLD,
    ),
    no_progress_turns_before_pause: normalizePositiveInteger(
      rawState.no_progress_turns_before_pause,
      AUTOPILOT_DEFAULT_NO_PROGRESS_TURNS,
    ),
    no_progress_turns: asNonNegativeInteger(rawState.no_progress_turns),
    worker_agent: asString(rawState.worker_agent, "general") || "general",
    autonomous_strength: oneOf(
      rawState.autonomous_strength,
      ["conservative", "balanced", "aggressive"] as const,
      "balanced",
    ),
  };

  if (!isObject(state.goal_contract) || !Array.isArray(state.goal_contract.criteria)) {
    state.goal_contract = undefined as unknown as ExtendedState["goal_contract"];
  }

  ensureGoalContract(state);
  if (
    state.mode === "ENABLED" &&
    state.run_mode === "objective" &&
    state.status === "waiting_for_reply"
  ) {
    return { ...state, status: "active" };
  }
  return state;
}

export function normalizeEntry(sessionID: string, raw: unknown): PersistedSessionEntry | null {
  if (!isObject(raw)) return null;
  const state = normalizeState(sessionID, raw.state);
  if (!state) return null;
  const history = Array.isArray(raw.history)
    ? raw.history.filter((item): item is string => typeof item === "string")
    : [];
  return {
    version: 2,
    state,
    history,
    permissionMode: oneOf(raw.permissionMode, ["allow-all", "limited"] as const, "allow-all"),
  };
}

type StorageDomain = Plugin.Context["storage"];
type StorageJson = Parameters<StorageDomain["set"]>[1];

/** Session state store backed by the plugin storage domain (global SQLite KV). */
export class StorageStateStore {
  constructor(private readonly storage: StorageDomain) {}

  private key(sessionID: string): string {
    return `${STATE_KEY_PREFIX}${sessionID}`;
  }

  async load(): Promise<Map<string, PersistedSessionEntry>> {
    const entries = new Map<string, PersistedSessionEntry>();
    let after: string | undefined;
    do {
      const result = await this.storage.scan({ prefix: STATE_KEY_PREFIX, after });
      for (const item of result.entries) {
        const sessionID = item.key.slice(STATE_KEY_PREFIX.length);
        const entry = normalizeEntry(sessionID, item.value);
        if (sessionID && entry) entries.set(sessionID, entry);
      }
      after = result.next;
    } while (after);
    return entries;
  }

  async save(sessionID: string, entry: PersistedSessionEntry): Promise<void> {
    // Round-trip through JSON to drop undefined fields before hitting the KV.
    const value = JSON.parse(JSON.stringify(entry)) as StorageJson;
    await this.storage.set(this.key(sessionID), value);
  }

  async remove(sessionID: string): Promise<void> {
    await this.storage.remove(this.key(sessionID));
  }
}
