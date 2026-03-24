import { tool } from "@opencode-ai/plugin";

export function createHelpTool() {
  return tool({
    description: "Show autopilot usage instructions",
    args: {},
    execute: async () => {
      return `
## Autopilot Usage

Use the global \`Autopilot\` agent to control the autopilot plugin.

**Start Autopilot:**
Switch to the \`Autopilot\` agent, then send the task you want delegated.

Examples:
- \`Fix the failing tests\`
- \`Use allow-all mode and build-high to refactor the reducer\`

**Check Status:**
- \`status\`
- \`is autopilot running?\`

**Stop Autopilot:**
- \`stop\`
- \`stop because I want to inspect manually\`

Defaults:
- permission mode: \`limited\`
- continuation limit: \`10\`
- worker agent: \`pi\`
`.trim();
    },
  });
}
