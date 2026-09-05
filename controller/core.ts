import type { Plugin } from "@opencode-ai/plugin";
import type { AutopilotConfig } from "../config/autopilot-config.ts";
import type { SessionTracking } from "../hooks/event-handler.ts";
import { createSessionTracking } from "../hooks/event-handler.ts";
import {
  buildContinuationPrompt,
  buildObjectiveStartPrompt,
  buildPlanStepPrompt,
  summarizeAutopilotState,
} from "../prompts/index.ts";
import type { PersistedSessionEntry, StorageStateStore } from "../state/persistence.ts";
import type { ExtendedState, StopReason } from "../types/index.ts";
import { activePlanStep, budgetStopMessage } from "./checkpoints.ts";

export const MAX_HISTORY_ENTRIES = 10;
export const AUTOPILOT_FALLBACK_AGENT = "general";

export type NoticeVariant = "info" | "success" | "warning" | "error";
export type PermissionMode = "allow-all" | "limited";
export type SessionDomain = Plugin.Context["session"];

export interface CoreOptions {
  config: AutopilotConfig;
  directory: string;
  session: SessionDomain;
  store: StorageStateStore;
  notice: (sessionID: string, title: string, message: string, variant: NoticeVariant) => void;
}

export type Core = ReturnType<typeof createCore>;

