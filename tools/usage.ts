export const AUTOPILOT_USAGE = `
## Autopilot Usage

Use the \`autopilot\` tool to control the autopilot plugin.

**Start Autopilot:**
Call \`autopilot\` with a \`task\`.

Examples:
- \`autopilot(task="Fix the failing tests")\`
- \`autopilot(task="Refactor the reducer", permissionMode="allow-all", workerAgent="build-high")\`

**Check Status:**
- \`autopilot(action="status")\`

**Stop Autopilot:**
- \`autopilot(action="stop")\`
- \`autopilot(action="stop", reason="I want to inspect manually")\`

Defaults:
- permission mode: \`limited\`
- continuation limit: \`10\`
- worker agent: \`general\`
`.trim();
