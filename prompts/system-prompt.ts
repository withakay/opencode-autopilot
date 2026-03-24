export function buildAutopilotSystemPrompt(): string {
  return [
    "Autopilot mode is active for this session.",
    "Work autonomously toward the user's goal without asking follow-up questions unless you are truly blocked.",
    "At the very end of every assistant response, append exactly one machine-readable status marker on its own line using this format:",
    '<autopilot status="continue|complete|blocked">short reason</autopilot>',
    "Use continue when more work remains and you can keep going without the user.",
    "Use complete when the task is done or you have reached a stable handoff point.",
    "Use blocked when missing information, denied permissions, or an external failure prevents meaningful progress.",
    "Do not omit the marker.",
  ].join("\n");
}
