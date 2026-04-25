/**
 * Test fixtures for e2e autonomous behavior validation
 *
 * These fixtures provide test scenarios that exercise autopilot's
 * autonomous decision-making in different strength modes.
 *
 * USAGE WITH REAL PTY:
 * When used with real OpenCode CLI execution (via --dangerously-skip-permissions),
 * these scenarios validate actual workspace side effects (created files, etc.),
 * not just output patterns.
 */

export interface TestScenario {
  /**
   * Unique identifier for this scenario
   */
  id: string;

  /**
   * Human-readable description of what this scenario tests
   */
  description: string;

  /**
   * The initial prompt/task to send to the agent
   */
  initialPrompt: string;

  /**
   * Expected behaviors/patterns to validate in the output
   */
  expectedBehaviors: {
    /**
     * Patterns that should appear in aggressive mode
     * (proceeding with defaults, minimal user interaction)
     */
    aggressive: string[];

    /**
     * Patterns that should appear in balanced mode
     * (stronger bias toward defaults but asks when unsure)
     */
    balanced: string[];

    /**
     * Patterns that should appear in conservative mode
     * (asks questions more frequently, softer guidance)
     */
    conservative: string[];
  };

  /**
   * Anti-patterns that should NOT appear (spin loops, bypassing safety)
   */
  forbiddenPatterns: string[];

  /**
   * Maximum time in milliseconds before timeout
   */
  timeoutMs: number;
}

/**
 * Simple file creation scenario - tests basic autonomous continuation
 */
export const FILE_CREATION_SCENARIO: TestScenario = {
  id: "file-creation",
  description: "Create a simple TypeScript file with a function",
  initialPrompt: "Create a file hello.ts with a function that returns 'Hello, World!'",
  expectedBehaviors: {
    aggressive: [
      // Should proceed directly with file creation
      "write",
      "hello.ts",
      "Hello, World",
    ],
    balanced: [
      // Should create file with minimal interaction
      "write",
      "hello.ts",
      "Hello, World",
    ],
    conservative: [
      // May ask about location or structure but should complete
      "hello.ts",
      "Hello, World",
    ],
  },
  forbiddenPatterns: [
    // Should not get stuck in loops
    "BLOCKED",
    "no admissible action",
    // Should not bypass safety
    "bypassing approval",
  ],
  timeoutMs: 30000, // 30 seconds
};

/**
 * Routine choice scenario - tests autonomous decision-making
 */
export const ROUTINE_CHOICE_SCENARIO: TestScenario = {
  id: "routine-choice",
  description: "Test autonomous selection of safe defaults (package manager choice)",
  initialPrompt: "Initialize a new TypeScript project",
  expectedBehaviors: {
    aggressive: [
      // Should pick a default package manager without asking
      "package.json",
      "typescript",
    ],
    balanced: [
      // Should initialize with reasonable defaults
      "package.json",
      "typescript",
    ],
    conservative: [
      // May ask which package manager to use
      "package.json",
    ],
  },
  forbiddenPatterns: ["BLOCKED", "spinning", "infinite loop"],
  timeoutMs: 45000, // 45 seconds
};

/**
 * Multi-step scenario - tests autonomous continuation across steps
 */
export const MULTI_STEP_SCENARIO: TestScenario = {
  id: "multi-step",
  description: "Test autonomous continuation across multiple related steps",
  initialPrompt:
    "Create a calculator.ts file with add and multiply functions, then create a test file for it",
  expectedBehaviors: {
    aggressive: [
      // Should complete both files autonomously
      "calculator.ts",
      "add",
      "multiply",
      "test",
    ],
    balanced: [
      // Should complete both with minimal interaction
      "calculator.ts",
      "test",
    ],
    conservative: [
      // May ask about test framework but should complete
      "calculator.ts",
    ],
  },
  forbiddenPatterns: ["BLOCKED", "stopped prematurely", "no forward progress"],
  timeoutMs: 60000, // 60 seconds
};

/**
 * All test scenarios available for validation
 */
export const ALL_SCENARIOS: TestScenario[] = [
  FILE_CREATION_SCENARIO,
  ROUTINE_CHOICE_SCENARIO,
  MULTI_STEP_SCENARIO,
];

/**
 * Get scenarios appropriate for CI (quick, deterministic)
 */
export function getCIScenarios(): TestScenario[] {
  return [FILE_CREATION_SCENARIO];
}

/**
 * Get all scenarios including longer-running ones
 */
export function getFullScenarios(): TestScenario[] {
  return ALL_SCENARIOS;
}
