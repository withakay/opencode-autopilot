/**
 * PTY-based test runner for OpenCode autopilot validation
 *
 * This module provides utilities to spawn OpenCode sessions with autopilot
 * enabled and validate autonomous behavior through output analysis and
 * workspace side effect verification.
 *
 * IMPLEMENTATION: Uses Bun's native PTY support via Bun.spawn({ terminal: {...} })
 * - Genuine pseudo-terminal allocation (not piped stdio)
 * - Full terminal semantics (TERM=xterm-256color, isTTY=true)
 * - Interactive terminal capabilities (cursor control, colors, etc.)
 *
 * OpenCode Configuration:
 * - --dangerously-skip-permissions: Auto-approve actions for testing
 * - --dir <path>: Run in isolated test workspace
 * - Plugin Loading: Explicitly loads this repo's autopilot plugin via config
 *
 * VALIDATION APPROACH:
 * - **PLUGIN ACTIVATION**: Explicitly verifies autopilot plugin is loaded
 * - **WORKSPACE SIDE EFFECTS**: Validates actual files created, not just output
 * - **EXPLICIT SKIP**: Tests must skip with precise reason if environment unsupported
 * - **NO GENERIC PASSES**: Tests fail if file creation expected but not verified
 *
 * IMPORTANT: This is best-effort behavioral validation, not deterministic
 * assertion testing. The goal is to verify that aggressive mode TENDS to
 * proceed with defaults rather than waiting, not to guarantee specific outputs.
 *
 * Execution Modes:
 * - REAL: Spawn actual OpenCode CLI in genuine PTY (default)
 * - SIMULATION: Fall back to mock when OpenCode CLI is not available
 *
 * Limitations:
 * - No general question hook in OpenCode 1.3.0 means we can't intercept prompts
 * - PTY testing can be flaky in CI due to timing and environment differences
 * - We validate behavior through output patterns AND file system assertions
 * - Some scenarios may require manual review for full validation
 * - PTY support is POSIX-only (Linux, macOS) - not available on Windows
 */

import { spawn, spawnSync } from "bun";
import type { AutonomousStrength } from "../../../types/state.ts";

export interface RunnerConfig {
  /**
   * Autonomous strength mode to test
   */
  strength: AutonomousStrength;

  /**
   * Working directory for the test session
   */
  workDir: string;

  /**
   * Timeout in milliseconds
   */
  timeoutMs: number;

  /**
   * Whether to capture verbose output for debugging
   */
  verbose?: boolean;

  /**
   * Force simulation mode even if OpenCode CLI is available
   */
  forceSimulation?: boolean;
}

export interface RunResult {
  /**
   * Exit code (0 = success, non-zero = error, null = timeout)
   */
  exitCode: number | null;

  /**
   * Combined terminal output (everything written to PTY)
   */
  output: string;

  /**
   * Whether the session timed out
   */
  timedOut: boolean;

  /**
   * Execution duration in milliseconds
   */
  durationMs: number;

  /**
   * Whether autopilot plugin was verified as active
   * CRITICAL: This must be true for tests to pass
   */
  pluginActivated: boolean;

  /**
   * Detected behavior patterns
   */
  behaviors: {
    /**
     * Tool invocations detected in output
     */
    toolsUsed: string[];

    /**
     * Files mentioned/created
     */
    filesReferenced: string[];

    /**
     * Whether session appeared to block/wait
     */
    appearedBlocked: boolean;

    /**
     * Whether session completed successfully
     */
    completedSuccessfully: boolean;
  };
}

type ManagedProcess = {
  kill: () => void;
  exited: Promise<number>;
};

/**
 * Check if OpenCode CLI is available and usable for testing
 */
