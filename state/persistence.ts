import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
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

export function getAutopilotDataHome(): string {
  return (
    process.env.OPENCODE_AUTOPILOT_DATA_HOME ??
    join(homedir(), ".local", "share", "opencode", "opencode-autopilot")
  );
}

export interface PersistedAutopilotData {
  version: 1;
  states: Record<string, ExtendedState>;
  history: Record<string, string[]>;
  permissionMode: Record<string, "allow-all" | "limited">;
}

function cloneEmpty(): PersistedAutopilotData {
  return { version: 1, states: {}, history: {}, permissionMode: {} };
}

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

function normalizeState(sessionID: string, rawState: unknown): ExtendedState | null {
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

export class PersistentStateStore {
  private queue = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly legacyFilePath?: string,
  ) {}

  static async forRoot(root: string): Promise<PersistentStateStore> {
    const canonicalRoot = await canonicalizeRoot(root);
    const projectKey = createProjectKey(canonicalRoot);
    const filePath = join(getAutopilotDataHome(), "projects", projectKey, "state.json");
    const legacyFilePath = join(root, ".autopilot", "state.json");
    return new PersistentStateStore(filePath, legacyFilePath);
  }

  get path(): string {
    return this.filePath;
  }

  async load(): Promise<PersistedAutopilotData> {
    const primary = await this.loadFrom(this.filePath);
    if (primary) return primary;

    if (this.legacyFilePath) {
      const legacy = await this.loadFrom(this.legacyFilePath);
      if (legacy) return legacy;
    }

    return cloneEmpty();
  }

  private async loadFrom(filePath: string): Promise<PersistedAutopilotData | null> {
    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<PersistedAutopilotData>;
      if (parsed.version !== 1 || !parsed.states) return cloneEmpty();

      const data = cloneEmpty();
      for (const [sessionID, state] of Object.entries(parsed.states)) {
        const normalized = normalizeState(sessionID, state);
        if (normalized) data.states[sessionID] = normalized;
      }
      data.history = parsed.history ?? {};
      data.permissionMode = parsed.permissionMode ?? {};
      return data;
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return null;
      throw error;
    }
  }

  async save(data: PersistedAutopilotData): Promise<void> {
    const run = this.queue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
      const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(tmp, this.filePath);
      await chmod(this.filePath, 0o600);
    });
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async clear(): Promise<void> {
    const run = this.queue.then(async () => {
      await rm(this.filePath, { force: true });
    });
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

async function canonicalizeRoot(root: string): Promise<string> {
  try {
    return await realpath(root);
  } catch {
    return root;
  }
}

function slugPart(root: string): string {
  return (
    basename(root)
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "project"
  );
}

export function createProjectKey(root: string): string {
  const digest = createHash("sha256").update(root).digest("hex").slice(0, 16);
  return `${slugPart(root)}-${digest}`;
}

export function createPersistedData(
  states: Map<string, ExtendedState>,
  history: Map<string, string[]>,
  permissionMode: Map<string, "allow-all" | "limited">,
): PersistedAutopilotData {
  if (states.size === 0) return cloneEmpty();
  return {
    version: 1,
    states: Object.fromEntries(states),
    history: Object.fromEntries(history),
    permissionMode: Object.fromEntries(permissionMode),
  };
}
