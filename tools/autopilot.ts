import { tool } from "@opencode-ai/plugin";
import type { AutonomousStrength, ExtendedState, PlanStep } from "../types/index.ts";
import { parsePlan } from "./plan.ts";
import { inferPlanningContext } from "./planning.ts";
import { buildAutopilotUsage } from "./usage.ts";

export interface AutopilotToolDeps {
  getState: (sessionID: string) => ExtendedState | undefined;
  setState: (sessionID: string, state: ExtendedState) => void;
  createSessionState: (
    sessionID: string,
    objective: string,
    options: {
      maxContinues?: number;
      maxDurationMs?: number;
      maxTokens?: number;
      noProgressTokenThreshold?: number;
      noProgressTurnsBeforePause?: number;
      sessionMode?: ExtendedState["session_mode"];
      workerAgent?: string;
      autonomousStrength?: AutonomousStrength;
      doneWhen?: string;
      verifyWith?: string;
      planSource?: string;
      planningFramework?: string;
      plan?: PlanStep[];
    },
  ) => ExtendedState;
  normalizeMaxContinues: (value: unknown) => number;
  normalizePositiveInteger?: (value: unknown, fallback: number) => number;
  initSession: (sessionID: string) => void;
  onArmed: (
    sessionID: string,
    state: ExtendedState,
    permissionMode: "allow-all" | "limited",
  ) => Promise<void>;
  onResumed?: (
    sessionID: string,
    state: ExtendedState,
    permissionMode: "allow-all" | "limited" | undefined,
  ) => Promise<void>;
  onStateChanged?: (sessionID: string, state: ExtendedState) => Promise<void>;
  summarizeState: (state: ExtendedState | null | undefined) => string;
  getHistory: (sessionID: string) => string[];
  onStop: (sessionID: string, reason: string | undefined) => void;
  defaultWorkerAgent: string;
}

const AUTOPILOT_FALLBACK_AGENT = "pi";

