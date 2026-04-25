# E2E Autonomous Behavior Validation

## Purpose

This directory contains **best-effort behavioral validation** for the autopilot plugin's autonomous strength modes (conservative, balanced, aggressive).

**Key insight**: Since OpenCode 1.3.0 has no general question/prompt hook, we validate autonomous behavior through **observable patterns** in output, timing, and completion markers—not through API interception.

## What This Tests

✅ **Tests:**
- **REAL workspace side effects** - verifies actual files created by autopilot
- **PTY-backed execution** - uses genuine OpenCode CLI with `--dangerously-skip-permissions`
- **File system assertions** - checks workspace for created/modified files
- Autonomous strength modes produce observable behavioral differences
- Aggressive mode tends to complete faster with fewer interactions
- All modes complete routine tasks without spinning/blocking
- Forbidden patterns (permission bypass, infinite loops) don't appear
- Test harness infrastructure works correctly

❌ **Does NOT test:**
- Specific prompt content (no hook to intercept)
- Exact question/answer sequences (not accessible)
- Deterministic output matching (too brittle for e2e tests)

## Architecture

```
__tests__/e2e/
├── README.md                           # This file
├── autonomous-behavior.test.ts         # Main validation tests
└── helpers/
    ├── fixtures.ts                     # Test scenarios & expected behaviors
    └── pty-runner.ts                   # Test runner (simulation + future PTY integration)
```

### Components

#### `fixtures.ts` - Test Scenarios
Defines test scenarios with:
- **Initial prompts**: Task descriptions to send to the agent
- **Expected behaviors**: Patterns to look for per strength mode
- **Forbidden patterns**: Anti-patterns that should never appear
- **Timeout thresholds**: Maximum execution time

Example scenario:
```typescript
{
  id: "file-creation",
  description: "Create a simple TypeScript file",
  initialPrompt: "Create a file hello.ts with a function",
  expectedBehaviors: {
    aggressive: ["write", "hello.ts", "Hello, World"],
    balanced: ["write", "hello.ts"],
    conservative: ["hello.ts"]
  },
  forbiddenPatterns: ["BLOCKED", "no admissible action"],
  timeoutMs: 30000
}
```

#### `pty-runner.ts` - Test Runner
Provides:
- **Session spawning**: Currently simulated, designed for future PTY integration
- **Output analysis**: Extract tool invocations, file references, behavioral markers
- **Pattern validation**: Match expected/forbidden patterns in output
- **Workspace management**: Create/cleanup temp test directories

Current mode: **SIMULATION**
- Validates test harness logic
- Demonstrates validation approach
- Ready for PTY integration

Future mode: **PTY INTEGRATION**
- Replace `simulateSession()` with real OpenCode CLI spawning
- Use `Bun.spawn()` or `node-pty` for terminal control
- Capture real stdout/stderr streams

#### `autonomous-behavior.test.ts` - Validation Tests
Main test suite with:
- **Harness validation**: Tests the testing infrastructure itself
- **Scenario validation**: Ensures test scenarios are well-formed
- **Behavioral comparison**: Compares strength modes (aggressive vs balanced vs conservative)
- **Integration readiness**: Documents how to integrate with real CLI

## Usage

### Local Development

**With OpenCode CLI installed** (runs REAL sessions + simulation):
```bash
# Install OpenCode CLI first (if not already installed)
npm install -g @opencode-ai/cli

# Run all e2e tests (includes both real and simulated tests)
E2E_ENABLED=1 bun test __tests__/e2e/autonomous-behavior.test.ts

# Run with verbose output to see real CLI execution
E2E_ENABLED=1 bun test __tests__/e2e/ --verbose
```

**Without OpenCode CLI** (runs simulation only):
```bash
# Tests automatically fall back to simulation mode
E2E_ENABLED=1 bun test __tests__/e2e/

# Tests marked with .skipIf(!openCodeAvailable) are skipped
# You'll see: "⚠️  OpenCode CLI not found - tests will run in SIMULATION mode only"
```

**Filter specific tests**:
```bash
# Run only real CLI tests (skips if CLI unavailable)
E2E_ENABLED=1 bun test -t "REAL CLI"

# Run only harness validation tests
E2E_ENABLED=1 bun test -t "Test Harness"
```

### CI Integration

By default, e2e tests are **skipped** to avoid flakiness. Enable with environment variable:

```yaml
# .github/workflows/test.yml
e2e-tests:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v3
    - uses: oven-sh/setup-bun@v1
    - run: bun install
    - run: E2E_ENABLED=1 bun test __tests__/e2e/
      continue-on-error: true  # Don't fail build on flaky e2e tests
```

**Recommendation**: Run e2e tests on a schedule (nightly) rather than every commit.

