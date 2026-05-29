import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Plugin } from "@opencode-ai/plugin";
import { loadAutopilotConfig, summarizeWorkflow } from "./config/autopilot-config.ts";
import { createChatMessageHook } from "./hooks/chat-message.ts";
import type { SessionTracking } from "./hooks/event-handler.ts";
import { createEventHandler, createSessionTracking } from "./hooks/event-handler.ts";
import { createPermissionHook } from "./hooks/permission.ts";
import { createSessionCompactingHook } from "./hooks/session-compacting.ts";
import { createSystemTransformHook } from "./hooks/system-transform.ts";
import { createToolAfterHook } from "./hooks/tool-after.ts";
import {
  buildAutopilotSystemPrompt,
  buildContinuationPrompt,
  buildObjectiveStartPrompt,
  buildPlanStepPrompt,
  formatUsageMetadata,
  inferAutopilotDirective,
  normalizeMaxContinues,
  stripAutopilotMarker,
  summarizeAutopilotState,
} from "./prompts/index.ts";
import { createSessionState } from "./state/factory.ts";
import { createPersistedData, PersistentStateStore } from "./state/persistence.ts";
import { SessionCache } from "./state/session-cache.ts";
import { createAutopilotTool } from "./tools/autopilot.ts";
import type {
  CheckpointStatus,
  ExtendedState,
  StopReason,
  VerificationRecord,
} from "./types/index.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUTOPILOT_FALLBACK_AGENT = "general";
const MAX_HISTORY_ENTRIES = 10;
const VERIFY_TIMEOUT_MS = 120_000;
const execFileAsync = promisify(execFile);

type VerificationResult =
  | { status: "passed" }
  | { status: "failed"; message: string }
  | { status: "blocked"; message: string };

