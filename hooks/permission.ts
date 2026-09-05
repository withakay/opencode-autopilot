// ---------------------------------------------------------------------------
// permission "evaluate" hook — enforces allow-all / limited modes
// ---------------------------------------------------------------------------

export interface PermissionHookDeps {
  getState: (sessionID: string) => { mode: "DISABLED" | "ENABLED" } | undefined;
  getPermissionMode: (sessionID: string) => "allow-all" | "limited" | undefined;
  onPermissionDenied?: (
    sessionID: string,
    permission: { action: string; resources: ReadonlyArray<string> },
  ) => void;
}

/** Structural subset of the v2 PermissionEvaluation hook input. */
export interface PermissionEvaluationLike {
  readonly sessionID: string;
  readonly action: string;
  readonly resources: ReadonlyArray<string>;
  effect: "allow" | "deny" | "ask";
  message?: string;
}

export function createPermissionHook(
  deps: PermissionHookDeps,
): (input: PermissionEvaluationLike) => void {
  return (input: PermissionEvaluationLike): void => {
    const state = deps.getState(input.sessionID);
    if (!state || state.mode !== "ENABLED") return;

    const permissionMode = deps.getPermissionMode(input.sessionID);

    if (permissionMode === "allow-all") {
      input.effect = "allow";
      return;
    }

    if (permissionMode === "limited" && input.effect === "ask") {
      input.effect = "deny";
      input.message = "Denied by autopilot limited mode.";
      deps.onPermissionDenied?.(input.sessionID, {
        action: input.action,
        resources: input.resources,
      });
    }
  };
}
