import type { ExtendedState, ForegroundAction } from "../types/index.ts";
import { approvalRequired, contextUnsafe, isAdmissible, trustRequired } from "./guards.ts";

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

function createAction(
  overrides: Partial<ForegroundAction> & Pick<ForegroundAction, "kind" | "summary">,
): ForegroundAction {
  return {
    kind: overrides.kind,
    tool_name: overrides.tool_name ?? null,
    target_path: overrides.target_path ?? null,
    summary: overrides.summary,
    risky: overrides.risky ?? false,
    async: overrides.async ?? false,
    metadata: overrides.metadata ?? {},
  };
}

function nextRunningBackgroundAction(state: ExtendedState): ForegroundAction | null {
  const task = state.background_tasks.find((item) => item.status === "running");

  if (!task) {
    return null;
  }

  return createAction({
    kind: "WAIT_FOR_BACKGROUND_TASK",
    summary: task.summary ?? `Wait for background task ${task.task_id}`,
    async: true,
    metadata: {
      task_id: task.task_id,
      output_ref: task.output_ref,
    },
  });
}

function nextPlanAction(state: ExtendedState): ForegroundAction | null {
  const nextStep = state.plan_state.steps.find(
    (step) => step.status === "pending" || step.status === "in_progress",
  );

  if (!nextStep) {
    return null;
  }

  const toolName = readString(nextStep.metadata.tool_name) ?? "bash";
  const targetPath = readString(nextStep.metadata.target_path);
  const targetPaths = readStringArray(nextStep.metadata.target_paths);
  const risky = readBoolean(nextStep.metadata.risky, toolName === "bash");
  const async = readBoolean(nextStep.metadata.async, false);

  return createAction({
    kind: "RUN_TOOL",
    tool_name: toolName,
    target_path: targetPath ?? targetPaths[0] ?? null,
    summary: nextStep.description,
    risky,
    async,
    metadata: {
      step_id: nextStep.id,
      target_paths: targetPaths,
    },
  });
}

function nextFallbackAction(state: ExtendedState): ForegroundAction | null {
  const referencedPath =
    state.latest_observations.last_user_input?.payload.referenced_paths[0] ?? null;

  if (referencedPath !== null) {
    return createAction({
      kind: "RUN_TOOL",
      tool_name: "read",
      target_path: referencedPath,
      summary: `Inspect ${referencedPath}`,
      metadata: {
        target_paths: [referencedPath],
      },
    });
  }

  if (state.allowed_paths[0]) {
    return createAction({
      kind: "RUN_TOOL",
      tool_name: "glob",
      target_path: state.allowed_paths[0],
      summary: `Survey allowed path ${state.allowed_paths[0]}`,
      metadata: {
        target_paths: [state.allowed_paths[0]],
      },
    });
  }

  if (state.goal.trim() === "") {
    return null;
  }

  return createAction({
    kind: "RUN_TOOL",
    tool_name: "bash",
    summary: `Work toward goal: ${state.goal}`,
    risky: true,
  });
}

export function selectAdmissibleAction(state: ExtendedState): ForegroundAction | null {
  const candidates = [
    nextRunningBackgroundAction(state),
    nextPlanAction(state),
    nextFallbackAction(state),
  ];

  for (const candidate of candidates) {
    if (candidate !== null && isAdmissible(state, candidate)) {
      return candidate;
    }
  }

  return null;
}

export function decide(state: ExtendedState): ExtendedState {
  if (contextUnsafe(state)) {
    return {
      ...state,
      foreground_action: createAction({
        kind: "COMPACT_CONTEXT",
        summary: "Compact context before continuing",
        metadata: {
          threshold: state.context_state.threshold,
        },
      }),
    };
  }

  if (approvalRequired(state)) {
    return {
      ...state,
      foreground_action: createAction({
        kind: "REQUEST_APPROVAL",
        summary: state.foreground_action?.summary ?? "Request approval for the next action",
        metadata: {
          approval_scope:
            state.approval_state.pending_scope ??
            state.foreground_action?.target_path ??
            state.goal,
        },
      }),
    };
  }

  if (trustRequired(state)) {
    const requestedPath = state.foreground_action?.target_path ?? state.allowed_paths[0] ?? null;

    return {
      ...state,
      foreground_action: createAction({
        kind: "REQUEST_TRUST",
        target_path: requestedPath,
        summary:
          requestedPath === null
            ? "Request trust for the next action"
            : `Request trust for ${requestedPath}`,
        metadata: {
          requested_path: requestedPath,
        },
      }),
    };
  }

  return {
    ...state,
    foreground_action: selectAdmissibleAction(state),
    stop_reason: null,
  };
}
