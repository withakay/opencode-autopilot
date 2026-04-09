export type { ContinuationPromptOptions } from "./continuation.ts";
export { buildContinuationPrompt } from "./continuation.ts";
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
  AUTOPILOT_MAX_CONTINUES_HARD_LIMIT,
  normalizeMaxContinues,
} from "./normalize.ts";
export { buildAutopilotSystemPrompt } from "./system-prompt.ts";
export type { WingmanConfig, WingmanRole } from "./wingman.ts";
export {
  allWingmenPass,
  buildCoordinationPrompt,
  buildWingmanPrompt,
  parseWingmanOutput,
} from "./wingman.ts";
