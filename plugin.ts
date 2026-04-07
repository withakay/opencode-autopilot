import type { Plugin } from "@opencode-ai/plugin";
import { createChatMessageHook } from "./hooks/chat-message.ts";
import type { SessionTracking } from "./hooks/event-handler.ts";
import { createEventHandler, createSessionTracking } from "./hooks/event-handler.ts";
import { createPermissionHook } from "./hooks/permission.ts";
import { createSystemTransformHook } from "./hooks/system-transform.ts";
import { createToolAfterHook } from "./hooks/tool-after.ts";
import {
  buildAutopilotSystemPrompt,
  buildContinuationPrompt,
  formatUsageMetadata,
  inferAutopilotDirective,
  normalizeMaxContinues,
  stripAutopilotMarker,
  summarizeAutopilotState,
} from "./prompts/index.ts";
import { createSessionState } from "./state/factory.ts";
import { SessionCache } from "./state/session-cache.ts";
import { createAutopilotTool } from "./tools/autopilot.ts";
import { createHelpTool } from "./tools/help.ts";
import { createPromptTool } from "./tools/prompt.ts";
import { createStartTool } from "./tools/start.ts";
import { createStatusTool } from "./tools/status.ts";
import { createStopTool } from "./tools/stop.ts";
import type { ExtendedState } from "./types/index.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUTOPILOT_FALLBACK_AGENT = "general";
const MAX_HISTORY_ENTRIES = 10;

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export const AutopilotPlugin: Plugin = async ({ client, directory, worktree }) => {
  // -- Shared state stores (per-session) --
  const stateBySession = new Map<string, ExtendedState>();
  const trackingBySession = new Map<string, SessionTracking>();
  const suppressCountBySession = new Map<string, number>();
  const historyBySession = new Map<string, string[]>();
  const permissionModeBySession = new Map<string, "allow-all" | "limited">();
  const sessionCache = new SessionCache();

  // -- State accessors --
  const getState = (sessionID: string): ExtendedState | undefined => stateBySession.get(sessionID);

  const setState = (sessionID: string, state: ExtendedState): void => {
    stateBySession.set(sessionID, state);
  };

  const deleteState = (sessionID: string): void => {
    stateBySession.delete(sessionID);
    trackingBySession.delete(sessionID);
    suppressCountBySession.delete(sessionID);
    historyBySession.delete(sessionID);
    permissionModeBySession.delete(sessionID);
  };

  const getTracking = (sessionID: string): SessionTracking | undefined =>
    trackingBySession.get(sessionID);

  const initSession = (sessionID: string): void => {
    trackingBySession.set(sessionID, createSessionTracking());
    suppressCountBySession.set(sessionID, 0);
    historyBySession.set(sessionID, []);
  };

  const recordHistory = (sessionID: string, message: string): void => {
    let history = historyBySession.get(sessionID);
    if (!history) {
      history = [];
      historyBySession.set(sessionID, history);
    }
    history.push(message);
    if (history.length > MAX_HISTORY_ENTRIES) {
      historyBySession.set(sessionID, history.slice(-MAX_HISTORY_ENTRIES));
    }
  };

  // -- Toast helper --
  const safeToast = async (opts: {
    title: string;
    message: string;
    variant: "info" | "success" | "warning" | "error";
  }): Promise<void> => {
    try {
      await client.tui.showToast({
        body: {
          title: opts.title,
          message: opts.message,
          variant: opts.variant,
          duration: 3000,
        },
      });
    } catch {
      // Ignore TUI toast failures in non-TUI sessions.
    }
  };

  // -- Stop helper --
  const setStopped = async (
    sessionID: string,
    reason: string,
    detail: string | undefined,
    variant: "info" | "success" | "warning" | "error" = "info",
  ): Promise<void> => {
    const state = getState(sessionID);
    if (!state) return;

    state.mode = "DISABLED";
    state.phase = "STOPPED";
    state.stop_reason = "USER_STOP";
    recordHistory(sessionID, detail ? `${reason}: ${detail}` : reason);

    await safeToast({
      title: "Autopilot stopped",
      message: detail ? `${reason}: ${detail}` : reason,
      variant,
    });
  };

  // -- Dispatch helper --
  const dispatchPrompt = async (
    sessionID: string,
    state: ExtendedState,
    promptText: string,
  ): Promise<void> => {
    const tracking = getTracking(sessionID);
    if (!tracking) return;

    tracking.awaitingWorkerReply = true;
    tracking.lastAssistantMessageID = undefined;

    try {
      // The plugin runtime provides a wrapped client that accepts these
      // named params directly (matching the legacy JS plugin pattern).
      await (client.session.promptAsync as (opts: Record<string, unknown>) => Promise<unknown>)({
        directory,
        workspace: worktree,
        sessionID,
        agent: state.worker_agent,
        parts: [{ type: "text" as const, text: promptText }],
      });
    } catch {
      // Prompt dispatch failure — will be caught by session.error
    }
  };

  // -- Continuation logic (called on session.idle) --
  const maybeContinue = async (sessionID: string): Promise<void> => {
    const state = getState(sessionID);
    const tracking = getTracking(sessionID);
    if (!state || state.mode !== "ENABLED" || !tracking) return;

    // Initial dispatch after arming
    if (
      state.phase === "OBSERVE" &&
      state.continuation_count === 0 &&
      !tracking.lastAssistantMessageID
    ) {
      recordHistory(sessionID, `Starting task with ${state.worker_agent}`);
      await safeToast({
        title: "Autopilot armed",
        message: `Starting task with ${state.worker_agent}`,
        variant: "info",
      });
      await dispatchPrompt(sessionID, state, state.goal);
      return;
    }

    // Permission block check
    if (tracking.blockedByPermission) {
      tracking.blockedByPermission = false;
      await setStopped(
        sessionID,
        "Blocked by permissions",
        tracking.permissionBlockMessage ?? "A required action was denied in limited mode.",
        "warning",
      );
      return;
    }

    // Check for worker reply
    const messageID = tracking.lastAssistantMessageID;
    if (!messageID) return;

    tracking.awaitingWorkerReply = false;
    tracking.lastAssistantMessageID = undefined;

    const assistantText = sessionCache.getMessageText(sessionID, messageID);
    const directive = inferAutopilotDirective(assistantText);

    if (directive.status === "complete") {
      await setStopped(sessionID, "Task completed", directive.reason, "success");
      return;
    }

    if (directive.status === "blocked") {
      await setStopped(sessionID, "Task blocked", directive.reason, "warning");
      return;
    }

    // Check continuation limit
    if (state.continuation_count >= state.max_continues) {
      await setStopped(
        sessionID,
        "Continuation limit reached",
        `Stopped after ${state.continuation_count} autonomous continuations.`,
        "warning",
      );
      return;
    }

    // Continue
    state.continuation_count += 1;
    const usageBits = formatUsageMetadata(
      tracking.lastUsage as Parameters<typeof formatUsageMetadata>[0],
    );
    const suffix = usageBits ? ` (${usageBits})` : "";
    recordHistory(
      sessionID,
      `Continuation ${state.continuation_count}/${state.max_continues}${suffix}`,
    );

    await safeToast({
      title: "Autopilot continuing",
      message: `Continuation ${state.continuation_count}/${state.max_continues}${suffix}`,
      variant: "info",
    });

    await dispatchPrompt(
      sessionID,
      state,
      buildContinuationPrompt({
        continueCount: state.continuation_count,
        maxContinues: state.max_continues,
        task: state.goal,
      }),
    );
  };

  // -- Build hooks --
  const eventHandler = createEventHandler({
    getState,
    deleteState,
    sessionCache,
    getTracking,
    onSessionIdle: maybeContinue,
    onSessionError: async (sessionID, error) => {
      const errorMessage = error?.data?.message ?? "Autopilot encountered an unknown error.";
      const isAbort = error?.name === "MessageAbortedError";
      const reason = isAbort ? "Interrupted" : "Error";
      const variant: "warning" | "error" = isAbort ? "warning" : "error";
      await setStopped(sessionID, reason, errorMessage, variant);
    },
  });

  const permissionHook = createPermissionHook({
    getState,
    getPermissionMode: (sessionID) => permissionModeBySession.get(sessionID),
    onPermissionDenied: (sessionID, permission) => {
      const tracking = getTracking(sessionID);
      if (!tracking) return;
      tracking.blockedByPermission = true;
      const patternStr = Array.isArray(permission.pattern)
        ? permission.pattern.join(", ")
        : (permission.pattern ?? "");
      tracking.permissionBlockMessage = `Denied ${permission.type} ${patternStr}`.trim();
      recordHistory(sessionID, tracking.permissionBlockMessage);
    },
  });

  const systemTransformHook = createSystemTransformHook({
    getState,
    getSuppressCount: (sessionID) => suppressCountBySession.get(sessionID) ?? 0,
    decrementSuppressCount: (sessionID) => {
      const current = suppressCountBySession.get(sessionID) ?? 0;
      if (current > 0) {
        suppressCountBySession.set(sessionID, current - 1);
      }
    },
    buildSystemPrompt: buildAutopilotSystemPrompt,
  });

  const chatMessageHook = createChatMessageHook({
    getState,
    incrementSuppressCount: (sessionID) => {
      const current = suppressCountBySession.get(sessionID) ?? 0;
      suppressCountBySession.set(sessionID, current + 1);
    },
  });

  const toolAfterHook = createToolAfterHook({
    stripMarker: stripAutopilotMarker,
  });

  // -- Build tools --
  const startTool = createStartTool({
    getState,
    setState,
    createSessionState,
    normalizeMaxContinues,
    initSession,
    defaultWorkerAgent: AUTOPILOT_FALLBACK_AGENT,
    onArmed: async (sessionID, state) => {
      // Extract and store permissionMode
      const pm = (state as unknown as Record<string, unknown>).permissionMode;
      if (pm === "allow-all" || pm === "limited") {
        permissionModeBySession.set(sessionID, pm);
      } else {
        permissionModeBySession.set(sessionID, "limited");
      }
      recordHistory(
        sessionID,
        `Armed in ${permissionModeBySession.get(sessionID)} mode with ${state.worker_agent}.`,
      );
      recordHistory(sessionID, `Continuation limit: ${state.max_continues}.`);
    },
  });

  const statusTool = createStatusTool({
    getState,
    summarizeState: summarizeAutopilotState,
    getHistory: (sessionID) => historyBySession.get(sessionID) ?? [],
  });

  const stopTool = createStopTool({
    getState,
    onStop: (sessionID, reason) => {
      const state = getState(sessionID);
      if (!state) return;
      state.mode = "DISABLED";
      state.phase = "STOPPED";
      state.stop_reason = "USER_STOP";
      recordHistory(sessionID, reason ? `Cancelled by user: ${reason}` : "Cancelled by user");
    },
  });

  const helpTool = createHelpTool();
  const promptTool = createPromptTool();
  const autopilotTool = createAutopilotTool({
    startTool,
    statusTool,
    stopTool,
    helpTool,
  });

  // -- Return assembled hooks --
  return {
    tool: {
      autopilot: autopilotTool,
      autopilot_start: startTool,
      autopilot_status: statusTool,
      autopilot_stop: stopTool,
      autopilot_help: helpTool,
      autopilot_prompt: promptTool,
    },

    event: eventHandler,

    "permission.ask": permissionHook,

    "experimental.chat.system.transform": systemTransformHook,

    "chat.message": chatMessageHook,

    "tool.execute.after": toolAfterHook,
  };
};
