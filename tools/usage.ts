export function buildAutopilotUsage(): string {
  return `
## Autopilot Usage

Primary workflow:
- \`/autopilot on\` — enable session autopilot defaults
- \`/autopilot off\` or \`/autopilot stop\` — disable autopilot for this session
- \`/autopilot status\` — show current status and recent events
- \`/autopilot <objective>\` — start an objective run and keep nudging the agent until done or blocked
- \`/autopilot pause\`, \`/autopilot resume\`, \`/autopilot clear\` — manage the active objective run

Direct tool equivalents:
- \`autopilot(action="on")\`
- \`autopilot(action="off")\`
- \`autopilot(action="status")\`
- \`autopilot(action="start", objective="Fix the failing tests without stopping until bun test passes")\`
- \`autopilot(action="run", objective="Fix the failing tests")\`
- \`autopilot(target="Fix the failing tests")\`
- \`autopilot(action="start", objective="Implement PLAN.md", plan="1. Read PLAN.md\\n2. Implement changes\\n3. Run tests")\`

Defaults:
- permission mode: \`limited\`
- continuation limit: \`10\`
- duration limit: \`900000\` ms
- tracked token limit: \`200000\`
- low-progress pause: \`2\` worker turns below \`50\` output tokens
- delegate agent: \`general\`
- objective runs use strong autonomy by default; ambient \`on\` is the lower-supervision mode

Notes:
- Session autopilot makes OpenCode act more autonomously and ask fewer questions based on the configured autonomous strength.
- Objective runs require a non-empty objective. They run through the configured agent and continue until complete, blocked, paused, cleared, or the continuation limit is reached.
- Objective runs also stop on duration/token budget exhaustion and pause after repeated low-progress worker turns.
- Plan-backed objective runs execute one plan step at a time. The agent should use \`step-done\` when the current step is complete; autopilot advances to the next step and validates after the final step.
- Autopilot infers planning/spec context from the objective, inline plan text, and repository artifacts. Users do not need to specify a plan source or framework.
- Planning language is interpreted broadly: plan, spec, proposal, change, feature, accepted plan, Ito, OpenSpec, SpecKit, OpenCode, Codex, Copilot, Claude Code, Superpower Skills, Matt Pocock/Total TypeScript, Grill Me, and swarm task plans.
- Prefer objectives with a verifiable end state, for example: \`Complete PLAN.md without stopping until bun test and bun run build pass\`.
- OpenCode does not currently expose a general question-timeout hook, so autopilot can only auto-handle permission prompts directly. For everything else, the injected system guidance tells the active agent to prefer recommended defaults when safe. The autonomous strength parameter controls how strongly this guidance is worded.
  `.trim();
}
