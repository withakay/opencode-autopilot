import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ExtendedState } from "../types/index.ts";
import { ensureGoalContract } from "./goal-contract.ts";

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

  constructor(private readonly filePath: string) {}

  static forRoot(root: string): PersistentStateStore {
    return new PersistentStateStore(join(root, ".autopilot", "state.json"));
  }

  async load(): Promise<PersistedAutopilotData> {
    try {
      const raw = await readFile(this.filePath, "utf8");
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
      if ((error as { code?: string }).code === "ENOENT") return cloneEmpty();
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
