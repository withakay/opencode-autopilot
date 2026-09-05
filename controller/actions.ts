// Single action entry point shared by the /autopilot command and the
// autopilot tool.
import type { AutopilotActionArgs } from "../command/parse.ts";
import { normalizeMaxContinues, normalizePositiveInteger } from "../prompts/index.ts";
import { createSessionState } from "../state/factory.ts";
import { parsePlan } from "../tools/plan.ts";
import { inferPlanningContext } from "../tools/planning.ts";
import { buildAutopilotUsage } from "../tools/usage.ts";
import type { AutonomousStrength } from "../types/index.ts";
import { AUTOPILOT_FALLBACK_AGENT, type Core } from "./core.ts";

const DEFAULT_MAX_DURATION_MS = 15 * 60 * 1000;
const DEFAULT_MAX_TOKENS = 200000;
const DEFAULT_NO_PROGRESS_TOKEN_THRESHOLD = 50;
const DEFAULT_NO_PROGRESS_TURNS = 2;

function resolveObjective(args: AutopilotActionArgs): string {
  return (
    args.objective?.trim() || args.goal?.trim() || args.target?.trim() || args.task?.trim() || ""
  );
}

export async function runAction(
  core: Core,
  sessionID: string,
  args: AutopilotActionArgs,
): Promise<string> {
  const objective = resolveObjective(args);
  const action = args.action ?? (objective ? "start" : "help");

  if (action === "help" || (!args.action && objective.toLowerCase() === "help")) {
    return buildAutopilotUsage();
  }

  if (action === "status") {
    return core.statusText(sessionID);
  }

  if (action === "off" || action === "stop") {
    const state = core.getState(sessionID);
    if (!state || state.mode !== "ENABLED") {
      return "Autopilot is not running in this session.";
    }

    await core.interruptWorker(sessionID);
    const stoppedObjective = objective || state.objective;
    state.mode = "DISABLED";
    state.phase = "STOPPED";
    state.stop_reason = "USER_STOP";
    state.status = "cleared";
    core.recordHistory(
      sessionID,
      stoppedObjective ? `Cancelled by user: ${stoppedObjective}` : "Cancelled by user",
    );
    const message = stoppedObjective
      ? `Autopilot stopped: ${stoppedObjective}`
      : "Autopilot stopped for this session.";
    core.notice(sessionID, "Autopilot stopped", message, "info");
    return message;
  }

  if (action === "pause") {
    const state = core.getState(sessionID);
    if (
      !state ||
      state.run_mode !== "objective" ||
      !["active", "waiting_for_reply", "validating"].includes(state.status)
    ) {
      return "No active autopilot objective to pause.";
    }

    await core.interruptWorker(sessionID);
    state.mode = "DISABLED";
    state.phase = "STOPPED";
    state.status = "paused";
    core.recordHistory(sessionID, "Objective paused by user.");
    core.notice(sessionID, "Autopilot paused", state.objective, "info");
    return `Autopilot paused: ${state.objective}`;
  }

  if (action === "resume") {
    const state = core.getState(sessionID);
    if (!state || state.run_mode !== "objective" || !["paused", "blocked"].includes(state.status)) {
      return "No paused or blocked autopilot objective to resume.";
    }

    if (state.continuation_count >= state.max_continues) {
      await core.setStopped(
        sessionID,
        "Continuation limit reached",
        `Stopped after ${state.continuation_count} autonomous continuations.`,
        "warning",
        "RETRY_EXHAUSTED",
      );
      return `Autopilot cannot resume: continuation limit (${state.max_continues}) reached.`;
    }

    state.mode = "ENABLED";
    state.phase = "OBSERVE";
    state.status = "active";
    state.stop_reason = null;
    state.final_digest = undefined;
    core.initSession(sessionID);
    if (args.permissionMode) {
      core.setPermissionMode(sessionID, args.permissionMode);
      core.recordHistory(sessionID, `Objective resumed in ${args.permissionMode} mode.`);
    }
    core.recordHistory(sessionID, `Objective resumed with ${state.worker_agent}.`);
    if (state.continuation_count > 0) {
      state.continuation_count += 1;
      core.recordHistory(
        sessionID,
        `Continuation ${state.continuation_count}/${state.max_continues} after resume`,
      );
    }
    core.notice(sessionID, "Autopilot resumed", state.objective, "info");
    await core.dispatchPrompt(
      sessionID,
      state,
      core.buildNextWorkPrompt(state, state.continuation_count, true),
      "Autopilot: resuming objective",
    );
    return `Autopilot resumed: ${state.objective}`;
  }

  if (action === "clear") {
    const state = core.getState(sessionID);
    if (!state || state.run_mode !== "objective") {
      return "No autopilot objective to clear.";
    }

    await core.interruptWorker(sessionID);
    const cleared = state.objective;
    core.deleteState(sessionID);
    core.notice(sessionID, "Autopilot cleared", cleared || "Objective cleared.", "info");
    return cleared ? `Autopilot objective cleared: ${cleared}` : "Autopilot objective cleared.";
  }

  // -- start / run / on ------------------------------------------------------
  const permissionMode = args.permissionMode ?? "allow-all";
  const maxContinues = normalizeMaxContinues(args.maxContinues);
  const maxDurationMs = normalizePositiveInteger(args.maxDurationMs, DEFAULT_MAX_DURATION_MS);
  const maxTokens = normalizePositiveInteger(args.maxTokens, DEFAULT_MAX_TOKENS);
  const noProgressTokenThreshold = normalizePositiveInteger(
    args.noProgressTokenThreshold,
    DEFAULT_NO_PROGRESS_TOKEN_THRESHOLD,
  );
  const noProgressTurnsBeforePause = normalizePositiveInteger(
    args.noProgressTurns,
    DEFAULT_NO_PROGRESS_TURNS,
  );
  const autonomousStrength = args.autonomousStrength ?? "balanced";
  const startsObjectiveRun =
    action === "start" || action === "run" || (!args.action && Boolean(objective));
  const effectiveStrength: AutonomousStrength = startsObjectiveRun
    ? "aggressive"
    : autonomousStrength;

  if (startsObjectiveRun && !objective) {
    return [
      "Autopilot objective runs need a target.",
      "Use: /autopilot Complete <objective> without stopping until <verifiable end state>",
    ].join("\n");
  }

  // Worker agent defaults to the current session agent; --agent switches it.
  let currentAgent: string | undefined;
  try {
    currentAgent = (await core.session.get({ sessionID })).agent;
  } catch {
    // Session lookup is best-effort; fall back to the default agent.
  }
  let workerAgent = args.workerAgent?.trim() || currentAgent || AUTOPILOT_FALLBACK_AGENT;
  if (startsObjectiveRun && args.workerAgent?.trim() && workerAgent !== currentAgent) {
    try {
      await core.session.switchAgent({ sessionID, agent: workerAgent });
    } catch {
      core.recordHistory(
        sessionID,
        `Could not switch to agent ${workerAgent}; continuing with ${currentAgent ?? AUTOPILOT_FALLBACK_AGENT}.`,
      );
      workerAgent = currentAgent || AUTOPILOT_FALLBACK_AGENT;
    }
  }

  const plan = parsePlan(args.plan);
  const planningContext = startsObjectiveRun
    ? await inferPlanningContext({ root: core.directory, objective, planText: args.plan })
    : {};

  const state = createSessionState(sessionID, startsObjectiveRun ? objective : "", {
    maxContinues,
    maxDurationMs,
    maxTokens,
    noProgressTokenThreshold,
    noProgressTurnsBeforePause,
    workerAgent,
    autonomousStrength: effectiveStrength,
    sessionMode: startsObjectiveRun ? "delegated-task" : "session-defaults",
    doneWhen: args.doneWhen?.trim() || undefined,
    verifyWith: args.verifyWith?.trim() || undefined,
    planSource: planningContext.planSource,
    planningFramework: planningContext.planningFramework,
    plan,
  });

  core.setState(sessionID, state);
  core.initSession(sessionID);
  core.setPermissionMode(sessionID, permissionMode);

  if (!startsObjectiveRun) {
    core.recordHistory(sessionID, `Session autopilot enabled in ${permissionMode} mode.`);
    core.recordHistory(
      sessionID,
      `Delegate agent ready: ${workerAgent}. Long-running tasks will use this agent.`,
    );
    core.notice(
      sessionID,
      "Autopilot enabled",
      `Ambient autonomy in ${permissionMode} mode`,
      "info",
    );
    return `Autopilot is enabled in ${permissionMode} mode for this session. OpenCode will prefer reasonable defaults, ask fewer questions, and keep using ${workerAgent} for delegated work when you hand it an objective.`;
  }

  core.recordHistory(
    sessionID,
    `Objective run armed in ${permissionMode} mode with ${workerAgent}.`,
  );
  core.recordHistory(sessionID, `Objective: ${state.objective}.`);
  if (state.done_when) core.recordHistory(sessionID, `Done when: ${state.done_when}.`);
  if (state.verify_with) core.recordHistory(sessionID, `Verify with: ${state.verify_with}.`);
  if (state.plan.length > 0) core.recordHistory(sessionID, `Plan steps: ${state.plan.length}.`);
  core.recordHistory(sessionID, `Continuation limit: ${state.max_continues}.`);

  core.notice(sessionID, "Autopilot armed", `Starting objective with ${workerAgent}`, "info");

  // KEY: dispatch the first worker prompt inside this call — no idle waiting.
  await core.dispatchPrompt(
    sessionID,
    state,
    core.buildNextWorkPrompt(state, 0),
    "Autopilot: starting objective",
  );

  const planSummary = state.plan.length > 0 ? ` Plan: ${state.plan.length} steps.` : "";
  const contextSummary = state.planning_framework
    ? ` Detected planning context: ${state.planning_framework}${state.plan_source ? ` (${state.plan_source})` : ""}.`
    : "";
  return `Autopilot objective run started in ${permissionMode} mode with ${workerAgent}. Objective: ${state.objective}.${planSummary}${contextSummary} It may continue up to ${maxContinues} times.`;
}