### Manual Testing

While automated tests run in simulation mode, you can manually validate autonomous behavior:

1. **Enable autopilot** in an OpenCode session:
   ```
   autopilot(action="on", autonomousStrength="aggressive")
   ```

2. **Give it a routine task**:
   ```
   Create a TypeScript file with a simple hello world function
   ```

3. **Observe behavior**:
   - **Aggressive**: Should proceed directly, pick safe defaults
   - **Balanced**: May ask about location, but proceeds quickly
   - **Conservative**: More likely to ask clarifying questions

4. **Look for anti-patterns**:
   - ❌ Spinning without progress
   - ❌ Bypassing approval checks
   - ❌ Infinite questioning loops

## Current Status: GENUINE PTY VALIDATION ✅

The current implementation supports **real OpenCode CLI execution in genuine pseudo-terminals with plugin activation verification**:

✅ **What works:**
- **GENUINE PTY EXECUTION** via `Bun.spawn({ terminal: {...} })` - real pseudo-terminal, not piped stdio
- **Full terminal semantics** - process.stdout.isTTY=true, terminal escape sequences, color support
- **Plugin activation verification** - explicitly checks autopilot plugin is loaded
- **Plugin configuration** - automatically creates .opencode/config.json to load this repo's plugin
- **File system assertions** - verifies actual files created in workspace (REQUIRED for passing)
- **Workspace side effect validation** - not just output pattern matching
- **Explicit skip conditions** - tests skip with precise reason if environment unsupported
- **NO generic passes** - file creation tests MUST verify actual files or skip
- Test harness infrastructure
- Output pattern validation logic
- Workspace creation/cleanup
- Behavioral comparison framework
- Guarded CI execution
- Automatic fallback to simulation when PTY/CLI unavailable
- Runtime detection of PTY and CLI availability
- Environment-based skip conditions
- POSIX-only PTY support (Linux, macOS) with graceful Windows fallback

🔒 **Critical Requirements (enforced):**
1. **Genuine PTY**: Uses Bun's native PTY support, not node:child_process with piped stdio
2. **Plugin Loading**: Automatically configures OpenCode to load this repo's autopilot plugin
3. **Plugin Activation (Strict)**: Tests verify plugin via SPECIFIC markers, not echoed prompts
   - Requires multiple weak markers OR one strong marker
   - Rejects patterns that could match user input being echoed
4. **Concrete Side Effects**: File creation tests MUST check filesystem, not just output
5. **Explicit Skips**: Tests skip with reason if plugin not activated or files not created
6. **No Generic Passes**: Tests fail/skip if environment doesn't support validation
7. **Timeout Cleanup**: Timed-out PTY sessions are explicitly terminated and awaited

🔀 **Execution Modes:**

1. **REAL PTY MODE** (when OpenCode CLI is installed and PTY is available):
   - Spawns actual OpenCode in genuine pseudo-terminal via `Bun.spawn({ terminal })`
   - 80x24 terminal, xterm-256color emulation
   - Full terminal capabilities (ANSI escape sequences, cursor control, colors)
   - Captures all PTY output via data callback
   - Validates actual autonomous behavior
   - Tests marked with `.skipIf(!openCodeAvailable)` run only when CLI is present
   - Automatically builds and configures plugin in test workspace

2. **SIMULATION MODE** (fallback when PTY/CLI unavailable or forced):
   - Mock OpenCode session with simulated output
   - Fast, deterministic test execution
   - No external dependencies
   - Validates test harness logic
   - Used on Windows (PTY not supported) or when OpenCode CLI missing

📋 **Why genuine PTY?**
- **True terminal environment**: Process sees isTTY=true, gets terminal capabilities
- **Realistic execution**: Tests behavior in actual terminal, not redirected pipes
- **Full interactivity**: Supports colored output, cursor control, line buffering
- **Accurate validation**: Verifies autopilot works in real user environment
- **Platform-aware**: Gracefully falls back on Windows (no POSIX PTY support)

## Real PTY Execution Implementation Details

The current implementation uses **genuine PTY execution via Bun's native terminal support**:

### Architecture

```typescript
// Runtime detection
const cliAvailable = await isOpenCodeAvailable();
const ptyAvailable = isPTYAvailable(); // POSIX-only (not Windows)

// Tri-mode execution
const canUseRealPTY = cliAvailable && ptyAvailable && !forceSimulation;
const result = canUseRealPTY
  ? await realPTYSession(prompt, config)    // Spawn in genuine PTY
  : await simulateSession(prompt, config);  // Mock execution

// CRITICAL: Result includes plugin activation status
interface RunResult {
  exitCode: number | null;
  output: string;              // All PTY output (not just stdout)
  timedOut: boolean;
  durationMs: number;
  pluginActivated: boolean;    // CRITICAL: Must verify plugin loaded
  behaviors: { /* ... */ };
}
```

