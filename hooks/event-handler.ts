import type { SessionCache } from "../state/session-cache.ts";
import type { ExtendedState } from "../types/index.ts";

// ---------------------------------------------------------------------------
// Auxiliary per-session tracking (fields not part of ExtendedState)
// ---------------------------------------------------------------------------

export interface SessionTracking {
  lastAssistantMessageID: string | undefined;
  lastUsage: { tokens?: unknown; cost?: unknown } | undefined;
  lastOutputTokens: number | undefined;
  seenTokenTotals: Map<string, number>;
  seenOutputTokens: Map<string, number>;
  awaitingWorkerReply: boolean;
  blockedByPermission: boolean;
  permissionBlockMessage: string | undefined;
}

export function createSessionTracking(): SessionTracking {
  return {
    lastAssistantMessageID: undefined,
    lastUsage: undefined,
    lastOutputTokens: undefined,
    seenTokenTotals: new Map<string, number>(),
    seenOutputTokens: new Map<string, number>(),
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

function toNonNegativeInteger(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function messageTokens(info: Record<string, unknown>): Record<string, unknown> {
  return isObject(info.tokens) ? info.tokens : {};
}

function totalTokens(info: Record<string, unknown>): number {
  const tokens = messageTokens(info);
  const explicitTotal = toNonNegativeInteger(tokens.total);
  if (explicitTotal > 0) return explicitTotal;

  return (
    toNonNegativeInteger(tokens.input) +
    toNonNegativeInteger(tokens.output) +
    toNonNegativeInteger(tokens.reasoning)
  );
}

function outputTokens(info: Record<string, unknown>): number {
  return toNonNegativeInteger(messageTokens(info).output);
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
              const previousTotal = tracking.seenTokenTotals.get(messageID) ?? 0;
              const currentTotal = totalTokens(info);
              if (currentTotal > previousTotal) {
                state.total_tokens += currentTotal - previousTotal;
                tracking.seenTokenTotals.set(messageID, currentTotal);
              }

              const previousOutput = tracking.seenOutputTokens.get(messageID) ?? 0;
              const currentOutput = outputTokens(info);
              if (currentOutput > previousOutput) {
                tracking.seenOutputTokens.set(messageID, currentOutput);
                tracking.lastOutputTokens = currentOutput;
              }

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
    }
  };
}
