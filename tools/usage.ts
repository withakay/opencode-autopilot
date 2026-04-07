export function buildAutopilotUsage(): string {
  return `
## Autopilot Usage

Primary workflow:
- \`/autopilot on\` — enable session autopilot defaults
- \`/autopilot off\` — disable autopilot for this session
- \`/autopilot status\` — show current status and recent events
- \`/autopilot <task>\` — enable autopilot and hand a long-running task to the delegate agent

Direct tool equivalents:
- \`autopilot(action="on")\`
- \`autopilot(action="off")\`
- \`autopilot(action="status")\`
- \`autopilot(task="Fix the failing tests")\`

Defaults:
- permission mode: \`limited\`
- continuation limit: \`10\`
- delegate agent: \`general\`

Notes:
- Session autopilot makes OpenCode act more autonomously and ask fewer questions.
- Long-running delegated tasks run through the configured agent and continue until complete, blocked, or the continuation limit is reached.
- OpenCode does not currently expose a general question-timeout hook, so autopilot can only auto-handle permission prompts directly. For everything else, the injected system guidance tells the active agent to prefer recommended defaults when safe.
  `.trim();
}