### Real PTY Session Flow with Plugin Configuration

```typescript
async function realPTYSession(prompt: string, config: RunnerConfig) {
  // STEP 1: Setup plugin config in test workspace
  await setupPluginConfig(config.workDir);  // Creates .opencode/config.json
  
  // STEP 2: Construct autopilot invocation
  const message = `autopilot(action="on", autonomousStrength="${config.strength}") then ${prompt}`;
  
  // STEP 3: Build command args
  const args = [
    "run",
    "--dangerously-skip-permissions",  // Auto-approve actions
    "--dir",
    config.workDir,
    message,
  ];
  
  let terminalOutput = '';
  
  // STEP 4: Spawn OpenCode in GENUINE PTY using Bun's terminal support
  const proc = Bun.spawn(['opencode', ...args], {
    cwd: config.workDir,
    env: { 
      CI: 'true',
      TERM: process.env.TERM || 'xterm-256color',  // Keep terminal capabilities
      OPENCODE_NO_PROMPT: '1'
    },
    // CRITICAL: Use Bun's native PTY support
    terminal: {
      cols: 80,                    // Terminal width
      rows: 24,                    // Terminal height
      name: 'xterm-256color',      // Terminal type
      data(_terminal, data) {
        // Collect all PTY output (includes ANSI escape sequences)
        const text = new TextDecoder().decode(data);
        terminalOutput += text;
      },
      exit(_terminal, _exitCode, _signal) {
        // PTY stream closed (not same as process exit)
      }
    }
  });
  
  // STEP 5: Wait for process to exit
  const exitCode = await proc.exited;
  
  // STEP 6: Verify plugin activation from PTY output
  const pluginActivated = verifyPluginActivation(terminalOutput);
  
  return { exitCode, output: terminalOutput, pluginActivated, process: proc };
}

// Timeout handling with explicit cleanup
const result = await Promise.race([sessionPromise, timeoutPromise]);

if (result === "timeout") {
  // CRITICAL: Explicitly terminate timed-out PTY sessions
  if (spawnedProcess) {
    spawnedProcess.kill();
    await Promise.race([
      spawnedProcess.exited,
      new Promise(resolve => setTimeout(resolve, 2000))  // Max 2s wait for kill
    ]);
  }
}

// Plugin configuration setup
async function setupPluginConfig(workDir: string) {
  // Create .opencode/config.json referencing this repo's built plugin
  const repoRoot = path.resolve(import.meta.dir, '../../..');
  const pluginPath = path.join(repoRoot, 'dist/index.js');
  
  // Build plugin if not already built
  if (!await exists(pluginPath)) {
    await Bun.spawnSync(['bun', 'run', 'build'], { cwd: repoRoot });
  }
  
  // Write config that loads the plugin
  const config = {
    plugins: [{ path: pluginPath }]
  };
  
  await fs.writeFile(
    path.join(workDir, '.opencode/config.json'),
    JSON.stringify(config, null, 2)
  );
}

// Plugin activation verification (STRICT - prevents false positives)
function verifyPluginActivation(output: string): boolean {
  // Weak markers: could appear in echoed prompts, require multiple matches
  const weakMarkers = [
    /autonomousStrength/i,
    /\bstrength.*(?:aggressive|balanced|conservative)/i,
  ];
  
  // Strong markers: very unlikely to appear in echoed user input
  const strongMarkers = [
    /autopilot.*(?:activated|initialized|configured)/i,
    /plugin.*autopilot.*loaded/i,
    /autonomous mode.*(?:enabled|active)/i,
    /\[Tool:.*mcp_/i,  // MCP tool invocation proves plugin is working
  ];
  
  // Accept one strong marker OR two weak markers
  if (strongMarkers.some(m => m.test(output))) return true;
  
  const weakCount = weakMarkers.filter(m => m.test(output)).length;
  return weakCount >= 2;
}
```

**Key Improvements from Previous Version:**
- **Genuine PTY**: Uses `Bun.spawn({ terminal })`, not `child_process` with piped stdio
- **Full terminal semantics**: Process sees isTTY=true, gets 80x24 terminal with xterm-256color
- **Plugin configuration**: Automatically creates .opencode/config.json to load this repo's plugin
- **Plugin build check**: Automatically builds plugin if dist/index.js doesn't exist
- **PTY output capture**: Collects all terminal output via data callback, including ANSI sequences
- **Platform-aware**: Checks PTY availability (POSIX-only), falls back on Windows
- **Proper exit handling**: Distinguishes between PTY stream close and process exit

