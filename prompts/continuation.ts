export interface ContinuationPromptOptions {
  continueCount: number;
  maxContinues: number;
  task: string;
}

export function buildContinuationPrompt(options: ContinuationPromptOptions): string {
  return [
    `Autopilot continuation ${options.continueCount}/${options.maxContinues}.`,
    "Continue working autonomously on the same task.",
    `Original task: ${options.task}`,
    "Review your latest progress, choose the next concrete step, and keep moving without waiting for the user.",
    "If you are done, provide the result and mark the response complete.",
    "If you are blocked by missing information or denied permissions, explain the blocker and mark the response blocked.",
  ].join("\n");
}
