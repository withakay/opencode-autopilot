import { tool } from "@opencode-ai/plugin";
import { AUTOPILOT_USAGE } from "./usage.ts";

export function createHelpTool() {
  return tool({
    description: "Show autopilot usage instructions",
    args: {},
    execute: async () => AUTOPILOT_USAGE,
  });
}
