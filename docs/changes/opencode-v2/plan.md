# Port opencode-autopilot to the OpenCode v2 plugin API

## Intent

Make `/autopilot <objective>` start work deterministically on OpenCode v2
(`opencode2` beta, `@opencode-ai/plugin@beta`, Promise API `Plugin.define`).

Root cause of the v1 "needs a follow-up prompt" problem: `/autopilot` was a
Markdown command template. The model had to (1) read the template, (2) call the
`autopilot` tool with `action="start"`, then (3) the plugin waited for a
`session.idle` event before it sent the first worker prompt. Steps 1 and 3 were
not deterministic.

In v2 a plugin registers the command with an `execute` function. The plugin
parses the arguments itself and dispatches the worker prompt in the same call.

## Verified v2 facts (beta-19135, source branch `beta`)

- Server plugin: default export `Plugin.define({ id, setup(ctx) })` from
  `@opencode-ai/plugin`. `setup` may return a cleanup function.
- `ctx.command.transform(e => e.add({ name, description, execute({ sessionID, prompt, delivery }) }))`.
  `prompt.text` is the argument string without the `/autopilot` prefix. The
  executor runs before any model turn; returning without prompting is a no-op.
- `ctx.session.synthetic({ sessionID, text, description, delivery?, resume? })`
  enqueues an inbox item. Default `resume` wakes execution. The TUI shows
  `description` (only when non-blank); the model receives `text` as a
  user-role message. Returns after admission, not after completion.
- `ctx.session.prompt({ sessionID, text })` same admission semantics, shown as a
  normal user message. `agents` mentions do not switch agent. Use
  `ctx.session.switchAgent({ sessionID, agent })` first. Subagent-mode agents
  are not supported as the primary session agent.
- `ctx.session.context({ sessionID })` returns `SessionMessageInfo[]`;
  assistant messages have `agent`, `content[]` (`text`/`reasoning`/`tool`),
  `tokens`, `finish`, `time.created`.
- `ctx.session.interrupt({ sessionID, continue: false })`.
- `ctx.event.subscribe({ signal })` is the global server feed. Filter on
  `event.data.sessionID`. Terminal run events: `session.execution.succeeded`,
  `session.execution.failed` (`data.error: {type,message,status?}`),
  `session.execution.interrupted` (`data.reason: user|shutdown|superseded`).
  Do not use `session.idle` (deprecated, no publisher).
  `session.deleted` has `data.sessionID`.
- `ctx.session.hook("context", e => e.system.push({ type: "text", text }))`.
  Runs for every model call incl. compaction. `e.agent` is the session agent.
- `ctx.permission.hook("evaluate", e => { e.effect = "allow"|"deny"; e.message })`.
  Runs for `allow` and `ask` decisions; configured `deny` is final. Actions are
  strings (`shell`, `edit`, `read`, `subagent`, `external_directory`, ...).
  A hook `deny` becomes a model-visible tool failure.
- `ctx.tool.transform(e => e.add({ name, description, input: <JSON Schema>, execute(input, context) }))`;
  return `{ content: string }`; do not return `output` without an `output`
  schema. `context.sessionID` is the caller.
- `ctx.storage.get/set/remove/scan({ prefix })` — global SQLite KV namespaced by
  plugin id only (not per project). Session IDs are globally unique.
- `ctx.location.directory` is the project directory.
- RPC: `Rpc.define({ id, methods, events })` from `@opencode-ai/plugin/rpc`;
  server registers with `ctx.rpc.register(contract, impl)` and emits with
  `registration.events.emit(name, data)`. TUI plugin (`./tui` export,
  `@opencode-ai/plugin/tui`) subscribes with
  `context.client.rpc(contract).events.on(name, cb)` and shows
  `context.ui.toast.show(...)` / `context.ui.dialog.alert(...)`.
- Packaging: default ESM export `{ id, setup }`; `./tui` export auto-loads; the
  package must declare `@opencode-ai/plugin` (`beta`) as a dependency. Config
  key is `plugins` (plural) in `opencode.json(c)`.
- v1 hooks/tools/`.opencode/commands` are not loaded by opencode2.

## Design

### Package layout (v2 only; v1 stays on `main`/0.4.x)

```
index.ts        default export: server plugin (Plugin.define)
plugin.ts       createAutopilotPlugin(ctx) — controller
rpc.ts          Autopilot RPC contract (exported as ./rpc)
tui.ts          TUI companion: toasts + status dialog (exported as ./tui)
command/parse.ts  pure parser for `/autopilot` argument text
hooks/          v2 hooks (context, permission, events)
state/, types/, prompts/, config/, tools/plan.ts, tools/planning.ts, tools/usage.ts  reused
```

Delete: `hooks/chat-message.ts`, `hooks/tool-after.ts`,
`hooks/session-compacting.ts` (fold into context hook),
`state/session-cache.ts`, file-based store in `state/persistence.ts`
(keep the normalize/serialize helpers), `scripts/install-slash-command.mjs`,
`.opencode/commands/autopilot.md`, `postinstall`.

### `/autopilot` command grammar (deterministic, tested)

```
/autopilot                       help
/autopilot help                  help
/autopilot on [flags]            ambient autonomy (no loop)
/autopilot off | stop            stop (interrupts a running worker)
/autopilot pause                 pause objective (interrupts)
/autopilot resume [flags]        resume paused/blocked objective and dispatch
/autopilot clear                 clear objective
/autopilot status                run card -> TUI dialog (and toast fallback)
/autopilot <objective> [flags]   start objective run and dispatch immediately
```