function tokenizeCommand(input: string): string[] | undefined {
  const result: string[] = [];
  const regex = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  let match = regex.exec(input);
  while (match) {
    const token = (match[1] ?? match[2] ?? match[3] ?? "").replace(/\\(["'])/g, "$1");
    if (/[`$|&;<>]/.test(token)) return undefined;
    result.push(token);
    match = regex.exec(input);
  }
  return result.length > 0 ? result : undefined;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export const AutopilotPlugin: Plugin = async ({ client, directory, worktree }) => {
  const root = directory || worktree;
  const config = await loadAutopilotConfig(directory);
  const stateStore = await PersistentStateStore.forRoot(root);

  // -- Shared state stores (per-session) --
  const stateBySession = new Map<string, ExtendedState>();
  const trackingBySession = new Map<string, SessionTracking>();
  const historyBySession = new Map<string, string[]>();
  const permissionModeBySession = new Map<string, "allow-all" | "limited">();
  const pendingAgentBySession = new Map<string, string | undefined>();
  const sessionCache = new SessionCache();

  try {
    const persisted = await stateStore.load();
    for (const [sessionID, state] of Object.entries(persisted.states)) {
      stateBySession.set(sessionID, state);
      trackingBySession.set(sessionID, createSessionTracking());
    }
    for (const [sessionID, history] of Object.entries(persisted.history)) {
      historyBySession.set(sessionID, history.slice(-MAX_HISTORY_ENTRIES));
    }
    for (const [sessionID, mode] of Object.entries(persisted.permissionMode)) {
      permissionModeBySession.set(sessionID, mode);
    }
  } catch {
    // Persistence is a convenience layer; a corrupt state file should not break plugin startup.
  }

  const persistState = async (): Promise<void> => {
    try {
      if (stateBySession.size === 0) {
        await stateStore.clear();
        return;
      }
      await stateStore.save(
        createPersistedData(stateBySession, historyBySession, permissionModeBySession),
      );
    } catch {
      // Keep autopilot responsive even if local persistence fails.
    }
  };

  // -- State accessors --
  const getState = (sessionID: string): ExtendedState | undefined => stateBySession.get(sessionID);

  const setState = (sessionID: string, state: ExtendedState): void => {
    stateBySession.set(sessionID, state);
    void persistState();
  };

  const deleteState = (sessionID: string): void => {
    stateBySession.delete(sessionID);
    trackingBySession.delete(sessionID);
    historyBySession.delete(sessionID);
    permissionModeBySession.delete(sessionID);
    pendingAgentBySession.delete(sessionID);
    void persistState();
  };

  const getTracking = (sessionID: string): SessionTracking | undefined =>
    trackingBySession.get(sessionID);

  const initSession = (sessionID: string): void => {
    trackingBySession.set(sessionID, createSessionTracking());
    if (!historyBySession.has(sessionID)) {
      historyBySession.set(sessionID, []);
    }
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
    void persistState();
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
    } else if (stopReason === "WAITING_FOR_USER_INPUT" || stopReason === "PERMISSION_DENIED") {
      state.status = "blocked";
    } else {
      state.status = "failed";
    }
    state.final_digest = {
      status:
        stopReason === "COMPLETED"
          ? "completed"
          : state.status === "blocked"
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
          : stopReason === "RETRY_EXHAUSTED"
            ? "Review the run card, then resume with a higher continuation cap if appropriate."
            : undefined,
    };
    recordHistory(sessionID, detail ? `${reason}: ${detail}` : reason);
    await persistState();

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
    if (tracking.awaitingWorkerReply) return;

    tracking.awaitingWorkerReply = true;
    tracking.lastAssistantMessageID = undefined;
    if (state.status !== "validating") {
      state.status = "waiting_for_reply";
    }
    await persistState();

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
      tracking.awaitingWorkerReply = false;
      state.status = "failed";
      state.mode = "DISABLED";
      state.phase = "STOPPED";
      state.stop_reason = "UNRECOVERABLE_ERROR";
      recordHistory(sessionID, "Prompt dispatch failed.");
      await persistState();
    }
  };

  const activePlanStep = (state: ExtendedState) => {
    if (state.active_step_index < 0) return undefined;
    const step = state.plan[state.active_step_index];
    return step?.status === "in_progress" ? step : undefined;
  };

  const currentCheckpoint = (state: ExtendedState) =>
    state.checkpoints.find((checkpoint) => checkpoint.id === state.current_checkpoint);

  const appendCheckpointEvidence = (state: ExtendedState, evidence: string | undefined): void => {
    const trimmed = evidence?.trim();
    if (!trimmed) return;
    const checkpoint = currentCheckpoint(state);
    if (!checkpoint) return;
    checkpoint.evidence.push(trimmed);
    if (checkpoint.evidence.length > 8) checkpoint.evidence = checkpoint.evidence.slice(-8);
  };

  const finishCheckpoint = (
    state: ExtendedState,
    status: CheckpointStatus,
    evidence?: string,
  ): void => {
    const checkpoint = currentCheckpoint(state);
    if (!checkpoint) return;
    appendCheckpointEvidence(state, evidence);
    checkpoint.status = status;
    checkpoint.completed_at = new Date().toISOString();
  };

  const startCheckpoint = (state: ExtendedState, title: string, evidence?: string): void => {
    const active = currentCheckpoint(state);
    if (active?.status === "active" && active.title === title) {
      appendCheckpointEvidence(state, evidence);
      return;
    }

    const checkpoint = {
      id: `checkpoint-${state.checkpoints.length + 1}`,
      title,
      status: "active" as const,
      evidence: evidence?.trim() ? [evidence.trim()] : [],
      started_at: new Date().toISOString(),
    };
    state.checkpoints.push(checkpoint);
    state.current_checkpoint = checkpoint.id;
  };

  const recordVerification = (state: ExtendedState, verification: VerificationRecord): void => {
    state.last_verification = verification;
    const verificationCriterion = state.goal_contract.criteria.find((criterion) =>
      criterion.text.startsWith("Verification command passes:"),
    );
    if (verificationCriterion) {
      verificationCriterion.status = verification.status === "passed" ? "verified" : "pending";
      verificationCriterion.evidence = verification.summary;
    }
  };

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

  const dispatchValidationPrompt = async (
    sessionID: string,
    state: ExtendedState,
    candidateCompletion: string,
  ): Promise<void> => {
    if (state.continuation_count >= state.max_continues) {
      await setStopped(
        sessionID,
        "Continuation limit reached",
        `Stopped after ${state.continuation_count} autonomous continuations before validation could run.`,
        "warning",
        "RETRY_EXHAUSTED",
      );
      return;
    }

    state.status = "validating";
    state.candidate_completion = candidateCompletion;
    state.continuation_count += 1;
    startCheckpoint(state, "Validation checkpoint", candidateCompletion);
    await safeToast({
      title: "Autopilot validating",
      message: "Verifying objective completion before finalizing",
      variant: "info",
    });
    await dispatchPrompt(
      sessionID,
      state,
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
      }),
    );
  };

  const runVerification = async (state: ExtendedState): Promise<VerificationResult> => {
    const command = state.verify_with?.trim();
    if (!command) {
      recordVerification(state, {
        status: "passed",
        summary: "No verification command configured.",
      });
      return { status: "passed" };
    }
    const permissionMode = permissionModeBySession.get(state.session_id);
    if (permissionMode !== "allow-all") {
      recordVerification(state, {
        command,
        status: "blocked",
        summary: `Verification command requires allow-all permission mode: ${command}`,
      });
      return {
        status: "blocked",
        message: `Verification command requires allow-all permission mode: ${command}`,
      };
    }

    const tokens = tokenizeCommand(command);
    if (!tokens) {
      recordVerification(state, {
        command,
        status: "blocked",
        summary: `Verification command must be a simple command with arguments, not shell syntax: ${command}`,
      });
      return {
        status: "blocked",
        message: `Verification command must be a simple command with arguments, not shell syntax: ${command}`,
      };
    }

    const [file, ...args] = tokens;
    if (!file) {
      recordVerification(state, {
        command,
        status: "blocked",
        summary: "Verification command is empty.",
      });
      return { status: "blocked", message: "Verification command is empty." };
    }

    try {
      await execFileAsync(file, args, {
        cwd: directory || worktree,
        timeout: VERIFY_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
      });
      recordVerification(state, {
        command,
        status: "passed",
        summary: `Verification command passed: ${command}`,
      });
      return { status: "passed" };
    } catch (error) {
      const err = error as {
        code?: unknown;
        signal?: unknown;
        stderr?: string;
        stdout?: string;
        message?: string;
      };
      const output = (
        err.stderr ||
        err.stdout ||
        err.message ||
        "verification command failed"
      ).trim();
      const firstLine = output.split(/\r?\n/).find(Boolean) ?? output;
      recordVerification(state, {
        command,
        status: "failed",
        summary: `Verification command failed (${command}): ${firstLine}`,
      });
      return {
        status: "failed",
        message: `Verification command failed (${command}): ${firstLine}`,
      };
    }
  };

  const continueAfterVerificationFailure = async (
    sessionID: string,
    state: ExtendedState,
    failure: string,
  ): Promise<void> => {
    state.status = "active";
    state.candidate_completion = undefined;
    finishCheckpoint(state, "failed", failure);
    startCheckpoint(state, "Repair verification failure", failure);
    recordHistory(sessionID, failure);

    if (state.continuation_count >= state.max_continues) {
      await setStopped(
        sessionID,
        "Continuation limit reached",
        `Stopped after ${state.continuation_count} autonomous continuations after verification failed.`,
        "warning",
        "RETRY_EXHAUSTED",
      );
      return;
    }

    state.continuation_count += 1;
    await dispatchPrompt(
      sessionID,
      state,
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
      }),
    );
  };

  // -- Continuation logic (called on session.idle) --
  const maybeContinue = async (sessionID: string): Promise<void> => {
    const state = getState(sessionID);
    const tracking = getTracking(sessionID);
    if (!state || state.mode !== "ENABLED" || !tracking) return;
    if (state.run_mode !== "objective") return;
    if (!["active", "validating", "waiting_for_reply"].includes(state.status)) return;

    // Initial dispatch after arming
    if (
      state.phase === "OBSERVE" &&
      state.continuation_count === 0 &&
      !tracking.lastAssistantMessageID &&
      !tracking.awaitingWorkerReply &&
      state.session_mode === "delegated-task"
    ) {
      recordHistory(sessionID, `Starting objective with ${state.worker_agent}`);
      appendCheckpointEvidence(state, `Started objective with ${state.worker_agent}.`);
      await safeToast({
        title: "Autopilot armed",
        message: `Starting objective with ${state.worker_agent}`,
        variant: "info",
      });
      await dispatchPrompt(sessionID, state, buildNextWorkPrompt(state, state.continuation_count));
      return;
    }

    // Permission block check
    if (tracking.blockedByPermission) {
      tracking.blockedByPermission = false;
      state.status = "blocked";
      await setStopped(
        sessionID,
        "Blocked by permissions",
        tracking.permissionBlockMessage ?? "A required action was denied in limited mode.",
        "warning",
        "PERMISSION_DENIED",
      );
      return;
    }

    if (
      state.status === "validating" &&
      state.candidate_completion &&
      !tracking.lastAssistantMessageID &&
      !tracking.awaitingWorkerReply
    ) {
      await dispatchPrompt(
        sessionID,
        state,
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
        }),
      );
      return;
    }

    // Resumed objective runs may already have progress, so they need a fresh
    // continuation even though they are not an initial dispatch.
    if (
      state.status === "active" &&
      state.continuation_count > 0 &&
      !tracking.lastAssistantMessageID &&
      !tracking.awaitingWorkerReply
    ) {
      if (state.continuation_count >= state.max_continues) {
        await setStopped(
          sessionID,
          "Continuation limit reached",
          `Stopped after ${state.continuation_count} autonomous continuations.`,
          "warning",
          "RETRY_EXHAUSTED",
        );
        return;
      }

      state.continuation_count += 1;
      recordHistory(
        sessionID,
        `Continuation ${state.continuation_count}/${state.max_continues} after resume`,
      );
      await dispatchPrompt(
        sessionID,
        state,
        buildNextWorkPrompt(state, state.continuation_count, true),
      );
      return;
    }

    // Check for worker reply
    const messageID = tracking.lastAssistantMessageID;
    if (!messageID) return;

    tracking.awaitingWorkerReply = false;
    tracking.lastAssistantMessageID = undefined;
    if (state.status === "waiting_for_reply") {
      state.status = "active";
    }

    const assistantText = sessionCache.getMessageText(sessionID, messageID);
    const directive = inferAutopilotDirective(assistantText, config);
    appendCheckpointEvidence(state, directive.reason);

    const currentStep = activePlanStep(state);
    if (directive.status === "step-done" && !currentStep) {
      recordHistory(sessionID, `Ignored step-done without active plan step: ${directive.reason}`);
    }

    if (
      currentStep &&
      (directive.status === "step-done" ||
        directive.status === "complete" ||
        directive.status === "validate")
    ) {
      const step = currentStep;
      const completedStepNumber = state.active_step_index + 1;
      step.status = "done";
      step.evidence = directive.reason;
      finishCheckpoint(state, "done", directive.reason);
      recordHistory(
        sessionID,
        `Plan step ${completedStepNumber}/${state.plan.length} done: ${directive.reason}`,
      );

      const nextStepIndex = state.active_step_index + 1;
      const nextStep = state.plan[nextStepIndex];
      if (!nextStep) {
        state.active_step_index = -1;
        await dispatchValidationPrompt(
          sessionID,
          state,
          `All ${state.plan.length} plan steps completed. ${directive.reason}`,
        );
        return;
      }

      if (state.continuation_count >= state.max_continues) {
        await setStopped(
          sessionID,
          "Continuation limit reached",
          `Stopped after ${state.continuation_count} autonomous continuations before the next plan step could run.`,
          "warning",
          "RETRY_EXHAUSTED",
        );
        return;
      }

      state.active_step_index = nextStepIndex;
      nextStep.status = "in_progress";
      startCheckpoint(state, nextStep.title);
      state.continuation_count += 1;
      await safeToast({
        title: "Autopilot plan step complete",
        message: `${completedStepNumber}/${state.plan.length}: ${step.title}`,
        variant: "info",
      });
      await dispatchPrompt(sessionID, state, buildNextWorkPrompt(state, state.continuation_count));
      return;
    }

    if (directive.status === "complete") {
      if (state.status !== "validating") {
        await dispatchValidationPrompt(sessionID, state, directive.reason);
        return;
      }

      const verification = await runVerification(state);
      if (verification.status === "blocked") {
        state.status = "blocked";
        finishCheckpoint(state, "blocked", verification.message);
        await setStopped(
          sessionID,
          "Verification blocked",
          verification.message,
          "warning",
          "WAITING_FOR_USER_INPUT",
        );
        return;
      }

      if (verification.status === "failed") {
        await continueAfterVerificationFailure(sessionID, state, verification.message);
        return;
      }

      finishCheckpoint(state, "done", state.last_verification?.summary ?? directive.reason);
      state.status = "completed";
      await setStopped(sessionID, "Objective completed", directive.reason, "success", "COMPLETED");
      return;
    }

    if (directive.status === "blocked") {
      state.status = "blocked";
      state.candidate_completion = undefined;
      finishCheckpoint(state, "blocked", directive.reason);
      await setStopped(
        sessionID,
        "Objective blocked",
        directive.reason,
        "warning",
        "WAITING_FOR_USER_INPUT",
      );
      return;
    }

    if (directive.status === "validate") {
      // Objective appears done but needs verification before final completion.
      await dispatchValidationPrompt(sessionID, state, directive.reason);
      return;
    }

    // Check continuation limit
    if (state.continuation_count >= state.max_continues) {
      await setStopped(
        sessionID,
        "Continuation limit reached",
        `Stopped after ${state.continuation_count} autonomous continuations.`,
        "warning",
        "RETRY_EXHAUSTED",
      );
      return;
    }

    // Continue
    state.candidate_completion = undefined;
    state.status = "active";
    state.continuation_count += 1;
    startCheckpoint(state, `Continuation ${state.continuation_count}`, directive.reason);
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

    await dispatchPrompt(sessionID, state, buildNextWorkPrompt(state, state.continuation_count));
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
      await setStopped(
        sessionID,
        reason,
        errorMessage,
        variant,
        isAbort ? "USER_STOP" : "UNRECOVERABLE_ERROR",
      );
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
    consumePendingAgent: (sessionID) => {
      const agent = pendingAgentBySession.get(sessionID);
      pendingAgentBySession.delete(sessionID);
      return agent;
    },
    getConfig: () => config,
    buildSystemPrompt: buildAutopilotSystemPrompt,
  });

  const chatMessageHook = createChatMessageHook({
    getState,
    setPendingAgent: (sessionID, agent) => {
      pendingAgentBySession.set(sessionID, agent);
    },
  });

  const sessionCompactingHook = createSessionCompactingHook({
    getState,
    getHistory: (sessionID) => historyBySession.get(sessionID) ?? [],
    getConfig: () => config,
    summarizeWorkflow,
  });

  const toolAfterHook = createToolAfterHook({
    stripMarker: stripAutopilotMarker,
  });

  // -- Build tools --
  const stopSession = (sessionID: string, reason: string | undefined) => {
    const state = getState(sessionID);
    if (!state) return;
    state.mode = "DISABLED";
    state.phase = "STOPPED";
    state.stop_reason = "USER_STOP";
    state.status = "cleared";
    recordHistory(sessionID, reason ? `Cancelled by user: ${reason}` : "Cancelled by user");
    void persistState();
  };

  const autopilotTool = createAutopilotTool({
    getState,
    setState,
    createSessionState,
    normalizeMaxContinues,
    initSession,
    summarizeState: summarizeAutopilotState,
    getHistory: (sessionID) => historyBySession.get(sessionID) ?? [],
    onStop: stopSession,
    defaultWorkerAgent: AUTOPILOT_FALLBACK_AGENT,
    onStateChanged: async () => {
      await persistState();
    },
    onResumed: async (sessionID, state, permissionMode) => {
      if (permissionMode) {
        permissionModeBySession.set(sessionID, permissionMode);
        recordHistory(sessionID, `Objective resumed in ${permissionMode} mode.`);
      }

      recordHistory(sessionID, `Objective resumed with ${state.worker_agent}.`);
      await persistState();
    },
    onArmed: async (sessionID, state, permissionMode) => {
      permissionModeBySession.set(sessionID, permissionMode);

      if (state.session_mode === "delegated-task") {
        recordHistory(
          sessionID,
          `Objective run armed in ${permissionModeBySession.get(sessionID)} mode with ${state.worker_agent}.`,
        );
        recordHistory(sessionID, `Objective: ${state.objective}.`);
        if (state.done_when) recordHistory(sessionID, `Done when: ${state.done_when}.`);
        if (state.verify_with) recordHistory(sessionID, `Verify with: ${state.verify_with}.`);
        if (state.plan.length > 0) recordHistory(sessionID, `Plan steps: ${state.plan.length}.`);
        recordHistory(sessionID, `Continuation limit: ${state.max_continues}.`);
        await persistState();
        return;
      }

      recordHistory(
        sessionID,
        `Session autopilot enabled in ${permissionModeBySession.get(sessionID)} mode.`,
      );
      recordHistory(
        sessionID,
        `Delegate agent ready: ${state.worker_agent}. Long-running tasks will use this agent.`,
      );
      await persistState();
    },
  });

  // -- Return assembled hooks --
  return {
    tool: {
      autopilot: autopilotTool,
    },

    event: eventHandler,

    "permission.ask": permissionHook,

    "experimental.chat.system.transform": systemTransformHook,

    "chat.message": chatMessageHook,

    "experimental.session.compacting": sessionCompactingHook,

    "tool.execute.after": toolAfterHook,
  };
};
