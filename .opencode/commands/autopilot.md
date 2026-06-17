---
description: Control session autopilot or start a durable objective run
---
Use the `autopilot` tool to control session autopilot.

Interpret `$ARGUMENTS` like this:
- `on` => enable ambient autopilot defaults for the rest of the session; do not start a continuation loop
- `off` or `stop` => disable autopilot
- `pause` => pause the active objective run
- `resume` => resume a paused or blocked objective run
- `clear` => clear the active objective run
- `status` => show autopilot status
- `help` => show autopilot usage
- anything else => treat it as the durable objective and start it immediately with `action="start"` and `objective=<text>`

Additional parsing rules:
- If the user includes `allow-all` or `allow all`, set `permissionMode` to `allow-all`
- If the user includes `limited`, set `permissionMode` to `limited`
- If the user includes a continuation cap such as `max 3`, `max=3`, or `continue 3 times`, pass it as `maxContinues`
- If the user includes a duration cap such as `15 minutes`, `max 15m`, or `duration 900000ms`, pass it as `maxDurationMs` in milliseconds
- If the user includes a token cap such as `max tokens 100000` or `token budget 100k`, pass it as `maxTokens`
- If the user includes stall/no-progress settings, pass them as `noProgressTokenThreshold` and/or `noProgressTurns`
- If the user includes `agent <name>`, `use <name>`, or `agent=<name>`, pass it as `workerAgent`
- Do not ask the user to choose autonomous strength. Autopilot objective runs should default to strong autonomy; only pass `autonomousStrength` if the user explicitly asks for a lower-supervision mode.
- If the user phrases a stopping condition such as `until ...` or `without stopping until ...`, include the full objective text; if there is a distinct verification command, pass it as `verifyWith`
- If the user says to execute, accept, apply, implement, follow, or continue a plan/spec/change/proposal/feature, treat that as an objective run.
- If the actual plan text is present in the prompt, pass it as `plan`; otherwise do not ask for a plan source. Let autopilot infer likely planning/spec artifacts from the objective and repository.
- Treat planning-related words broadly: plan, spec, specification, proposal, change, feature, accepted plan, plan mode, Ito, OpenSpec, SpecKit, OpenCode, Codex, Copilot, Claude Code, Superpower Skills, Matt Pocock/Total TypeScript, Grill Me, and swarm task plans.

Return only the tool result.
