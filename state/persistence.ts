import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { ExtendedState } from "../types/index.ts";
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

function normalizeState(state: ExtendedState): ExtendedState {
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
        data.states[sessionID] = normalizeState(state);
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
      await mkdir(dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
      await rename(tmp, this.filePath);
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
