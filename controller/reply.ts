// Terminal-event handling for objective runs: reads the worker's reply through
// ctx.session.context and applies the v1 continuation decision logic.
import { inferAutopilotDirective } from "../prompts/index.ts";
import type { ExtendedState } from "../types/index.ts";
import {
  activePlanStep,
  appendCheckpointEvidence,
  finishCheckpoint,
  startCheckpoint,
} from "./checkpoints.ts";
import type { Core } from "./core.ts";
import { runVerification } from "./verification.ts";

interface WorkerReply {
  text: string;
  outputTokens: number | undefined;
  totalTokens: number;
}

async function readWorkerReply(core: Core, sessionID: string, since: number): Promise<WorkerReply> {
  let totalTokens = 0;
  let outputTokens: number | undefined;
  let text = "";
  try {
    const messages = await core.session.context({ sessionID });
    const replies = messages.filter(
      (message) => message.type === "assistant" && message.time.created >= since,
    );
    for (const message of replies) {
      if (message.type !== "assistant") continue;
      const tokens = message.tokens;
      if (tokens) totalTokens += tokens.input + tokens.output + tokens.reasoning;
    }
    const last = replies.at(-1);
    if (last?.type === "assistant") {
      text = last.content
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join("\n");
      outputTokens = last.tokens?.output;
    }
  } catch {
    // A context read failure leaves an empty reply; the directive fallback
    // treats it as blocked, which is the safe outcome.
  }
  return { text, outputTokens, totalTokens };
}

