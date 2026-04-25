import type { AutopilotConfig } from "../config/autopilot-config.ts";

export interface ContinuationPromptOptions {
  continueCount: number;
  maxContinues: number;
  task: string;
  isValidation?: boolean;
  config?: AutopilotConfig;
}

export function buildContinuationPrompt(options: ContinuationPromptOptions): string {
  const validationHints = options.config?.promptInjection?.validation ?? [];
  const continuationHints = options.config?.promptInjection?.continuation ?? [];

  if (options.isValidation) {
    return [
      `Autopilot VALIDATION checkpoint ${options.continueCount}/${options.maxContinues}.`,
      "You previously marked this task as potentially complete, but you MUST validate your work before marking it COMPLETE.",
      `Original task: ${options.task}`,
      "",
      "VALIDATION CHECKLIST - Complete ALL of these:",
      "1. Verify any files you created/modified actually exist and have correct content",
      "2. Run any tests or check outputs if applicable",
      "3. Confirm the task requirements are FULLY satisfied",
      "4. Check for any errors, TODOs, or incomplete work",
      "",
      "IF validation passes and you're 100% confident: mark COMPLETE",
      "IF you find issues: mark CONTINUE and fix them",
      "IF uncertain: mark VALIDATE again after gathering more info",
      ...validationHints,
    ].join("\n");
  }

  return [
    `Autopilot continuation ${options.continueCount}/${options.maxContinues}.`,
    "Continue working autonomously on the same task.",
    `Original task: ${options.task}`,
    "Review your latest progress, choose the next concrete step, and keep moving without waiting for the user.",
    "If the next obvious thing is to inspect, edit, test, validate, or summarize, do it now instead of asking whether to proceed.",
    "Use VALIDATE when you think you might be done but need to verify your work.",
    "Use COMPLETE only when you are highly confident the task is fully done (gamble-your-house confident).",
    "Use BLOCKED if missing information or denied permissions.",
    ...continuationHints,
  ].join("\n");
}