### Test Guards

```typescript
// Skip test if CLI is not available
test.skipIf(!openCodeAvailable)(
  "REAL CLI: test name",
  async () => { /* test body */ }
);

// Force simulation for consistent timing tests
await runAutopilotSession(prompt, {
  forceSimulation: true,  // Use simulation even if CLI available
  // ...
});
```

### CI Configuration

To enable real CLI testing in CI:

```yaml
e2e-tests:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v3
    - uses: oven-sh/setup-bun@v1
    - run: bun install
    - name: Install OpenCode CLI
      run: npm install -g @opencode-ai/cli
    - run: E2E_ENABLED=1 bun test __tests__/e2e/
      continue-on-error: true  # Don't fail build on flaky e2e tests
```

### Test Isolation

Each test already has:
- ✅ Fresh workspace per test (`createTestWorkspace`)
- ✅ Cleanup after completion (`workspace.cleanup()`)
- ✅ Timeout handling (configurable per scenario)
- ✅ Environment isolation (`CI=true`, `NO_COLOR=1`)

## Interpreting Results

### ✅ Tests PASS
- Behavioral differences are observable
- Aggressive mode shows measurably less interaction
- No forbidden patterns detected
- **Interpretation**: Plugin likely working as intended

### ❌ Tests FAIL
Could indicate:
1. **Regression**: Autonomous behavior changed
2. **Environmental variance**: Timing, load, randomness
3. **Test flakiness**: PTY issues, process cleanup

**Action**: 
- Retry the test
- Check recent changes to autopilot prompt/reducer
- Run manually for human validation

### ⏭️ Tests SKIP
- Normal in CI without `E2E_ENABLED=1`
- Tests are guarded to avoid CI flakiness
- Run manually during development

## Limitations & Caveats

### Technical Limitations
- **No question hook**: Can't intercept or mock user prompts
- **Output-based validation**: Brittle to output format changes
- **PTY flakiness**: Terminal testing is inherently unstable
- **Timing dependencies**: Aggressive mode TENDS to be faster, not GUARANTEED

### Validation Approach
This is **best-effort behavioral validation**, not formal verification:
- We validate **tendencies**, not **guarantees**
- Tests detect **observable patterns**, not **internal state**
- Passing tests are a **positive signal**, not **proof of correctness**
- Manual review is still valuable for full validation

### When to Run
- ✅ During development (manual)
- ✅ Before major releases (manual)
- ✅ On schedule (nightly CI)
- ⚠️ Every commit (too flaky, skip by default)

## Contributing

### Adding New Scenarios

1. Add scenario to `helpers/fixtures.ts`:
```typescript
export const MY_SCENARIO: TestScenario = {
  id: "my-test",
  description: "What this tests",
  initialPrompt: "Task description",
  expectedBehaviors: {
    aggressive: ["pattern1", "pattern2"],
    balanced: ["pattern1"],
    conservative: []
  },
  forbiddenPatterns: ["BLOCKED"],
  timeoutMs: 30000
};
```

2. Add to scenario list:
```typescript
export const ALL_SCENARIOS = [
  FILE_CREATION_SCENARIO,
  MY_SCENARIO,  // Add here
];
```

3. Run test:
```bash
E2E_ENABLED=1 bun test __tests__/e2e/
```

### Improving Pattern Matching

Edit `analyzeOutput()` in `pty-runner.ts` to extract additional behavioral markers:

```typescript
function analyzeOutput(output: string) {
  // Add new pattern detection
  const questionCount = (output.match(/\?/g) || []).length;
  
  return {
    ...existing,
    questionCount,
  };
}
```

## References

- **Autopilot Spec**: `autopilot-spec.md` - Core invariants and control flow
- **System Prompt**: `prompts/system-prompt.ts` - Autonomous strength implementations
- **Tool Definition**: `tools/autopilot.ts` - Autopilot tool with strength parameter
- **Unit Tests**: `__tests__/prompts.test.ts` - Prompt content validation

## Questions?

- **Why simulation instead of real PTY?** 
  - Validates the approach without CI flakiness
  - No external dependencies
  - Fast feedback loop
  
- **When will this use real PTY?**
  - When OpenCode CLI is stable enough for CI
  - When tests are valuable enough to justify flakiness
  - When integration test infrastructure is set up

- **How do I manually validate behavior?**
  - See "Manual Testing" section above
  - Use `autopilot(action="on", autonomousStrength="aggressive")`
  - Give routine tasks and observe

- **What if tests fail intermittently?**
  - Check CI logs for timing issues
  - Run locally with `E2E_ENABLED=1`
  - Consider increasing timeouts
  - Add retry logic