async function dispatchValidationPrompt(
  core: Core,
  sessionID: string,
  state: ExtendedState,
  candidateCompletion: string,
): Promise<void> {
  if (state.continuation_count >= state.max_continues) {
    await core.setStopped(
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
  core.notice(
    sessionID,
    "Autopilot validating",
    "Verifying objective completion before finalizing",
    "info",
  );
  await core.dispatchPrompt(
    sessionID,
    state,
    core.buildValidationPrompt(state),
    `Autopilot validation ${state.continuation_count}/${state.max_continues}`,
  );
}

async function continueAfterVerificationFailure(
  core: Core,
  sessionID: string,
  state: ExtendedState,
  failure: string,
): Promise<void> {
  state.status = "active";
  state.candidate_completion = undefined;
  finishCheckpoint(state, "failed", failure);
  startCheckpoint(state, "Repair verification failure", failure);
  core.recordHistory(sessionID, failure);

  if (state.continuation_count >= state.max_continues) {
    await core.setStopped(
      sessionID,
      "Continuation limit reached",
      `Stopped after ${state.continuation_count} autonomous continuations after verification failed.`,
      "warning",
      "RETRY_EXHAUSTED",
    );
    return;
  }

  state.continuation_count += 1;
  await core.dispatchPrompt(
    sessionID,
    state,
    core.buildRepairPrompt(state, failure),
    `Autopilot continuation ${state.continuation_count}/${state.max_continues}`,
  );
}

export async function handleExecutionSucceeded(
  core: Core,
  sessionID: string,
  created: number,
): Promise<void> {
  const state = core.getState(sessionID);
  const tracking = core.getTracking(sessionID);
  if (!state || !tracking || state.mode !== "ENABLED") return;
  if (state.run_mode !== "objective") return;
  if (!["active", "validating", "waiting_for_reply"].includes(state.status)) return;
  if (!tracking.awaitingWorkerReply) return;
  // Ignore execution ends that predate the dispatch (e.g. the turn that ran
  // the /autopilot command itself).
  if (created < tracking.dispatchedAt) return;

  tracking.awaitingWorkerReply = false;
  if (state.status === "waiting_for_reply") state.status = "active";

  if (tracking.blockedByPermission) {
    tracking.blockedByPermission = false;
    state.status = "blocked";
    await core.setStopped(
      sessionID,
      "Blocked by permissions",
      tracking.permissionBlockMessage ?? "A required action was denied in limited mode.",
      "warning",
      "PERMISSION_DENIED",
    );
    return;
  }

  const reply = await readWorkerReply(core, sessionID, tracking.dispatchedAt);
  state.total_tokens += reply.totalTokens;

  const directive = inferAutopilotDirective(reply.text, core.config);
  appendCheckpointEvidence(state, directive.reason);
  if (await core.stopIfBudgetExceeded(sessionID, state)) return;
  if (
    await core.updateNoProgressState(
      sessionID,
      state,
      reply.outputTokens,
      reply.text,
      directive.status,
    )
  ) {
    return;
  }

  const currentStep = activePlanStep(state);
  if (directive.status === "step-done" && !currentStep) {
    core.recordHistory(
      sessionID,
      `Ignored step-done without active plan step: ${directive.reason}`,
    );
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
    core.recordHistory(
      sessionID,
      `Plan step ${completedStepNumber}/${state.plan.length} done: ${directive.reason}`,
    );

    const nextStepIndex = state.active_step_index + 1;
    const nextStep = state.plan[nextStepIndex];
    if (!nextStep) {
      state.active_step_index = -1;
      await dispatchValidationPrompt(
        core,
        sessionID,
        state,
        `All ${state.plan.length} plan steps completed. ${directive.reason}`,
      );
      return;
    }

    if (state.continuation_count >= state.max_continues) {
      await core.setStopped(
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
    core.notice(
      sessionID,
      "Autopilot plan step complete",
      `${completedStepNumber}/${state.plan.length}: ${step.title}`,
      "info",
    );
    await core.dispatchPrompt(
      sessionID,
      state,
      core.buildNextWorkPrompt(state, state.continuation_count),
      `Autopilot plan step ${nextStepIndex + 1}/${state.plan.length}`,
    );
    return;
  }

  if (directive.status === "complete") {
    if (state.status !== "validating") {
      await dispatchValidationPrompt(core, sessionID, state, directive.reason);
      return;
    }

    const verification = await runVerification(
      state,
      core.getPermissionMode(sessionID),
      core.directory,
    );
    if (verification.status === "blocked") {
      state.status = "blocked";
      finishCheckpoint(state, "blocked", verification.message);
      await core.setStopped(
        sessionID,
        "Verification blocked",
        verification.message,
        "warning",
        "WAITING_FOR_USER_INPUT",
      );
      return;
    }

    if (verification.status === "failed") {
      await continueAfterVerificationFailure(core, sessionID, state, verification.message);
      return;
    }

    finishCheckpoint(state, "done", state.last_verification?.summary ?? directive.reason);
    state.status = "completed";
    await core.setStopped(
      sessionID,
      "Objective completed",
      directive.reason,
      "success",
      "COMPLETED",
    );
    return;
  }

  if (directive.status === "blocked") {
    state.status = "blocked";
    state.candidate_completion = undefined;
    finishCheckpoint(state, "blocked", directive.reason);
    await core.setStopped(
      sessionID,
      "Objective blocked",
      directive.reason,
      "warning",
      "WAITING_FOR_USER_INPUT",
    );
    return;
  }

  if (directive.status === "validate") {
    await dispatchValidationPrompt(core, sessionID, state, directive.reason);
    return;
  }

  // Continue
  if (state.continuation_count >= state.max_continues) {
    await core.setStopped(
      sessionID,
      "Continuation limit reached",
      `Stopped after ${state.continuation_count} autonomous continuations.`,
      "warning",
      "RETRY_EXHAUSTED",
    );
    return;
  }
  if (await core.stopIfBudgetExceeded(sessionID, state)) return;

  state.candidate_completion = undefined;
  state.status = "active";
  state.continuation_count += 1;
  startCheckpoint(state, `Continuation ${state.continuation_count}`, directive.reason);
  core.recordHistory(sessionID, `Continuation ${state.continuation_count}/${state.max_continues}`);
  core.notice(
    sessionID,
    "Autopilot continuing",
    `Continuation ${state.continuation_count}/${state.max_continues}`,
    "info",
  );
  await core.dispatchPrompt(
    sessionID,
    state,
    core.buildNextWorkPrompt(state, state.continuation_count),
    `Autopilot continuation ${state.continuation_count}/${state.max_continues}`,
  );
}

export async function handleExecutionFailed(
  core: Core,
  sessionID: string,
  message: string,
): Promise<void> {
  const state = core.getState(sessionID);
  if (!state || state.mode !== "ENABLED" || state.run_mode !== "objective") return;
  const tracking = core.getTracking(sessionID);
  if (tracking) tracking.awaitingWorkerReply = false;
  await core.setStopped(sessionID, "Error", message, "error", "UNRECOVERABLE_ERROR");
}

export async function handleExecutionInterrupted(
  core: Core,
  sessionID: string,
  reason: "user" | "shutdown" | "superseded",
): Promise<void> {
  const tracking = core.getTracking(sessionID);
  if (tracking?.selfInterrupt) {
    // Autopilot interrupted its own worker (pause/stop); not a user stop.
    tracking.selfInterrupt = false;
    return;
  }
  if (reason !== "user") return;

  const state = core.getState(sessionID);
  if (!state || state.mode !== "ENABLED" || state.run_mode !== "objective") return;
  if (tracking) tracking.awaitingWorkerReply = false;
  await core.setStopped(
    sessionID,
    "Interrupted",
    "Run interrupted by user.",
    "warning",
    "USER_STOP",
  );
}

export async function handleSessionDeleted(core: Core, sessionID: string): Promise<void> {
  core.deleteState(sessionID);
}
