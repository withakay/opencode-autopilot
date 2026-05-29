# Autopilot Session State

- session name: 20260529-085325-user-data-storage
- current phase: IN_FLIGHT
- overall status: COMPLETE
- current task id: T3
- retry counts: none
- last validation result: `bun run lint && bun run typecheck && bun test ./__tests__/ && bun run build` passed
- active assumptions:
  - Use `~/.local/share/opencode/opencode-autopilot/` as requested default runtime storage base.
  - Prefer `.opencode/opencode-autopilot.jsonc` for repo-local configuration and keep `.autopilot/config.*` as a fallback.
  - User requested config move during execution; plan updated and implementation widened accordingly.

## Summary
- Runtime state now writes to `~/.local/share/opencode/opencode-autopilot/projects/<project-key>/state.json` by default.
- Project keys combine a readable slug with a SHA-256 path hash to avoid cross-repo collisions.
- Legacy repo-local `.autopilot/state.json` is still readable when user-data state is absent.
- Config now prefers `.opencode/opencode-autopilot.jsonc`, then `.opencode/opencode-autopilot.json`, then legacy `.autopilot/config.*` files.
- README and tests were updated.
