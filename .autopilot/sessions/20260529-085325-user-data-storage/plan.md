# Goal
Move Autopilot runtime persistence out of the repository and into `~/.local/share/opencode/opencode-autopilot/`, and move repo-local configuration to `.opencode/opencode-autopilot.jsonc`.

## Assumptions
- The requested base directory is the default runtime storage root: `~/.local/share/opencode/opencode-autopilot/`.
- Runtime state should be project-scoped under that base to avoid collisions between repos.
- Existing repo-local `.autopilot/state.json` should remain readable as a legacy fallback/migration source.
- `.opencode/opencode-autopilot.jsonc` is the preferred config file; legacy `.autopilot/config.jsonc` and `.autopilot/config.json` remain supported as fallbacks.
- No commit is requested for this change.

## Tasks
1. ID: T1
   Title: Implement user-data persistence path
   Done When: `PersistentStateStore.forRoot(root)` stores state under `~/.local/share/opencode/opencode-autopilot/projects/<project-key>/state.json` and can load legacy repo-local `.autopilot/state.json` if needed.
   Validate With: targeted persistence tests and `bun run typecheck`.

2. ID: T2
   Title: Document storage behavior
   Done When: README explains `.opencode/opencode-autopilot.jsonc` config, legacy config fallback, repo config vs user-data runtime state, and the exact default state path.
   Validate With: README inspection and full test suite.

3. ID: T3
   Title: Validate full change
   Done When: lint, typecheck, tests, and build pass.
   Validate With: `bun run lint && bun run typecheck && bun test ./__tests__/ && bun run build`.

## Assumption Policy
- Prefer the smallest backward-compatible implementation.
- If platform-specific path ambiguity appears, use the exact requested XDG-style path regardless of OS.
- Do not remove existing repo-local state/config files automatically; only stop writing runtime state there by default and prefer the new config path.
