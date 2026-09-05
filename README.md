# @withakay/opencode-autopilot

OpenCode v2 plugin for ambient autonomy and bounded objective runs.

## Install

Add the package to `opencode.jsonc`. OpenCode v2 installs npm plugins itself:

```jsonc
{
  "plugins": ["@withakay/opencode-autopilot@beta"]
}
```

For a local checkout, use its absolute path instead:

```jsonc
{
  "plugins": ["/absolute/path/to/opencode-autopilot"]
}
```

OpenCode v2 uses the `plugins` key. The v1 `plugin` key and
`.opencode/commands` files are not used. The package does not install a
slash-command file.

## Command

`/autopilot` parses its arguments deterministically:

```text
(empty) | help                      -> help
on [flags]                          -> ambient autonomy
off | stop                          -> stop
pause                               -> pause objective
resume [flags]                      -> resume objective
clear                               -> clear objective
status                              -> run card
<objective> [flags]                 -> start objective run
```

Flags are removed from the objective when they occur on the first line:

```text
--agent=<id> | --agent <id>
--max=<n> | --max <n> | max <n>
--limited | limited, --allow-all | allow-all
--duration=<15m|900s|900000ms|900000>
--tokens=<100k|100000>
--verify="<cmd>" | --done-when="<text>"
--strength=<conservative|balanced|aggressive>
```

The first line is the objective. Remaining lines become a plan when they look
like a list. Otherwise they extend the objective.

## Modes

- `on` enables ambient autonomy. It adds guidance but does not start a loop.
- An objective starts a bounded worker run and dispatches its first prompt in
  the same command. It continues until completion, a blocker, a pause, a
  clear, or a budget limit.
- `conservative`, `balanced`, and `aggressive` control how strongly the
  plugin prefers safe defaults. Objective runs use `aggressive` by default.

`allow-all` is the default permission mode. It allows permission requests while
Autopilot is active. `limited` denies permission requests and blocks the
objective. `verifyWith` commands require `allow-all`.

Default budgets:

| Budget | Default |
|---|---:|
| Continuations | `10` |
| Duration | `900000` ms |
| Worker tokens | `200000` |
| Low-progress threshold | `50` output tokens |
| Low-progress turns before pause | `2` |

Run `/autopilot status` to request the current run card. The TUI companion
opens the card in a dialog. Notices appear as three-second toasts.

The model can use the `autopilot` tool for the same actions. It accepts an
objective, plan, stopping condition, verification command, agent, permission
mode, strength, and budget values.

## TUI And Agents

The `./tui` export is auto-loaded by OpenCode v2. It subscribes to the server
RPC and displays notices as toasts and status cards as dialogs.

Wingman files are manual in v2. To use a preset, copy the desired
`.opencode/agents/*.md` file into the project or register the agent yourself.

## Development

```bash
bun install
bun run check
bun test
bun run build
```

## Manual Smoke Test

1. Run `bun install`, `bun run build` in this repository.
2. In a test project, add the local plugin path to `opencode.jsonc`:

   ```jsonc
   {
     "plugins": ["/absolute/path/to/opencode-autopilot"]
   }
   ```

3. Start `opencode2` in the test project.
4. Run `/autopilot on`, then `/autopilot status`. Confirm the notice toast and
   status dialog appear.
5. Run `/autopilot <small objective> --max=1` and confirm the first worker
   prompt starts without a follow-up prompt.
