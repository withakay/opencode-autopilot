# Goal
Bump the package version in this repo to the next requested release value.

## Assumptions
- “bump the version” means increment the current `package.json` version from `0.3.0` to `0.3.1`.
- No commit or publish is requested yet.

## Tasks
1. ID: T1
   Title: Create autopilot session state
   Done When: Session plan/state/task files exist under `.autopilot/sessions/20260408-202645-bump-version/`
   Validate With: file existence review
2. ID: T2
   Title: Update package version
   Done When: `package.json` version is changed from `0.3.0` to `0.3.1`
   Validate With: read `package.json`

## Assumption Policy
- If release target is ambiguous, choose the smallest safe semantic bump and document it.
