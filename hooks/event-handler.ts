import type { Plugin } from "@opencode-ai/plugin";

// ---------------------------------------------------------------------------
// Auxiliary per-session tracking (fields not part of ExtendedState)
// ---------------------------------------------------------------------------

export interface SessionTracking {
  /** True between a dispatched worker prompt and its terminal execution event. */
  awaitingWorkerReply: boolean;
  /** Wall-clock time of the latest dispatch; replies older than this are ignored. */
  dispatchedAt: number;
  blockedByPermission: boolean;
  permissionBlockMessage: string | undefined;
  /** Set before autopilot interrupts its own worker (pause/stop), so the
   * resulting `session.execution.interrupted` is not misread as a user stop. */
  selfInterrupt: boolean;
}

export function createSessionTracking(): SessionTracking {
  return {
    awaitingWorkerReply: false,
    dispatchedAt: 0,
    blockedByPermission: false,
    permissionBlockMessage: undefined,
    selfInterrupt: false,
  };
}

// ---------------------------------------------------------------------------
// v2 server event handling
// ---------------------------------------------------------------------------

type EventStream = ReturnType<Plugin.Context["event"]["subscribe"]>;
/** Union of server events produced by ctx.event.subscribe. */
export type ServerEvent = EventStream extends AsyncIterable<infer E> ? E : never;

export interface EventHandlerDeps {
  onExecutionSucceeded: (sessionID: string, created: number) => Promise<void>;
  onExecutionFailed: (sessionID: string, message: string) => Promise<void>;
  onExecutionInterrupted: (
    sessionID: string,
    reason: "user" | "shutdown" | "superseded",
  ) => Promise<void>;
  onSessionDeleted: (sessionID: string) => Promise<void>;
}

export function createEventHandler(deps: EventHandlerDeps): (event: ServerEvent) => Promise<void> {
  return async (event: ServerEvent): Promise<void> => {
    switch (event.type) {
      case "session.execution.succeeded":
        await deps.onExecutionSucceeded(event.data.sessionID, event.created);
        return;
      case "session.execution.failed":
        await deps.onExecutionFailed(
          event.data.sessionID,
          event.data.error.message || "Session execution failed.",
        );
        return;
      case "session.execution.interrupted":
        await deps.onExecutionInterrupted(event.data.sessionID, event.data.reason);
        return;
      case "session.deleted":
        await deps.onSessionDeleted(event.data.sessionID);
        return;
      default:
        return;
    }
  };
}