Flags (anywhere in the text, removed from the objective):
`--agent=<id>` | `--agent <id>`, `--max=<n>` | `--max <n>` | bare `max <n>`,
`--limited` | bare `limited`, `--allow-all` | bare `allow-all`,
`--duration=<15m|900s|900000ms>`, `--tokens=<100k|100000>`,
`--verify="<cmd>"`, `--done-when="<text>"`,
`--strength=<conservative|balanced|aggressive>`.
Multi-line input: first line = objective, remaining lines = `plan` text
when they look like a list (reuse `parsePlan`).

### Controller flow

1. `start`: build state (`createSessionState`), permission mode default
   `allow-all`, worker agent default = current session agent
   (`ctx.session.get`), `--agent` -> `switchAgent` (on failure: record history,
   continue with current agent). Persist. Emit `notice`. Dispatch immediately:
   `ctx.session.synthetic({ sessionID, description: "Autopilot: starting objective", text: buildObjectiveStartPrompt(...) })`.
   Mark `awaitingWorkerReply = true`, record `dispatchedAt`.
2. Event loop: on `session.execution.succeeded` for a tracked session with
   `awaitingWorkerReply`: read `ctx.session.context`, take assistant messages
   with `time.created >= dispatchedAt`; last message text -> directive
   (`inferAutopilotDirective`), output tokens -> low-progress check, sum
   tokens -> budget. Then run the same decision logic as v1 `maybeContinue`
   (plan step advance, validate, verify command, complete, blocked, continue,
   limits). Every continuation dispatches via `synthetic` with a description
   like `Autopilot continuation 2/10`.
   `session.execution.failed` -> stop `UNRECOVERABLE_ERROR`;
   `session.execution.interrupted` with reason `user` -> stop `USER_STOP`
   (unless the interrupt was issued by autopilot itself);
   `session.deleted` -> delete state.
3. Ambient `on`: no loop; only the context hook injects guidance.
4. `status`: emit RPC `card` event with `summarizeAutopilotState` + history.
5. `pause`/`off`/`clear`: set state, `interrupt` if awaiting a reply, emit
   `notice`.
6. `resume`: re-arm and dispatch a continuation immediately.
7. Startup: `storage.scan({ prefix: "state/" })`; active objective runs become
   `paused` with `RECOVERED_AFTER_RESTART` (v1 behaviour).

### Hooks

- `session.hook("context")`: when state enabled for `e.sessionID`, push one
  `{ type: "text", text }` part with `buildAutopilotSystemPrompt` + objective
  block (v1 `system-transform.ts` content) + workflow summary + last history
  lines (replaces the compaction hook).
- `permission.hook("evaluate")`: enabled + `allow-all` -> `effect = "allow"`;
  enabled + `limited` and `effect === "ask"` -> `effect = "deny"`, message,
  mark `blockedByPermission` so the next execution end stops the run with
  `PERMISSION_DENIED`.
- `tool.transform`: register `autopilot` tool with the v1 argument surface
  (JSON Schema), same actions, so the model/agents can still control runs.
  The tool and the command share one `runAction(sessionID, parsedArgs)`.

### RPC contract (`rpc.ts`)

```ts
export const AutopilotRpc = Rpc.define({
  id: "autopilot",
  methods: {
    status: { input: { sessionID }, output: { text: string, active: boolean } },
  },
  events: {
    notice: { schema: { sessionID, title, message, variant: "info"|"success"|"warning"|"error" } },
    card:   { schema: { sessionID, title, text } },
  },
})
```

### TUI companion (`tui.ts`)

`Plugin.define` from `@opencode-ai/plugin/tui`. Subscribe to `notice` ->
`ui.toast.show({ title, message, variant, duration: 3000 })`; `card` ->
`ui.dialog.alert({ title, message: text })`. Return the unsubscribe functions.
No JSX, no OpenTUI peers required.

### Persistence

`ctx.storage` keys: `state/<sessionID>` -> `{ state, history, permissionMode }`
(one JSON value per session). Remove on `clear`/`session.deleted`.

### package.json

- `version` `1.0.0-beta.1`, `dependencies`: `@opencode-ai/plugin: beta`.
- `exports`: `.` -> `dist/index.js`, `./tui` -> `dist/tui.js`, `./rpc` -> `dist/rpc.js`.
- `build`: `bun build ./index.ts ./tui.ts ./rpc.ts --outdir ./dist --target bun --external '@opencode-ai/*' --external effect --external solid-js --external '@opentui/*'`.
- Remove `postinstall`, `files` entries for `.opencode/commands` and script.

## Verification

- `bun run typecheck`, `bun run lint`, `bun test` pass.
- Unit tests: `command/parse.ts` grammar; controller decision logic with a fake
  `ctx` (command executes -> synthetic dispatched in the same call; execution
  succeeded -> continuation; complete marker -> verify -> stop; limits).
- Manual smoke (documented in README): `opencode2` with
  `"plugins": ["/abs/path/to/feat-opencode-v2"]`, run `/autopilot status`,
  `/autopilot on`, `/autopilot create hello.txt containing hi --max=2`.
