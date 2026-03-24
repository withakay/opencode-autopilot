// ---------------------------------------------------------------------------
// permission.ask hook — enforces allow-all / limited modes
// ---------------------------------------------------------------------------

export interface PermissionHookDeps {
  getState: (
    sessionID: string,
  ) =>
    | { mode: "DISABLED" | "ENABLED" }
    | undefined;
  getPermissionMode: (
    sessionID: string,
  ) => "allow-all" | "limited" | undefined;
  onPermissionDenied?: (
    sessionID: string,
    permission: {
      type: string;
      pattern?: string | string[];
      title: string;
    },
  ) => void;
}

interface PermissionInput {
  id: string;
  type: string;
  pattern?: string | string[];
  sessionID: string;
  messageID: string;
  callID?: string;
  title: string;
  metadata: Record<string, unknown>;
  time: { created: number };
}

interface PermissionOutput {
  status: "ask" | "deny" | "allow";
}

export function createPermissionHook(
  deps: PermissionHookDeps,
): (input: PermissionInput, output: PermissionOutput) => Promise<void> {
  return async (
    input: PermissionInput,
    output: PermissionOutput,
  ): Promise<void> => {
    const state = deps.getState(input.sessionID);

    if (!state || state.mode !== "ENABLED") {
      return;
    }

    const permissionMode = deps.getPermissionMode(input.sessionID);

    if (permissionMode === "allow-all") {
      output.status = "allow";
      return;
    }

    if (permissionMode === "limited") {
      output.status = "deny";
      deps.onPermissionDenied?.(input.sessionID, {
        type: input.type,
        pattern: input.pattern,
        title: input.title,
      });
    }
  };
}
