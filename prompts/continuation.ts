import type { AutopilotConfig } from "../config/autopilot-config.ts";
import type { PlanStep } from "../types/index.ts";

export interface ContinuationPromptOptions {
  continueCount: number;
  maxContinues: number;
  objective: string;
  doneWhen?: string;
  verifyWith?: string;
  planSource?: string;
  planningFramework?: string;
  candidateCompletion?: string;
  verificationFailure?: string;
  isValidation?: boolean;
  config?: AutopilotConfig;
}

export interface PlanStepPromptOptions
  extends Pick<
    ContinuationPromptOptions,
    | "continueCount"
    | "maxContinues"
    | "objective"
    | "doneWhen"
    | "verifyWith"
    | "planSource"
    | "planningFramework"
    | "config"
  > {
  step: PlanStep;
  stepIndex: number;
  stepCount: number;
}

function objectiveContract(
  options: Pick<
    ContinuationPromptOptions,
    "objective" | "doneWhen" | "verifyWith" | "planSource" | "planningFramework"
  >,
): string[] {
  return [
    `Objective: ${options.objective}`,
    options.planSource ? `Planning source: ${options.planSource}` : undefined,
    options.planningFramework ? `Planning framework: ${options.planningFramework}` : undefined,
    options.doneWhen ? `Done when: ${options.doneWhen}` : undefined,
    options.verifyWith ? `Verify with: ${options.verifyWith}` : undefined,
  ].filter((line): line is string => Boolean(line));
}

function planningGuidance(
  options: Pick<ContinuationPromptOptions, "planSource" | "planningFramework">,
): string[] {
  return [
    "Planning integration: if the objective refers to a plan, spec, proposal, change, feature, issue, accepted plan, planning mode output, or framework artifact, treat that artifact as authoritative before inventing new steps.",
    "Recognize common planning/spec workflows and vocabulary, including Ito changes/specs, OpenSpec, SpecKit, OpenCode or Codex planning, Copilot plan mode, Claude Code plan mode, Superpower Skills, Matt Pocock-style exercise/spec frameworks, Grill Me, and swarm-managed task plans.",
    options.planSource
      ? "Inspect the named planning source first and execute its acceptance criteria/checklist."
      : "If no explicit plan text was supplied but planning language is present, first locate likely repo artifacts such as PLAN.md, specs, changes, proposals, issues, docs, .ito, openspec, speckit, or skill/swarm task files.",
    options.planningFramework
      ? `Respect ${options.planningFramework} conventions and lifecycle terms when deciding the next checkpoint.`
      : undefined,
  ].filter((line): line is string => Boolean(line));
}

export function buildObjectiveStartPrompt(
  options: Pick<
    ContinuationPromptOptions,
    "objective" | "doneWhen" | "verifyWith" | "planSource" | "planningFramework" | "config"
  >,
): string {
  const continuationHints = options.config?.promptInjection?.continuation ?? [];

  return [
    "Autopilot objective run started.",
    "",
    ...objectiveContract(options),
    "",
    "Start working toward this objective now. Work in concrete checkpoints and keep going until the objective is complete, blocked, paused, or the continuation limit is reached.",
    ...planningGuidance(options),
    "Before stopping, audit whether the objective is complete, blocked, or still has a clear next action. If a clear next action remains, take it now instead of asking the user to continue.",
    "Use VALIDATE when you think the objective may be done but needs verification. Use COMPLETE only after verification proves the objective is done. Use BLOCKED only for a real blocker with no safe next action.",
    ...continuationHints,
  ].join("\n");
}

export function buildPlanStepPrompt(options: PlanStepPromptOptions): string {
  const continuationHints = options.config?.promptInjection?.continuation ?? [];

  return [
    `Autopilot plan step ${options.stepIndex + 1}/${options.stepCount}.`,
    ...objectiveContract(options),
    "",
    `Current step: ${options.step.title}`,
    `Step details: ${options.step.description}`,
    "",
    "Execute this step now. Keep working within this step until it is done, blocked, or needs validation.",
    ...planningGuidance(options),
    "When this step is fully done, end with:",
    '<autopilot status="step-done">evidence for the completed step</autopilot>',
    "When all plan steps are done, the controller will validate the whole objective before final completion.",
    ...continuationHints,
  ].join("\n");
}

export function buildContinuationPrompt(options: ContinuationPromptOptions): string {
  const validationHints = options.config?.promptInjection?.validation ?? [];
  const continuationHints = options.config?.promptInjection?.continuation ?? [];

  if (options.isValidation) {
    return [
      `Autopilot VALIDATION checkpoint ${options.continueCount}/${options.maxContinues}.`,
      "You previously marked this objective as potentially complete, but you MUST validate the work before marking it COMPLETE.",
      ...objectiveContract(options),
      options.candidateCompletion
        ? `Candidate completion: ${options.candidateCompletion}`
        : undefined,
      "",
      "VALIDATION CHECKLIST - Complete ALL of these:",
      "1. Verify any files you created/modified actually exist and have correct content",
      "2. Run any tests or check outputs if applicable",
      "3. Confirm the objective requirements are FULLY satisfied",
      "4. Check for any errors, TODOs, or incomplete work",
      "5. Confirm any referenced planning/spec/change framework is satisfied, not just the code diff",
      "",
      "IF validation passes and you're 100% confident: mark COMPLETE",
      "IF you find issues: mark CONTINUE and fix them",
      "IF uncertain: mark VALIDATE again after gathering more info",
      ...validationHints,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");
  }

  return [
    `Autopilot continuation ${options.continueCount}/${options.maxContinues}.`,
    "Continue working autonomously toward the active objective.",
    ...objectiveContract(options),
    options.verificationFailure
      ? `Last verification failure: ${options.verificationFailure}`
      : undefined,
    "Review your latest progress, choose the next concrete step, and keep moving without waiting for the user.",
    ...planningGuidance(options),
    "If the next obvious thing is to inspect, edit, test, validate, or summarize, do it now instead of asking whether to proceed.",
    "Use VALIDATE when you think you might be done but need to verify your work.",
    "Use COMPLETE only when you are highly confident the objective is fully done (gamble-your-house confident).",
    "Use BLOCKED if missing information or denied permissions.",
    ...continuationHints,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}