export function createCore(options: CoreOptions) {
  const { config, directory, session, store, notice } = options;

  const stateBySession = new Map<string, ExtendedState>();
  const trackingBySession = new Map<string, SessionTracking>();
  const historyBySession = new Map<string, string[]>();
  const permissionModeBySession = new Map<string, PermissionMode>();

  const getState = (sessionID: string): ExtendedState | undefined => stateBySession.get(sessionID);
  const getTracking = (sessionID: string): SessionTracking | undefined =>
    trackingBySession.get(sessionID);
  const getHistory = (sessionID: string): string[] => historyBySession.get(sessionID) ?? [];
  const getPermissionMode = (sessionID: string): PermissionMode | undefined =>
    permissionModeBySession.get(sessionID);

  const persist = (sessionID: string): void => {
    const state = stateBySession.get(sessionID);
    if (!state) {
      void store.remove(sessionID).catch(() => {});
      return;
    }
    const entry: PersistedSessionEntry = {
      version: 2,
      state,
      history: getHistory(sessionID),
      permissionMode: permissionModeBySession.get(sessionID) ?? "allow-all",
    };
    void store.save(sessionID, entry).catch(() => {});
  };

  const setState = (sessionID: string, state: ExtendedState): void => {
    stateBySession.set(sessionID, state);
    persist(sessionID);
  };

  const deleteState = (sessionID: string): void => {
    stateBySession.delete(sessionID);
    trackingBySession.delete(sessionID);
    historyBySession.delete(sessionID);
    permissionModeBySession.delete(sessionID);
    void store.remove(sessionID).catch(() => {});
  };

  const initSession = (sessionID: string): void => {
    trackingBySession.set(sessionID, createSessionTracking());
    if (!historyBySession.has(sessionID)) historyBySession.set(sessionID, []);
  };

  const setPermissionMode = (sessionID: string, mode: PermissionMode): void => {
    permissionModeBySession.set(sessionID, mode);
  };

  const recordHistory = (sessionID: string, message: string): void => {
    const history = historyBySession.get(sessionID) ?? [];
    history.push(message);
    historyBySession.set(sessionID, history.slice(-MAX_HISTORY_ENTRIES));
    persist(sessionID);
  };

  const statusText = (sessionID: string): string => {
    const state = getState(sessionID);
    if (!state) return summarizeAutopilotState(state);
    const history = getHistory(sessionID);
    const historyStr = history.length > 0 ? `\nRecent events:\n- ${history.join("\n- ")}` : "";
    return `${summarizeAutopilotState(state)}${historyStr}`;
  };

  // -- Restart recovery ------------------------------------------------------
  const recover = async (): Promise<void> => {
    let entries: Map<string, PersistedSessionEntry>;
    try {
      entries = await store.load();
    } catch {
      // Persistence is a convenience layer; a corrupt store must not break startup.
      return;
    }

    for (const [sessionID, entry] of entries) {
      const state = entry.state;
      let recovered = false;
      if (
        state.mode === "ENABLED" &&
        state.run_mode === "objective" &&
        ["active", "waiting_for_reply", "validating"].includes(state.status)
      ) {
        state.mode = "DISABLED";
        state.phase = "STOPPED";
        state.status = "paused";
        state.stop_reason = "RECOVERED_AFTER_RESTART";
        state.final_digest = {
          status: "blocked",
          reason:
            "Recovered after plugin restart; autonomous continuation is paused to avoid replaying work.",
          evidence: state.checkpoints.flatMap((checkpoint) => checkpoint.evidence).slice(-6),
          next_action: "Review /autopilot status, then run /autopilot resume when ready.",
        };
        recovered = true;
      }

      stateBySession.set(sessionID, state);
      trackingBySession.set(sessionID, createSessionTracking());
      permissionModeBySession.set(sessionID, entry.permissionMode);
      const history = recovered
        ? [
            ...entry.history,
            "Recovered after plugin restart; paused objective until /autopilot resume.",
          ]
        : entry.history;
      historyBySession.set(sessionID, history.slice(-MAX_HISTORY_ENTRIES));
      if (recovered) persist(sessionID);
    }
  };

  // -- Stop helper -----------------------------------------------------------
  const setStopped = async (
    sessionID: string,
    reason: string,
    detail: string | undefined,
    variant: NoticeVariant = "info",
    stopReason: StopReason = "USER_STOP",
  ): Promise<void> => {
    const state = getState(sessionID);
    if (!state) return;

    state.mode = "DISABLED";
    state.phase = "STOPPED";
    state.stop_reason = stopReason;
    if (stopReason === "COMPLETED") {
      state.status = "completed";
      for (const criterion of state.goal_contract.criteria) {
        if (criterion.status === "pending") {
          criterion.status = "verified";
          criterion.evidence = detail ?? reason;
        }
      }
    } else if (stopReason === "USER_STOP") {
      state.status = "cleared";
    } else if (stopReason === "NO_PROGRESS") {
      state.status = "paused";
    } else if (stopReason === "WAITING_FOR_USER_INPUT" || stopReason === "PERMISSION_DENIED") {
      state.status = "blocked";
    } else {
      state.status = "failed";
    }
    state.final_digest = {
      status:
        stopReason === "COMPLETED"
          ? "completed"
          : state.status === "blocked" || state.status === "paused"
            ? "blocked"
            : state.status === "cleared"
              ? "cleared"
              : "failed",
      reason: detail ? `${reason}: ${detail}` : reason,
      evidence: [
        ...state.checkpoints.flatMap((checkpoint) => checkpoint.evidence).slice(-6),
        state.last_verification
          ? `${state.last_verification.status}: ${state.last_verification.summary}`
          : undefined,
      ].filter((item): item is string => Boolean(item)),
      next_action:
        state.status === "blocked"
          ? "Resolve the blocker, then run /autopilot resume."
          : state.status === "paused"
            ? "Review the run card, then run /autopilot resume if the objective still has a safe next action."
            : stopReason === "RETRY_EXHAUSTED"
              ? "Review the run card, then resume with a higher continuation cap if appropriate."
              : undefined,
    };
    recordHistory(sessionID, detail ? `${reason}: ${detail}` : reason);
    notice(sessionID, "Autopilot stopped", detail ? `${reason}: ${detail}` : reason, variant);
  };

  // -- Dispatch --------------------------------------------------------------
  const dispatchPrompt = async (
    sessionID: string,
    state: ExtendedState,
    promptText: string,
    description: string,
  ): Promise<void> => {
    const tracking = getTracking(sessionID);
    if (!tracking || tracking.awaitingWorkerReply) return;

    tracking.awaitingWorkerReply = true;
    tracking.dispatchedAt = Date.now();
    tracking.selfInterrupt = false;
    if (state.status !== "validating") {
      state.status = "waiting_for_reply";
    }
    persist(sessionID);

    try {
      await session.synthetic({
        sessionID,
        text: promptText,
        // TUI shows the description only when non-blank; keep it non-blank.
        description: description.trim() || "Autopilot",
      });
    } catch {
      tracking.awaitingWorkerReply = false;
      state.status = "failed";
      state.mode = "DISABLED";
      state.phase = "STOPPED";
      state.stop_reason = "UNRECOVERABLE_ERROR";
      recordHistory(sessionID, "Prompt dispatch failed.");
    }
  };

  const interruptWorker = async (sessionID: string): Promise<void> => {
    const tracking = getTracking(sessionID);
    if (!tracking?.awaitingWorkerReply) return;
    tracking.awaitingWorkerReply = false;
    tracking.selfInterrupt = true;
    try {
      await session.interrupt({ sessionID, continue: false });
    } catch {
      tracking.selfInterrupt = false;
    }
  };

  // -- Budgets / no-progress -------------------------------------------------
  const stopIfBudgetExceeded = async (
    sessionID: string,
    state: ExtendedState,
  ): Promise<boolean> => {
    const message = budgetStopMessage(state);
    if (!message) return false;
    await setStopped(sessionID, "Budget exhausted", message, "warning", "BUDGET_EXHAUSTED");
    return true;
  };

  const updateNoProgressState = async (
    sessionID: string,
    state: ExtendedState,
    outputTokens: number | undefined,
    assistantText: string,
    directiveStatus: string,
  ): Promise<boolean> => {
    if (directiveStatus !== "continue") {
      state.no_progress_turns = 0;
      return false;
    }

    const lowOutput =
      outputTokens !== undefined && outputTokens < state.no_progress_token_threshold;
    if (!lowOutput && assistantText.trim()) {
      state.no_progress_turns = 0;
      return false;
    }

    state.no_progress_turns += 1;
    recordHistory(
      sessionID,
      `Low-progress worker turn ${state.no_progress_turns}/${state.no_progress_turns_before_pause}.`,
    );

    if (state.no_progress_turns < state.no_progress_turns_before_pause) return false;

    await setStopped(
      sessionID,
      "No progress detected",
      `Paused after ${state.no_progress_turns} low-progress worker turn(s).`,
      "warning",
      "NO_PROGRESS",
    );
    return true;
  };

  // -- Prompt selection ------------------------------------------------------
  const buildNextWorkPrompt = (
    state: ExtendedState,
    continueCount: number,
    isResume = false,
  ): string => {
    const step = activePlanStep(state);
    if (step) {
      return buildPlanStepPrompt({
        continueCount,
        maxContinues: state.max_continues,
        objective: state.objective,
        doneWhen: state.done_when,
        verifyWith: state.verify_with,
        planSource: state.plan_source,
        planningFramework: state.planning_framework,
        step,
        stepIndex: state.active_step_index,
        stepCount: state.plan.length,
        config,
      });
    }

    if (isResume || continueCount > 0) {
      return buildContinuationPrompt({
        continueCount,
        maxContinues: state.max_continues,
        objective: state.objective,
        doneWhen: state.done_when,
        verifyWith: state.verify_with,
        planSource: state.plan_source,
        planningFramework: state.planning_framework,
        config,
      });
    }

    return buildObjectiveStartPrompt({
      objective: state.objective,
      doneWhen: state.done_when,
      verifyWith: state.verify_with,
      planSource: state.plan_source,
      planningFramework: state.planning_framework,
      config,
    });
  };

  const buildValidationPrompt = (state: ExtendedState): string =>
    buildContinuationPrompt({
      continueCount: state.continuation_count,
      maxContinues: state.max_continues,
      objective: state.objective,
      doneWhen: state.done_when,
      verifyWith: state.verify_with,
      planSource: state.plan_source,
      planningFramework: state.planning_framework,
      candidateCompletion: state.candidate_completion,
      isValidation: true,
      config,
    });

  const buildRepairPrompt = (state: ExtendedState, failure: string): string =>
    buildContinuationPrompt({
      continueCount: state.continuation_count,
      maxContinues: state.max_continues,
      objective: state.objective,
      doneWhen: state.done_when,
      verifyWith: state.verify_with,
      planSource: state.plan_source,
      planningFramework: state.planning_framework,
      verificationFailure: failure,
      config,
    });

  return {
    config,
    directory,
    session,
    notice,
    getState,
    setState,
    deleteState,
    getTracking,
    initSession,
    getHistory,
    recordHistory,
    getPermissionMode,
    setPermissionMode,
    persist,
    recover,
    statusText,
    setStopped,
    dispatchPrompt,
    interruptWorker,
    stopIfBudgetExceeded,
    updateNoProgressState,
    buildNextWorkPrompt,
    buildValidationPrompt,
    buildRepairPrompt,
  };
}
