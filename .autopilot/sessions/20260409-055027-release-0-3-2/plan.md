# Goal
Bump the package version, create a git commit for the current releasable changes, and publish the package if the environment is authenticated and ready.

## Assumptions
- “1,2,3” means: bump version, commit changes, then publish.
- Because no target version was specified, the safest semantic bump is a patch release from `0.3.1` to `0.3.2`.
- Publishing should use the existing npm package name and public access mode.
- If npm authentication is missing, I should stop at a ready-to-publish state and report the blocker.

## Tasks
1. ID: T1
   Title: Create release session state
   Done When: Session tracking files exist under a deterministic `.autopilot/sessions/...` directory
   Validate With: file existence review
2. ID: T2
   Title: Inspect release readiness
   Done When: current git status, diff, and recent commit style are reviewed
   Validate With: `git status --short`, `git diff --stat`, `git log --oneline -10`
3. ID: T3
   Title: Bump package version
   Done When: `package.json` version is updated from `0.3.1` to `0.3.2`
   Validate With: read `package.json`
4. ID: T4
   Title: Verify package before release
   Done When: typecheck, tests, build, and package dry-run succeed for the bumped version
   Validate With: `bun run typecheck`, `bun test`, `bun run build`, `npm pack --dry-run`
5. ID: T5
   Title: Create release commit
   Done When: relevant files are staged and committed with a message matching repo style
   Validate With: `git status`, `git log -1 --oneline`
6. ID: T6
   Title: Publish package
   Done When: `npm publish --access public` succeeds, or an authentication/registry blocker is identified
   Validate With: publish command result

## Assumption Policy
- If a release detail is ambiguous, choose the smallest safe release action that preserves progress.
- If external credentials are required and unavailable, stop at a clean, validated, committed release candidate and report the exact blocker.
