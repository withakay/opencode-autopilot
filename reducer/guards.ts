import type { Effect, ExtendedState, ForegroundAction } from "../types/index.ts";

type AdmissibleAction = ForegroundAction | Effect;

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function getActionToolName(action: AdmissibleAction): string | null {
  if ("tool_name" in action) {
    return action.tool_name;
  }

  return null;
}

function getActionTargetPaths(action: AdmissibleAction): string[] {
  if ("target_path" in action) {
    return action.target_path === null ? [] : [action.target_path];
  }

  switch (action.kind) {
    case "RUN_TOOL":
      return action.target_paths;
    case "REQUEST_TRUST":
      return [action.requested_path];
    default:
      return [];
  }
}

function actionIsRisky(action: AdmissibleAction): boolean {
  if ("risky" in action) {
    return action.risky;
  }

  return false;
}

function requiresTrustedPath(action: AdmissibleAction): boolean {
  if (action.kind === "REQUEST_TRUST") {
    return false;
  }

  return getActionTargetPaths(action).length > 0;
}

function pathsAllowed(state: ExtendedState, paths: readonly string[]): boolean {
  if (paths.length === 0) {
    return true;
  }

  if (state.allowed_paths.length === 0) {
    return false;
  }

  return paths.every((path) => state.allowed_paths.includes(path));
}

function pathsTrusted(state: ExtendedState, paths: readonly string[]): boolean {
  if (paths.length === 0) {
    return true;
  }

  return paths.every((path) => state.trust_state.trusted_paths.includes(path));
}

function toolAllowed(state: ExtendedState, action: AdmissibleAction): boolean {
  const toolName = getActionToolName(action);

  if (toolName === null) {
    return true;
  }

  return state.allowed_tools.includes(toolName);
}

function actionAwaitsApproval(state: ExtendedState, action: AdmissibleAction): boolean {
  if (action.kind === "REQUEST_APPROVAL") {
    return false;
  }

  if (!actionIsRisky(action)) {
    return false;
  }

  if (state.approval_state.status === "granted") {
    return false;
  }

  return true;
}

export function approvalRequired(state: ExtendedState): boolean {
  const action = state.foreground_action;

  if (state.approval_state.status === "pending") {
    return false;
  }

  if (state.approval_state.pending_action !== null) {
    return state.approval_state.status !== "granted";
  }

  return action === null ? false : actionAwaitsApproval(state, action);
}

export function trustRequired(state: ExtendedState): boolean {
  const action = state.foreground_action;

  if (action === null || action.kind === "REQUEST_TRUST") {
    return false;
  }

  const targetPaths = getActionTargetPaths(action);

  if (targetPaths.length === 0) {
    return false;
  }

  if (state.trust_state.status === "pending") {
    return false;
  }

  return !pathsTrusted(state, targetPaths);
}

export function contextUnsafe(state: ExtendedState): boolean {
  if (state.context_state.unsafe_to_continue) {
    return true;
  }

  const remainingBudget = state.context_state.remaining_budget;

  if (remainingBudget === null) {
    return false;
  }

  return remainingBudget <= state.context_state.threshold;
}

export function compactionAllowed(state: ExtendedState): boolean {
  if (!contextUnsafe(state)) {
    return false;
  }

  if (!state.resumable || state.phase === "STOPPED") {
    return false;
  }

  if (state.foreground_action?.kind === "COMPACT_CONTEXT") {
    return false;
  }

  const remainingBudget = state.context_state.remaining_budget;

  return remainingBudget === null || remainingBudget >= 0;
}

export function isAdmissible(
  state: ExtendedState,
  action: AdmissibleAction,
): boolean {
  if (action.kind === "NO_OP") {
    return true;
  }

  if (state.mode !== "ENABLED") {
    return false;
  }

  if (state.phase === "STOPPED") {
    return false;
  }

  if (state.latest_observations.last_interrupt !== null) {
    return false;
  }

  const targetPaths = unique(getActionTargetPaths(action));

  if (!toolAllowed(state, action)) {
    return false;
  }

  if (!pathsAllowed(state, targetPaths)) {
    return false;
  }

  if (requiresTrustedPath(action) && !pathsTrusted(state, targetPaths)) {
    return false;
  }

  if (actionAwaitsApproval(state, action)) {
    return false;
  }

  if (action.kind === "COMPACT_CONTEXT") {
    return compactionAllowed(state);
  }

  if (contextUnsafe(state)) {
    return false;
  }

  return true;
}
