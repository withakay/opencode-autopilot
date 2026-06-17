export type { ContinuationPromptOptions, PlanStepPromptOptions } from "./continuation.ts";
export {
  buildContinuationPrompt,
  buildObjectiveStartPrompt,
  buildPlanStepPrompt,
  escapePromptBlockText,
} from "./continuation.ts";
export type {
  AutopilotDirective,
  AutopilotDirectiveStatus,
} from "./directives.ts";
export {
  inferAutopilotDirective,
  parseAutopilotMarker,
  stripAutopilotMarker,
} from "./directives.ts";
export type { UsageMetadata } from "./format.ts";
export { formatUsageMetadata, summarizeAutopilotState } from "./format.ts";
export {
  AUTOPILOT_DEFAULT_MAX_CONTINUES,
  AUTOPILOT_DEFAULT_MAX_DURATION_MS,
  AUTOPILOT_DEFAULT_MAX_TOKENS,
  AUTOPILOT_DEFAULT_NO_PROGRESS_TOKEN_THRESHOLD,
  AUTOPILOT_DEFAULT_NO_PROGRESS_TURNS,
  AUTOPILOT_MAX_CONTINUES_HARD_LIMIT,
  normalizeMaxContinues,
  normalizePositiveInteger,
} from "./normalize.ts";
export { buildAutopilotSystemPrompt } from "./system-prompt.ts";
