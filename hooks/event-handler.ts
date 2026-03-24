import type { SessionCache } from "../state/session-cache.ts";
import type { ExtendedState } from "../types/index.ts";

// ---------------------------------------------------------------------------
// Auxiliary per-session tracking (fields not part of ExtendedState)
// ---------------------------------------------------------------------------

export interface SessionTracking {
  lastAssistantMessageID: string | undefined;
  lastUsage: { tokens?: unknown; cost?: unknown } | undefined;
  awaitingWorkerReply: boolean;
  blockedByPermission: boolean;
  permissionBlockMessage: string | undefined;
}

export function createSessionTracking(): SessionTracking {
  return {
    lastAssistantMessageID: undefined,
    lastUsage: undefined,
    awaitingWorkerReply: false,
    blockedByPermission: false,
    permissionBlockMessage: undefined,
  };
}

// ---------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------

export interface EventHandlerDeps {
  getState: (sessionID: string) => ExtendedState | undefined;
  deleteState: (sessionID: string) => void;
  sessionCache: SessionCache;
  getTracking: (sessionID: string) => SessionTracking | undefined;
  onSessionIdle: (sessionID: string) => Promise<void>;
  onSessionError: (
    sessionID: string,
    error: { name?: string; data?: { message?: string } } | undefined,
  ) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeError(
  error: unknown,
): { name?: string; data?: { message?: string } } | undefined {
  if (!isObject(error)) return undefined;

  const result: { name?: string; data?: { message?: string } } = {};

  if (isString(error.name)) {
    result.name = error.name;
  }

  if (isObject(error.data) && isString(error.data.message)) {
    result.data = { message: error.data.message };
  }

  return result;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

interface SdkEvent {
  type: string;
  properties: Record<string, unknown>;
}

export function createEventHandler(
  deps: EventHandlerDeps,
): (input: { event: SdkEvent }) => Promise<void> {
  const { getState, deleteState, sessionCache, getTracking, onSessionIdle, onSessionError } = deps;

  return async function handleEvent(input: { event: SdkEvent }): Promise<void> {
    const { event } = input;

    switch (event.type) {
      case "message.updated": {
        const info = event.properties.info;
        if (!isObject(info)) return;

        const sessionID = info.sessionID;
        const messageID = info.id;
        const role = info.role;

        if (!isString(sessionID) || !isString(messageID) || !isString(role)) {
          return;
        }

        if (role === "user" || role === "assistant") {
          sessionCache.setRole(sessionID, messageID, role);
        }

        if ("agent" in info && isString(info.agent)) {
          sessionCache.setAgent(sessionID, messageID, info.agent);
        }

        if (role === "assistant") {
          const state = getState(sessionID);
          const tracking = getTracking(sessionID);

          if (state && tracking?.awaitingWorkerReply) {
            const agent = "agent" in info && isString(info.agent) ? info.agent : undefined;

            if (agent === state.worker_agent) {
              tracking.lastAssistantMessageID = messageID;
              tracking.lastUsage = {
                tokens: info.tokens,
                cost: info.cost,
              };
            }
          }
        }
        return;
      }

      case "message.part.updated": {
        const part = event.properties.part;
        if (!isObject(part)) return;

        if (
          part.type !== "text" ||
          !isString(part.sessionID) ||
          !isString(part.messageID) ||
          !isString(part.id) ||
          !isString(part.text)
        ) {
          return;
        }

        const state = getState(part.sessionID);
        if (!state) return;

        const cachedRole = sessionCache.getRole(part.sessionID, part.messageID);
        const cachedAgent = sessionCache.getAgent(part.sessionID, part.messageID);

        if (cachedRole === "assistant" && cachedAgent === state.worker_agent) {
          sessionCache.setTextPart(part.sessionID, part.id, part.messageID, part.text);
        }
        return;
      }

      case "session.idle": {
        const sessionID = event.properties.sessionID;
        if (!isString(sessionID)) return;

        await onSessionIdle(sessionID);
        return;
      }

      case "session.error": {
        const sessionID = event.properties.sessionID;
        if (!isString(sessionID)) return;

        const state = getState(sessionID);
        if (!state || state.mode !== "ENABLED") return;

        const error = normalizeError(event.properties.error);
        await onSessionError(sessionID, error);
        return;
      }

      case "session.deleted": {
        const info = event.properties.info;
        if (!isObject(info) || !isString(info.id)) return;

        sessionCache.cleanup(info.id);
        deleteState(info.id);
        return;
      }

      case "permission.updated": {
        const sessionID = event.properties.sessionID;
        if (!isString(sessionID)) return;

        const state = getState(sessionID);
        const tracking = getTracking(sessionID);

        if (!state || state.mode !== "ENABLED" || !tracking) return;

        // In limited mode, a permission being asked implies it was denied
        // (since our permission.ask hook denies it). Record the block.
        tracking.blockedByPermission = true;
        const permType = isString(event.properties.type) ? event.properties.type : "unknown";
        const patterns = event.properties.pattern;
        const patternStr = Array.isArray(patterns)
          ? patterns.filter(isString).join(", ")
          : isString(patterns)
            ? patterns
            : "";
        tracking.permissionBlockMessage = `Denied ${permType} ${patternStr}`.trim();
        return;
      }
    }
  };
}