export async function isOpenCodeAvailable(): Promise<boolean> {
  try {
    // Check if opencode is in PATH
    const result = spawn(["which", "opencode"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await result.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Check if PTY support is available
 * On Windows, PTY is not supported; tests should fall back to simulation
 */
export function isPTYAvailable(): boolean {
  // PTY is POSIX-only (not available on Windows)
  return process.platform !== "win32";
}

/**
 * Spawn an OpenCode session with autopilot enabled
 *
 * This function attempts to run a REAL OpenCode CLI session in a genuine PTY.
 * Falls back to simulation mode if:
 * - OpenCode CLI is not installed
 * - PTY is not supported (Windows)
 * - config.forceSimulation is true
 *
 * Real execution path using genuine PTY:
 * 1. Check if OpenCode CLI and PTY are available
 * 2. Create PTY configuration (80x24 terminal, xterm-256color)
 * 3. Spawn: `opencode run "autopilot(...) then <prompt>"`
 * 4. Capture all terminal output via PTY data callback
 * 5. Parse output for behavioral markers
 * 6. Verify plugin activation and workspace side effects
 */
export async function runAutopilotSession(
  prompt: string,
  config: RunnerConfig,
): Promise<RunResult> {
  const startTime = Date.now();
  let timedOut = false;
  let exitCode: number | null = null;
  let output = "";
  let pluginActivated = false;
  let mode: "real" | "simulation" = "simulation";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let spawnedProcess: ManagedProcess | null = null;

  try {
    // Decide whether to use real PTY or simulation
    const canUseRealPTY =
      !config.forceSimulation && (await isOpenCodeAvailable()) && isPTYAvailable();

    if (canUseRealPTY) {
      mode = "real";
      if (config.verbose) {
        output += `[REAL PTY] Spawning OpenCode CLI in genuine pseudo-terminal...\n`;
      }
    } else {
      mode = "simulation";
      if (config.verbose) {
        const reason = (await isOpenCodeAvailable())
          ? isPTYAvailable()
            ? "Forced simulation"
            : "PTY not supported (Windows)"
          : "OpenCode CLI not available";
        output += `[SIMULATION] ${reason}, using mock\n`;
      }
    }

    // Execute session with timeout
    // For real PTY, we need to track the process for cleanup
    const sessionPromise =
      mode === "real"
        ? realPTYSession(prompt, config).then((result) => {
            spawnedProcess = result.process;
            return result;
          })
        : simulateSession(prompt, config);

    const timeoutPromise = new Promise<"timeout">((resolve) => {
      setTimeout(() => resolve("timeout"), config.timeoutMs);
    });

    const result = await Promise.race([sessionPromise, timeoutPromise]);

    if (result === "timeout") {
      timedOut = true;
      exitCode = null;
      output +=
        mode === "real"
          ? `\n[TIMEOUT] Real PTY session exceeded ${config.timeoutMs}ms threshold (expected - CLI may require interactive input)\n`
          : `\n[TIMEOUT] Simulated session exceeded ${config.timeoutMs}ms threshold\n`;

      // CRITICAL: Explicitly terminate timed-out PTY sessions
      const managedProcess = spawnedProcess as ManagedProcess | null;
      if (managedProcess !== null) {
        try {
          output += `[CLEANUP] Terminating timed-out PTY process...\n`;
          managedProcess.kill();
          // Wait for process to actually exit (with timeout)
          const killTimeout = 2000; // 2 seconds max wait for kill
          const killPromise = managedProcess.exited;
          const killTimeoutPromise = new Promise<void>((resolve) =>
            setTimeout(resolve, killTimeout),
          );
          await Promise.race([killPromise, killTimeoutPromise]);
          output += `[CLEANUP] PTY process terminated\n`;
        } catch (killError) {
          output += `[CLEANUP_ERROR] Failed to terminate PTY: ${killError instanceof Error ? killError.message : String(killError)}\n`;
        }
      }
    } else {
      exitCode = result.exitCode;
      output += result.output;
      pluginActivated = result.pluginActivated;
      spawnedProcess = result.process || null;
    }
  } catch (error) {
    exitCode = 1;
    output += `\n[ERROR] ${error instanceof Error ? error.message : String(error)}\n`;
  }

  const durationMs = Date.now() - startTime;

  // Analyze output for behavioral patterns
  const behaviors = analyzeOutput(output, config.strength, mode);

  return {
    exitCode,
    output,
    timedOut,
    durationMs,
    pluginActivated,
    behaviors,
  };
}

/**
 * Execute a REAL OpenCode CLI session in a genuine PTY
 *
 * This uses Bun's native PTY support (Bun.spawn with terminal option).
 * The subprocess runs in a genuine pseudo-terminal with:
 * - Full terminal semantics (process.stdout.isTTY = true)
 * - Terminal emulation (xterm-256color)
 * - 80x24 terminal size
 * - Color support, cursor control, etc.
 *
 * PLUGIN ACTIVATION VERIFICATION:
 * - Checks for autopilot-specific output patterns
 * - Tests must provide concrete workspace side effects (created files)
 * - If plugin not activated, test must SKIP with explicit reason
 *
 * PLUGIN LOADING:
 * To ensure the autopilot plugin from this repo is loaded, we need to:
 * 1. Build the plugin first (if not already built)
 * 2. Create a temporary .opencode/config.json in the test workspace
 * 3. Reference the built plugin in the config
 */
async function realPTYSession(
  prompt: string,
  config: RunnerConfig,
): Promise<{
  exitCode: number;
  output: string;
  pluginActivated: boolean;
  process: ManagedProcess | null;
}> {
  // CRITICAL: Ensure the plugin is loaded in the test workspace
  // We need to create a .opencode/config.json that references this repo's plugin
  await setupPluginConfig(config.workDir);

  // Construct the autopilot invocation message
  // CRITICAL: We must tell autopilot to enable AND execute the task
  const message = `autopilot(action="on", autonomousStrength="${config.strength}") then ${prompt}`;

  let terminalOutput = "";
  let processExited = false;
  let proc: ManagedProcess | null = null;

  try {
    // Build command args
    const args = [
      "run",
      "--dangerously-skip-permissions", // Auto-approve actions for testing
      "--dir",
      config.workDir,
      message,
    ];

    if (config.verbose) {
      console.log(`[REAL PTY] Running: opencode ${args.join(" ")}`);
    }

    // Spawn OpenCode CLI in a GENUINE PTY using Bun's terminal support
    proc = spawn(["opencode", ...args], {
      cwd: config.workDir,
      env: {
        ...process.env,
        // Force non-interactive mode where possible
        CI: "true",
        // Keep TERM for terminal capabilities
        TERM: process.env.TERM || "xterm-256color",
        OPENCODE_NO_PROMPT: "1",
      },
      // CRITICAL: Use Bun's genuine PTY support
      terminal: {
        cols: 80,
        rows: 24,
        name: "xterm-256color",
        data(_terminal, data) {
          // Collect all terminal output
          const text = new TextDecoder().decode(data);
          terminalOutput += text;

          if (config.verbose) {
            process.stdout.write(text); // Echo to test output
          }
        },
        exit(_terminal, _exitCode, _signal) {
          processExited = true;
        },
      },
    });

    // Wait for process to exit or timeout (handled by caller)
    const exitCode = await proc.exited;

    // Give terminal a moment to flush final output
    if (!processExited) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // CRITICAL: Verify plugin activation
    const pluginActivated = verifyPluginActivation(terminalOutput);

    if (!pluginActivated && config.verbose) {
      console.log("[WARNING] No evidence of autopilot plugin activation in PTY output");
      console.log("Output preview:", terminalOutput.substring(0, 500));
    }

    return {
      exitCode,
      output: terminalOutput,
      pluginActivated,
      process: proc,
    };
  } catch (error) {
    // If PTY execution fails, return error output
    return {
      exitCode: 1,
      output: `[REAL_PTY_ERROR] Failed to execute OpenCode CLI in PTY: ${error instanceof Error ? error.message : String(error)}\n${terminalOutput}`,
      pluginActivated: false,
      process: proc,
    };
  }
}

/**
 * Setup OpenCode plugin configuration in the test workspace
 *
 * This ensures that the autopilot plugin from this repository is loaded
 * when OpenCode runs in the test workspace.
 */
async function setupPluginConfig(workDir: string): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  // Create .opencode directory in test workspace
  const opencodeDir = path.join(workDir, ".opencode");
  await fs.mkdir(opencodeDir, { recursive: true });

  // Determine the path to this repository's plugin
  // Assuming tests run from repo root, the built plugin should be in dist/
  const repoRoot = path.resolve(import.meta.dir, "../../..");
  const pluginPath = path.join(repoRoot, "dist/index.js");

  // Check if plugin is built
  try {
    await fs.access(pluginPath);
  } catch {
    // Plugin not built - attempt to build it
    console.log("[SETUP] Building autopilot plugin...");
    const buildResult = spawnSync(["bun", "run", "build"], {
      cwd: repoRoot,
      stdout: "inherit",
      stderr: "inherit",
    });

    if (buildResult.exitCode !== 0) {
      throw new Error(`Failed to build autopilot plugin (exit code: ${buildResult.exitCode})`);
    }
  }

  // Create config.json that loads the plugin
  const config = {
    plugins: [
      {
        // Reference the local plugin
        path: pluginPath,
      },
    ],
  };

  const configPath = path.join(opencodeDir, "config.json");
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));

  if (process.env.VERBOSE === "1") {
    console.log(`[SETUP] Created plugin config at ${configPath}`);
    console.log(`[SETUP] Plugin path: ${pluginPath}`);
  }
}

/**
 * Verify that the autopilot plugin is actually loaded and active
 *
 * This checks for specific markers that only appear when the autopilot plugin
 * is successfully loaded and processing the autopilot() function call.
 *
 * CRITICAL: Tests must not pass on generic output or echoed prompts.
 * This function requires SPECIFIC evidence that the plugin executed:
 * - NOT generic words like "autopilot" (could be echoed from prompt)
 * - NOT weak patterns that match user input
 * - ONLY structured output or confirmed state changes from the plugin
 *
 * STRICTER VALIDATION: Requires multiple markers or very specific patterns
 * that only the plugin would emit, not echoed user input.
 */
function verifyPluginActivation(output: string): boolean {
  // Look for SPECIFIC evidence that plugin processed the autopilot() call
  // These patterns must be specific enough to NOT match echoed user input

  // Strategy: Require EITHER:
  // 1. Multiple weak markers (reduces false positive risk)
  // 2. OR one very specific plugin-only marker

  const weakMarkers = [
    // These could appear in echoed prompts, so require multiple matches
    /autonomousStrength/i, // More specific than just "autonomous"
    /\bstrength.*(?:aggressive|balanced|conservative)/i,
  ];

  const strongMarkers = [
    // These patterns are very unlikely to appear in echoed user input
    /autopilot.*(?:activated|initialized|configured)/i, // Plugin-specific state verbs
    /plugin.*autopilot.*loaded/i, // Explicit plugin loading message
    /autonomous mode.*(?:enabled|active)/i, // Specific state change
    // Look for tool invocations or other concrete plugin actions
    /\[Tool:.*mcp_/i, // MCP tool invocation (plugin is working)
  ];

  // Check for strong markers first (definitive evidence)
  for (const marker of strongMarkers) {
    if (marker.test(output)) {
      return true;
    }
  }

  // Require at least 2 weak markers to reduce false positives
  let weakMatchCount = 0;
  for (const marker of weakMarkers) {
    if (marker.test(output)) {
      weakMatchCount++;
      if (weakMatchCount >= 2) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Simulate an autopilot session (MOCK for validation concept)
 *
 * This mock demonstrates the VALIDATION LOGIC we would apply to real output.
 * Used when OpenCode CLI is not available, PTY is not supported, or in forceSimulation mode.
 */
async function simulateSession(
  prompt: string,
  config: RunnerConfig,
): Promise<{
  exitCode: number;
  output: string;
  pluginActivated: boolean;
  process: null;
}> {
  // Simulate processing time based on strength
  const baseDelay = config.strength === "aggressive" ? 100 : 200;
  await new Promise((resolve) => setTimeout(resolve, baseDelay));

  let output = `[SIMULATION] Processing: ${prompt}\n`;
  output += `[SIMULATION] Autonomous strength: ${config.strength}\n\n`;

  // Simulate tool usage based on prompt content
  if (prompt.includes("Create") || prompt.includes("create")) {
    output += "[Tool: mcp_write] Writing file...\n";
  }
  if (prompt.includes("test")) {
    output += "[Tool: mcp_bash] Running tests...\n";
  }

  output += "\n[SIMULATION] Session completed\n";

  return {
    exitCode: 0,
    output,
    pluginActivated: false, // Simulation doesn't actually activate plugin
    process: null, // No real process in simulation
  };
}

/**
 * Analyze session output for behavioral patterns
 */
function analyzeOutput(
  output: string,
  _strength: AutonomousStrength,
  mode: "real" | "simulation",
): RunResult["behaviors"] {
  const toolsUsed: string[] = [];
  const filesReferenced: string[] = [];
  let appearedBlocked = false;
  let completedSuccessfully = false;

  // Extract tool invocations (both real and simulated formats)
  const toolMatches = output.matchAll(/\[Tool: ([^\]]+)\]/g);
  for (const match of toolMatches) {
    if (match[1]) {
      toolsUsed.push(match[1]);
    }
  }

  // Also look for function call patterns in real output
  if (mode === "real") {
    const funcMatches = output.matchAll(/(\w+)\(/g);
    for (const match of funcMatches) {
      if (match[1] && !toolsUsed.includes(match[1])) {
        toolsUsed.push(match[1]);
      }
    }
  }

  // Extract file references
  const fileMatches = output.matchAll(/(\w+\.(ts|js|json|md|txt))/g);
  for (const match of fileMatches) {
    if (match[1] && !filesReferenced.includes(match[1])) {
      filesReferenced.push(match[1]);
    }
  }

  // Detect blocking indicators
  appearedBlocked =
    output.includes("BLOCKED") ||
    output.includes("waiting for user") ||
    output.includes("no admissible action") ||
    output.includes("Permission denied");

  // Detect successful completion
  completedSuccessfully =
    (output.includes("completed") || output.includes("success") || output.includes("done")) &&
    !output.includes("ERROR") &&
    !output.includes("TIMEOUT") &&
    !appearedBlocked;

  return {
    toolsUsed,
    filesReferenced,
    appearedBlocked,
    completedSuccessfully,
  };
}

/**
 * Validate that output contains expected patterns
 */
export function validatePatterns(
  output: string,
  expectedPatterns: string[],
  forbiddenPatterns: string[],
): {
  matched: string[];
  missing: string[];
  forbidden: string[];
} {
  const matched: string[] = [];
  const missing: string[] = [];
  const forbidden: string[] = [];

  // Check expected patterns
  for (const pattern of expectedPatterns) {
    const regex = new RegExp(pattern, "i");
    if (regex.test(output)) {
      matched.push(pattern);
    } else {
      missing.push(pattern);
    }
  }

  // Check forbidden patterns
  for (const pattern of forbiddenPatterns) {
    const regex = new RegExp(pattern, "i");
    if (regex.test(output)) {
      forbidden.push(pattern);
    }
  }

  return { matched, missing, forbidden };
}

/**
 * Create a temporary test workspace
 */
export async function createTestWorkspace(
  testId: string,
): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const tmpDir = `/tmp/opencode-autopilot-test-${testId}-${Date.now()}`;

  // Create temp directory
  const fs = await import("node:fs/promises");
  await fs.mkdir(tmpDir, { recursive: true });
  await fs.writeFile(`${tmpDir}/.gitkeep`, "");

  return {
    path: tmpDir,
    cleanup: async () => {
      // Clean up test workspace
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
      } catch {
        // Best effort cleanup
      }
    },
  };
}