export function createAutopilotTool(deps: AutopilotToolDeps) {
  return tool({
    description:
      "Control session autopilot: enable ambient autonomy or start a durable objective run",
    args: {
      action: tool.schema
        .enum(["on", "off", "stop", "status", "help", "start", "run", "pause", "resume", "clear"])
        .optional()
        .describe(
          "Autopilot command: start/run, on, off/stop, pause, resume, clear, status, or help",
        ),
      task: tool.schema
        .string()
        .optional()
        .describe("Deprecated alias for objective; starts a durable objective run when provided"),
      objective: tool.schema
        .string()
        .optional()
        .describe("Durable objective to keep working toward until complete or blocked"),
      goal: tool.schema.string().optional().describe("Alias for objective"),
      target: tool.schema.string().optional().describe("Alias for objective"),
      doneWhen: tool.schema
        .string()
        .optional()
        .describe("Verifiable stopping condition for the objective run"),
      verifyWith: tool.schema
        .string()
        .optional()
        .describe("Command or artifact that proves the objective is complete"),
      plan: tool.schema
        .string()
        .optional()
        .describe("Optional newline or JSON-array plan to execute step by step"),
      permissionMode: tool.schema
        .enum(["limited", "allow-all"])
        .optional()
        .describe("How permissions should behave while autopilot is active"),
      maxContinues: tool.schema
        .number()
        .int()
        .positive()
        .optional()
        .describe("Maximum number of autonomous continuation prompts"),
      maxDurationMs: tool.schema
        .number()
        .int()
        .positive()
        .optional()
        .describe("Maximum objective run duration in milliseconds"),
      maxTokens: tool.schema
        .number()
        .int()
        .positive()
        .optional()
        .describe("Maximum tracked worker message tokens before stopping"),
      noProgressTokenThreshold: tool.schema
        .number()
        .int()
        .positive()
        .optional()
        .describe("Worker output tokens below this threshold count as low-progress"),
      noProgressTurns: tool.schema
        .number()
        .int()
        .positive()
        .optional()
        .describe("Low-progress worker turns before pausing the objective"),
      workerAgent: tool.schema
        .string()
        .optional()
        .describe("Delegate agent used for long-running autopilot objective runs"),
      autonomousStrength: tool.schema
        .enum(["conservative", "balanced", "aggressive"])
        .optional()
        .describe(
          "How strongly autopilot prefers defaults: conservative (soft guidance), balanced (default, stronger guidance), aggressive (always pick recommended/safe defaults)",
        ),
    },
    async execute(args, context) {
      const objective =
        args.objective?.trim() ||
        args.goal?.trim() ||
        args.target?.trim() ||
        args.task?.trim() ||
        "";
      const action = args.action ?? (objective ? "start" : "help");

      if (action === "help" || (!args.action && objective.toLowerCase() === "help")) {
        return buildAutopilotUsage();
      }

      if (action === "status") {
        const state = deps.getState(context.sessionID);
        if (!state) {
          return deps.summarizeState(state);
        }

        const history = deps.getHistory(context.sessionID);
        const historyStr = history.length > 0 ? `\nRecent events:\n- ${history.join("\n- ")}` : "";
        return `${deps.summarizeState(state)}${historyStr}`;
      }

      if (action === "off" || action === "stop") {
        const state = deps.getState(context.sessionID);
        if (!state || state.mode !== "ENABLED") {
          return "Autopilot is not running in this session.";
        }

        const stoppedObjective = objective || state.objective;
        deps.onStop(context.sessionID, stoppedObjective || undefined);
        return stoppedObjective
          ? `Autopilot stopped: ${stoppedObjective}`
          : "Autopilot stopped for this session.";
      }

      if (action === "pause") {
        const state = deps.getState(context.sessionID);
        if (
          !state ||
          state.run_mode !== "objective" ||
          !["active", "waiting_for_reply", "validating"].includes(state.status)
        ) {
          return "No active autopilot objective to pause.";
        }

        state.mode = "DISABLED";
        state.phase = "STOPPED";
        state.status = "paused";
        await deps.onStateChanged?.(context.sessionID, state);
        return `Autopilot paused: ${state.objective}`;
      }

      if (action === "resume") {
        const state = deps.getState(context.sessionID);
        if (
          !state ||
          state.run_mode !== "objective" ||
          !["paused", "blocked"].includes(state.status)
        ) {
          return "No paused or blocked autopilot objective to resume.";
        }

        state.mode = "ENABLED";
        state.phase = "OBSERVE";
        state.status = "active";
        state.stop_reason = null;
        state.final_digest = undefined;
        deps.initSession(context.sessionID);
        await deps.onResumed?.(context.sessionID, state, args.permissionMode);
        await deps.onStateChanged?.(context.sessionID, state);
        return `Autopilot resumed: ${state.objective}`;
      }

      if (action === "clear") {
        const state = deps.getState(context.sessionID);
        if (!state || state.run_mode !== "objective") {
          return "No autopilot objective to clear.";
        }

        deps.onStop(context.sessionID, state.objective || "cleared");
        return state.objective
          ? `Autopilot objective cleared: ${state.objective}`
          : "Autopilot objective cleared.";
      }

      const permissionMode = args.permissionMode ?? "limited";
      const maxContinues = deps.normalizeMaxContinues(args.maxContinues);
      const normalizePositiveInteger =
        deps.normalizePositiveInteger ?? ((_value, fallback) => fallback);
      const maxDurationMs = normalizePositiveInteger(args.maxDurationMs, 15 * 60 * 1000);
      const maxTokens = normalizePositiveInteger(args.maxTokens, 200000);
      const noProgressTokenThreshold = normalizePositiveInteger(args.noProgressTokenThreshold, 50);
      const noProgressTurnsBeforePause = normalizePositiveInteger(args.noProgressTurns, 2);
      const workerAgent =
        args.workerAgent?.trim() || deps.defaultWorkerAgent || AUTOPILOT_FALLBACK_AGENT;
      const autonomousStrength = args.autonomousStrength ?? "balanced";
      const startsObjectiveRun =
        action === "start" || action === "run" || (!args.action && Boolean(objective));
      const effectiveStrength: AutonomousStrength = startsObjectiveRun
        ? "aggressive"
        : autonomousStrength;
      const plan = parsePlan(args.plan);
      const planningContext = startsObjectiveRun
        ? await inferPlanningContext({
            root: context.directory || context.worktree,
            objective,
            planText: args.plan,
          })
        : {};

      if (startsObjectiveRun && !objective) {
        return [
          "Autopilot objective runs need a target.",
          'Use: autopilot(action="start", objective="Complete <objective> without stopping until <verifiable end state>")',
        ].join("\n");
      }

      const state = deps.createSessionState(
        context.sessionID,
        startsObjectiveRun ? objective : "",
        {
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
        },
      );

      deps.setState(context.sessionID, state);
      deps.initSession(context.sessionID);

      context.metadata({
        title: startsObjectiveRun ? "Autopilot objective started" : "Autopilot enabled",
        metadata: {
          action,
          permissionMode,
          maxContinues,
          maxDurationMs,
          maxTokens,
          noProgressTokenThreshold,
          noProgressTurnsBeforePause,
          workerAgent,
          autonomousStrength: effectiveStrength,
          objective: startsObjectiveRun ? objective : null,
          // Deprecated telemetry alias for consumers that still expect task metadata.
          task: startsObjectiveRun ? objective : null,
          doneWhen: state.done_when ?? null,
          verifyWith: state.verify_with ?? null,
          planSource: state.plan_source ?? null,
          planningFramework: state.planning_framework ?? null,
          planSteps: state.plan.length,
        },
      });

      await deps.onArmed(context.sessionID, state, permissionMode);

      if (state.session_mode === "session-defaults") {
        return `Autopilot is enabled in ${permissionMode} mode for this session. OpenCode will prefer reasonable defaults, ask fewer questions, and keep using ${workerAgent} for delegated work when you hand it an objective.`;
      }

      const planSummary = state.plan.length > 0 ? ` Plan: ${state.plan.length} steps.` : "";
      const contextSummary = state.planning_framework
        ? ` Detected planning context: ${state.planning_framework}${state.plan_source ? ` (${state.plan_source})` : ""}.`
        : "";
      return `Autopilot objective run started in ${permissionMode} mode with ${workerAgent}. Objective: ${state.objective}.${planSummary}${contextSummary} It may continue up to ${maxContinues} times.`;
    },
  });
}
