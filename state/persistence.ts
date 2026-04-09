import type { AutonomousStrength } from "../types/state.ts";

export interface PendingTask {
  id: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "blocked";
  required: boolean;
  created_at: string;
  completed_at?: string;
}

export interface AutopilotSessionState {
  session_id: string;
  created_at: string;
  updated_at: string;
  goal: string;
  status: "active" | "validating" | "completed" | "blocked" | "stopped";
  autonomous_strength: AutonomousStrength;
  pending_tasks: PendingTask[];
  completion_requirements: string[];
  validation_checks: string[];
  metadata: Record<string, unknown>;
}

const STATE_DIR = ".opencode/autopilot-state";

async function ensureStateDir(workspacePath: string): Promise<string> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const statePath = path.join(workspacePath, STATE_DIR);
  await fs.mkdir(statePath, { recursive: true });
  return statePath;
}

function getStateFilePath(stateDir: string, sessionId: string): string {
  // Use timestamp-based ID if sessionId is empty or invalid
  const safeId = sessionId || `session-${Date.now()}`;
  return `${stateDir}/${safeId}.json`;
}

export async function loadSessionState(
  workspacePath: string,
  sessionId: string,
): Promise<AutopilotSessionState | null> {
  try {
    const fs = await import("node:fs/promises");
    const stateDir = await ensureStateDir(workspacePath);
    const filePath = getStateFilePath(stateDir, sessionId);

    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as AutopilotSessionState;
  } catch {
    return null;
  }
}

export async function saveSessionState(
  workspacePath: string,
  state: AutopilotSessionState,
): Promise<void> {
  const fs = await import("node:fs/promises");
  const stateDir = await ensureStateDir(workspacePath);
  const filePath = getStateFilePath(stateDir, state.session_id);

  const updatedState: AutopilotSessionState = {
    ...state,
    updated_at: new Date().toISOString(),
  };

  await fs.writeFile(filePath, JSON.stringify(updatedState, null, 2));
}

export async function createSessionState(
  workspacePath: string,
  sessionId: string,
  goal: string,
  autonomousStrength: AutonomousStrength = "balanced",
): Promise<AutopilotSessionState> {
  const now = new Date().toISOString();
  const state: AutopilotSessionState = {
    session_id: sessionId,
    created_at: now,
    updated_at: now,
    goal,
    status: "active",
    autonomous_strength: autonomousStrength,
    pending_tasks: [],
    completion_requirements: [],
    validation_checks: [],
    metadata: {},
  };

  await saveSessionState(workspacePath, state);
  return state;
}

export async function addPendingTask(
  workspacePath: string,
  sessionId: string,
  description: string,
  required = true,
): Promise<PendingTask | null> {
  const state = await loadSessionState(workspacePath, sessionId);
  if (!state) return null;

  const task: PendingTask = {
    id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    description,
    status: "pending",
    required,
    created_at: new Date().toISOString(),
  };

  state.pending_tasks.push(task);
  await saveSessionState(workspacePath, state);
  return task;
}

export async function completeTask(
  workspacePath: string,
  sessionId: string,
  taskId: string,
): Promise<boolean> {
  const state = await loadSessionState(workspacePath, sessionId);
  if (!state) return false;

  const task = state.pending_tasks.find((t) => t.id === taskId);
  if (!task) return false;

  task.status = "completed";
  task.completed_at = new Date().toISOString();
  await saveSessionState(workspacePath, state);
  return true;
}

export async function updateTaskStatus(
  workspacePath: string,
  sessionId: string,
  taskId: string,
  status: PendingTask["status"],
): Promise<boolean> {
  const state = await loadSessionState(workspacePath, sessionId);
  if (!state) return false;

  const task = state.pending_tasks.find((t) => t.id === taskId);
  if (!task) return false;

  task.status = status;
  if (status === "completed") {
    task.completed_at = new Date().toISOString();
  }
  await saveSessionState(workspacePath, state);
  return true;
}

export function hasIncompleteRequiredTasks(state: AutopilotSessionState): boolean {
  return state.pending_tasks.some((task) => task.required && task.status !== "completed");
}

export function getIncompleteRequiredTasks(state: AutopilotSessionState): PendingTask[] {
  return state.pending_tasks.filter((task) => task.required && task.status !== "completed");
}

export async function canComplete(
  workspacePath: string,
  sessionId: string,
): Promise<{ canComplete: boolean; reason?: string }> {
  const state = await loadSessionState(workspacePath, sessionId);
  if (!state) {
    return { canComplete: false, reason: "No state file found" };
  }

  const incompleteTasks = getIncompleteRequiredTasks(state);
  if (incompleteTasks.length > 0) {
    return {
      canComplete: false,
      reason: `Required tasks incomplete: ${incompleteTasks.map((t) => t.description).join(", ")}`,
    };
  }

  return { canComplete: true };
}

export async function updateSessionStatus(
  workspacePath: string,
  sessionId: string,
  status: AutopilotSessionState["status"],
): Promise<boolean> {
  const state = await loadSessionState(workspacePath, sessionId);
  if (!state) return false;

  state.status = status;
  await saveSessionState(workspacePath, state);
  return true;
}

export async function addValidationCheck(
  workspacePath: string,
  sessionId: string,
  check: string,
): Promise<boolean> {
  const state = await loadSessionState(workspacePath, sessionId);
  if (!state) return false;

  if (!state.validation_checks.includes(check)) {
    state.validation_checks.push(check);
    await saveSessionState(workspacePath, state);
  }
  return true;
}

export async function addCompletionRequirement(
  workspacePath: string,
  sessionId: string,
  requirement: string,
): Promise<boolean> {
  const state = await loadSessionState(workspacePath, sessionId);
  if (!state) return false;

  if (!state.completion_requirements.includes(requirement)) {
    state.completion_requirements.push(requirement);
    await saveSessionState(workspacePath, state);
  }
  return true;
}

export async function cleanupOldSessions(
  workspacePath: string,
  maxAgeMs: number = 7 * 24 * 60 * 60 * 1000, // 7 days
): Promise<number> {
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const stateDir = path.join(workspacePath, STATE_DIR);

    const entries = await fs.readdir(stateDir);
    const now = Date.now();
    let cleaned = 0;

    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;

      const filePath = path.join(stateDir, entry);
      const stat = await fs.stat(filePath);

      if (now - stat.mtimeMs > maxAgeMs) {
        await fs.unlink(filePath);
        cleaned++;
      }
    }

    return cleaned;
  } catch {
    return 0;
  }
}
