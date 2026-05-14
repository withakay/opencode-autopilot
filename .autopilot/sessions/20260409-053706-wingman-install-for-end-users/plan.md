# Goal
Make this plugin install and expose the Wingman agent presets, so end users get both `/autopilot` and the predefined Wingman agents when they install the package.

## Assumptions
- As the repo stands now, **no**: the plugin does not currently install the various Wingman agents.
- “Install the various wingman agents” means the package should provision OpenCode agent config artifacts in the consuming project, not dynamically create agents at runtime through the plugin API.
- The safest implementation is to use packaged config/templates plus install-time file creation/update, because the plugin API currently exposes tool/hooks, not slash-command or dynamic-agent registration.
- User clarified scope is **for end users**.

## Tasks
1. ID: T1
   Title: Confirm current packaging gap
   Done When: We verify whether Wingman config/templates are currently shipped and installed
   Validate With: inspect `package.json`, packaged files, and current install script behavior
2. ID: T2
   Title: Add packaged Wingman config artifacts
   Done When: the npm package includes the Wingman config/template files needed for installation
   Validate With: inspect `package.json` `files` list and dry-run package contents
3. ID: T3
   Title: Extend install script to provision Wingman agents
   Done When: install-time script copies or merges Wingman agent definitions into the consumer project alongside the slash command
   Validate With: typecheck, build, and a local install-script simulation
4. ID: T4
   Title: Document plugin installation behavior
   Done When: README clearly states what gets installed automatically, what files are created, and any limitations
   Validate With: inspect updated README content
5. ID: T5
   Title: Verify publish readiness
   Done When: package builds, typechecks, and dry-run packaging includes the new install artifacts
   Validate With: `bun run typecheck`, `bun test`, `bun run build`, `npm pack --dry-run`

## Assumption Policy
- If OpenCode agent config format remains partially uncertain, prefer a reversible template/install approach that preserves existing user config and avoids destructive overwrites.
