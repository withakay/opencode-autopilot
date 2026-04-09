/**
 * Wingman Strategy for Autopilot Subagents
 *
 * Since OpenCode plugins cannot dynamically create agents, we use a
 * delegation pattern with pre-configured versatile agents.
 *
 * Strategy:
 * 1. Use a single "versatile-worker" agent configured with broad capabilities
 * 2. Dispatch to it with specialized prompts that define the "wingman" role
 * 3. The prompt itself creates the specialized behavior (prompt-as-agent)
 *
 * Alternative: Request upstream feature from OpenCode team for dynamic agent creation
 */

import type { AutonomousStrength } from "../types/state.ts";

export type WingmanRole =
  | "validator"
  | "code-reviewer"
  | "tester"
  | "refactorer"
  | "debugger"
  | "documenter";

export interface WingmanConfig {
  role: WingmanRole;
  strength: AutonomousStrength;
}

/**
 * Build a specialized wingman prompt that transforms a general agent
 * into a role-specific subagent through prompt engineering.
 */
export function buildWingmanPrompt(role: WingmanRole, task: string, context: string): string {
  const roleDefinitions: Record<WingmanRole, string> = {
    validator: `
You are a VALIDATOR wingman. Your job is to verify work is correct and complete.
Be meticulous. Check every detail. Verify:
- Files exist and have expected content
- Tests pass (if applicable)
- No TODOs or placeholders remain
- Requirements are fully satisfied

Output format:
<wingman role="validator" verdict="pass|fail">
- Check 1: [PASS/FAIL] - details
- Check 2: [PASS/FAIL] - details
...
Verdict: [Detailed explanation]
</wingman>
`,

    "code-reviewer": `
You are a CODE REVIEWER wingman. Your job is to review code for quality issues.
Check for:
- Bugs and logic errors
- Security vulnerabilities
- Performance issues
- Style violations
- Missing edge cases

Output format:
<wingman role="code-reviewer" verdict="approve|needs-work">
## Issues Found
1. [Severity] Issue description - suggestion
2. [Severity] Issue description - suggestion
...

## Summary
[Overall assessment]
</wingman>
`,

    tester: `
You are a TESTER wingman. Your job is to write and run tests.
- Write comprehensive test cases
- Run tests and report results
- Identify edge cases
- Suggest additional test coverage

Output format:
<wingman role="tester" verdict="pass|fail">
## Tests Written
1. [Test name] - [PASS/FAIL]
2. [Test name] - [PASS/FAIL]
...

## Coverage
[What is/isn't covered]

## Summary
[Overall assessment]
</wingman>
`,

    refactorer: `
You are a REFACTORER wingman. Your job is to improve code quality.
- Simplify complex code
- Remove duplication
- Improve naming
- Better structure
- Preserve behavior (don't change functionality)

Output format:
<wingman role="refactorer" verdict="complete">
## Changes Made
1. [Description of change]
2. [Description of change]
...

## Before/After
[Key improvements]
</wingman>
`,

    debugger: `
You are a DEBUGGER wingman. Your job is to diagnose and fix bugs.
- Analyze error messages
- Trace execution flow
- Identify root cause
- Implement fix
- Verify fix works

Output format:
<wingman role="debugger" verdict="fixed">
## Root Cause
[What caused the bug]

## Fix Applied
[What was changed]

## Verification
[How we know it's fixed]
</wingman>
`,

    documenter: `
You are a DOCUMENTER wingman. Your job is to write documentation.
- Code comments
- README updates
- API documentation
- Usage examples
- Architecture notes

Output format:
<wingman role="documenter" verdict="complete">
## Documentation Added
1. [What was documented]
2. [What was documented]
...

## Files Modified
[List of files]
</wingman>
`,
  };

  return [
    roleDefinitions[role],
    "",
    "## Context",
    context,
    "",
    "## Task",
    task,
    "",
    "Proceed autonomously to complete your role.",
  ].join("\n");
}

/**
 * Build a parent-level coordination prompt that dispatches to wingmen
 */
export function buildCoordinationPrompt(mainTask: string, wingmenNeeded: WingmanRole[]): string {
  const wingmanDescriptions: Record<WingmanRole, string> = {
    validator: "Verify work is correct (run tests, check files)",
    "code-reviewer": "Review code for bugs and quality issues",
    tester: "Write and run tests",
    refactorer: "Improve code quality",
    debugger: "Diagnose and fix bugs",
    documenter: "Write documentation",
  };

  const wingmenList = wingmenNeeded
    .map((role, i) => `${i + 1}. **${role}**: ${wingmanDescriptions[role]}`)
    .join("\n");

  return [
    "You are the AUTOPILOT COORDINATOR. Your job is to delegate subtasks to specialized wingmen agents.",
    "",
    `Main task: ${mainTask}`,
    "",
    "## Wingmen Available",
    wingmenList,
    "",
    "## Strategy",
    "1. Break the main task into discrete subtasks",
    "2. For each subtask, determine which wingman is best suited",
    "3. Dispatch work to wingmen using the format:",
    "   `@wingman <role> <subtask description>`",
    "4. Wait for wingman results (they will report back)",
    "5. Integrate results and continue or complete",
    "",
    "Start by delegating the first subtask to the appropriate wingman.",
  ].join("\n");
}

/**
 * Parse wingman output to extract verdict and details
 */
export function parseWingmanOutput(
  output: string,
): { verdict: string; details: string; role?: string } | null {
  const match = output.match(
    /<wingman\s+role="([^"]+)"\s+verdict="([^"]+)">([\s\S]*?)<\/wingman>/i,
  );

  if (!match) {
    return null;
  }

  return {
    role: match[1] ?? "unknown",
    verdict: match[2] ?? "unknown",
    details: match[3]?.trim() ?? "",
  };
}

/**
 * Check if all wingmen reports pass
 */
export function allWingmenPass(reports: Array<{ verdict: string } | null>): boolean {
  return reports.every((r) => r !== null && r.verdict.toLowerCase() === "pass");
}
