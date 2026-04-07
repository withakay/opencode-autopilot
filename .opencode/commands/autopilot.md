---
description: Control session autopilot or hand off a long-running task
---
Use the `autopilot` tool to control session autopilot.

Interpret `$ARGUMENTS` like this:
- `on` => enable autopilot for the rest of the session
- `off` or `stop` => disable autopilot
- `status` => show autopilot status
- `help` => show autopilot usage
- anything else => treat it as the delegated task and start it immediately

Additional parsing rules:
- If the user includes `allow-all` or `allow all`, set `permissionMode` to `allow-all`
- If the user includes `limited`, set `permissionMode` to `limited`
- If the user includes a continuation cap such as `max 3`, `max=3`, or `continue 3 times`, pass it as `maxContinues`
- If the user includes `agent <name>`, `use <name>`, or `agent=<name>`, pass it as `workerAgent`

Return only the tool result.
