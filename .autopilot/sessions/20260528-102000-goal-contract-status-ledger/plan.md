# Goal
Build the first concrete Codex-goals-inspired Autopilot upgrade: structured goal contracts, checkpoint/progress evidence, richer status output, and completion/block digests while preserving existing objective-run behavior.

## Assumptions
- Implement a practical first iteration, not every idea from the research list.
- Keep changes backward-compatible with persisted state where possible.
- Preserve existing slash command/tool UX; improve the output and internal state rather than requiring new commands.
- Do not overwrite or revert existing user/unrelated working-tree changes.
- Prefer controller-visible state and tests over prompt-only behavior.

## Tasks
1. ID: T1
   Title: Add goal contract and checkpoint state model
   Done When: Runtime state supports goal quality/criteria/source/checkpoint/verification fields with safe defaults and persistence compatibility.
   Validate With: `bun run typecheck` and targeted state/format tests.

2. ID: T2
   Title: Upgrade status and prompt surfaces
   Done When: `/autopilot status` renders a human-readable run card with objective, checkpoint, contract, validation, budget, recent events, and blockers; prompts include structured contract/checkpoint expectations.
   Validate With: `bun test ./__tests__/prompts.test.ts ./__tests__/autopilot-tool.test.ts`

3. ID: T3
   Title: Integrate ledger updates and final digests
   Done When: Objective start, continuations, plan steps, verification failures/successes, blocked/completed stops update checkpoint/evidence state and status shows completion/block digests.
   Validate With: `bun test ./__tests__/plugin.test.ts ./__tests__/autopilot-tool.test.ts`

4. ID: T4
   Title: Document and validate full build
   Done When: README describes goal contracts/status UX, tests cover new behavior, and full test/typecheck/build pass.
   Validate With: `bun test ./__tests__/ && bun run typecheck && bun run build`

## Assumption Policy
- If scope pressure appears, prioritize richer status + structured state + tests over advanced no-progress detection or safe verification allowlists.
- If current dirty files conflict, preserve existing intent and make minimal additive edits.
- If a behavior cannot be controller-enforced yet, represent it as structured evidence/criteria for a later hardening pass rather than overclaiming enforcement.
