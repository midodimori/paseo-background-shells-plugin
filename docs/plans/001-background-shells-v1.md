# Plan 001: Background shells plugin (v1)

## Goal

Paseo has no view of Claude Code background shells (Bash with `run_in_background`).
Its composer "Tasks" pill is only Claude's to-do checklist (`todo.title` in
`packages/app/src/i18n/resources/en.ts`), and "Subagents" covers only subagents.

Build a Paseo plugin that shows, per agent:

- A composer pill, e.g. `Shells · 2 running`, hidden when the agent has none.
- A panel listing each background shell: command, status (running / completed /
  failed / stopped), elapsed time, exit code, and a live tail of its output.
- An "Ask to stop" button per running shell. A plugin cannot kill the shell
  itself; the button sends the agent a prompt asking it to stop task `<id>`
  (`paseo.agents.ref(agentId).send(...)`, see reference.md around line 644).

## Decisions (made with the user, 2026-10-06)

- New standalone repo: `~/personal-projects/paseo-background-shells-plugin`
  (not folded into `midodimori/paseo-tool-ui-plugin`).
- v1 scope: pill + panel + "Ask to stop" button.
- Claude Code provider only for v1.

## Findings so far

Measured from a Claude agent running inside Paseo (agent `c38d3b6`), and from
Paseo source cloned at `getpaseo/paseo@2974d7c` (2026-10-06) into `/tmp/paseo-src`
(re-clone if gone).

### Environment

- Paseo CLI 0.10.3, **daemon 0.9.1** (desktop-managed, `~/.paseo`, 127.0.0.1:6767).
  The mismatch matters: some plugin APIs in current docs may not exist on 0.9.1.
  (Resolved: the plugin SDK is identical on 0.9.0 to 0.10.3; see "Measurements".)
- `pluginsEnabled: true` in `~/.paseo/config.json`. Do not ask to enable it again.
- Installed plugin: `paseo-tool-ui-plugin` (running), the user's own; use it as a
  style reference for repo layout, README, and tests.
- Do not restart the daemon; it can kill the agent doing the work. Use
  `paseo plugin reload <id>`.

### Start of a background shell

- Appears as a normal `tool_call` timeline item with shell detail
  (`packages/protocol/src/messages.ts` ~line 533):
  `{ type: "shell", command, cwd?, output?, exitCode? }`.
- `run_in_background` is **not** carried in the detail. The only signal is the
  tool output text, observed verbatim:
  `Command running in background with ID: b211ru1u9. Output is being written to: /private/tmp/claude-501/-Users-me/<session-id>/tasks/b211ru1u9.output. You will be notified when it completes. ...`
  Parse task ID and output path from this. This wording is a Claude Code string
  and may change; keep the parser in one place with a test fixture.
- ~~Claude Code also auto-backgrounds foreground commands that hit their timeout,
  and the user can press Ctrl+B.~~ Measured: neither applies inside Paseo (see
  "Measurements" below). Explicit `run_in_background` is the only start path.

### End of a background shell

- Paseo maps Claude's `<task-notification>` into a synthetic `tool_call`
  (`packages/server/src/server/agent/providers/claude/task-notification-tool-call.ts`):
  `name: "task_notification"`, `status: completed | failed | canceled`,
  `metadata: { synthetic: true, source: "claude_task_notification", taskId,
  toolUseId, status, outputFile }`, `detail.label` = summary.
- Observed notification for the probe:
  `task-id b211ru1u9`, `tool-use-id toolu_014LSN8aFmvqq8FJpP6N95BA`,
  `status completed`, summary `Background command "..." completed (exit code 0)`.
  Exit code is only in the summary text; parse it.
- `taskId` joins start and end. Background subagents and Monitor tasks also emit
  task notifications; filter to tasks whose start was a shell tool call.

### Output files

- `/private/tmp/claude-501/<cwd-slug>/<session-id>/tasks/<task-id>.output`.
  Readable from the daemon side. Restrict reads to paths under the
  `claude-<uid>` tmp root and to `*.output`; return only the last N KB.
- Background tasks die when the Claude Code session exits. A shell with a start
  but no notification after the agent closes should show as "ended (unknown)",
  not "running" forever.

### Plugin APIs to use (verify against deployed docs; they win over the skill)

- Server: subscribe to agent timelines through the handler `paseo` SDK
  (reference.md ~line 2130, SDK event contract `sdk/events.md`), or lifecycle
  `server.on` events (`agent.turn_ended` carries a full `timeline`, line ~714).
  The server builds per-agent shell state and serves it over RPC.
- Client: composer pill. **The docs' `addComposerPill` takes a `button`
  descriptor (reference.md ~line 1800), while the paseo-plugin skill shows a
  `Component` prop.** Resolved: the `button` descriptor is correct on 0.9.1
  through 0.10.3 (see "Measurements"); the skill example is out of date.
- Client: workspace panel (or agent-scoped panel) for the list, using React
  Native primitives and `theme.colors` only. Must work on mobile.

## First task for the new session: measure and report, no code yet

1. Fetch https://paseo.sh/llms.txt and the plugin pages; note which APIs above
   exist in daemon 0.9.1 vs the 0.10 client. Report whether the daemon should be
   updated first (ask the user; don't update it yourself).
2. Start a background shell in a test Claude agent and capture the raw
   timeline items (start + `task_notification`) as JSON fixtures. `paseo logs`
   only prints summaries; get raw items through the SDK or a throwaway
   `server.on` logger plugin (see `plugin-examples/lifecycle-logger`).
3. Check the auto-backgrounded (timeout) and Ctrl+B cases produce the same
   start text.
4. Confirm whether a server plugin can see live timeline updates for running
   agents, or only `turn_ended` snapshots. This decides whether "running" shows
   up immediately.
5. Report findings and a proposed file layout, then wait for go-ahead.

Status: done 2026-10-06, results below. Waiting for go-ahead.

## Measurements (2026-10-06)

Method: deployed docs fetched from paseo.sh (llms.txt, plugins, reference,
publishing, sdk, sdk/events, sdk/reference). Source compared at tags `v0.9.0`,
`v0.9.1`, `v0.10.3`, `v0.11.0-beta.5` in `/tmp/paseo-src`. Raw items captured
with `@getpaseo/client@0.9.1` from a throwaway script in `/tmp/bgshells-probe`
(`watch.mjs` live subscriber, `fetch.mjs` history refetch; raw dumps
`live.ndjson`, `probe-history.json`; /tmp, so ephemeral). Test agent
`1561de0d` (Claude Code 2.1.284, Sonnet 5, bypass mode), archived after the run.
No plugin was installed and the daemon was not touched.

### 1. Versions and APIs: no daemon update needed

- Running: daemon **0.9.1** (started 2026-09-22), desktop app and CLI **0.10.3**.
  The app was updated after the daemon started; restarting the desktop daemon
  would bring it to 0.10.3, but it is not required for this plugin.
- `packages/plugin/src` is **byte-identical from v0.9.0 to v0.10.3**. Every API
  this plugin needs exists on both the 0.9.1 daemon and the 0.10.3 app.
  0.11 betas only add (`registerUsageSource`, usage sources). The Claude
  task-notification mapper did not change between 0.9.1 and 0.10.3 either.
- Set `requirements.paseo` to `">=0.9.0"`. `paseo plugin init` would write
  `>=0.10.3` (CLI version), which the 0.9.1 daemon rejects. ~~Pin the
  `@getpaseo/plugin` dev dependency to `0.9.1`.~~ Superseded by the user: no
  pins, see "Build results".
- `addComposerPill({ id, workspaceId, agentId, button })` returns
  `{ update, remove }`; `button` = `{ title, icon, label?, visible?, disabled?,
  behavior }`. `icon` may be a component (`PluginButtonIconProps`) for a
  custom indicator. Use `update({ label, visible })` to publish counts.
  `visible: false` hides the pill and keeps its slot.
- Agent panel: `addWorkspacePanel({ context: "agent", Component })` gets
  `{ workspaceId, agentId, theme, layout }`; open with
  `client.openPanel(id, { workspaceId, agentId })` from the pill's action.
- Client context has `paseo` and `rpc` at setup time (`PluginCommandCapabilities`).
- **Server `contribute(server)` gets no `paseo`.** It is only passed to
  `server.handle` handlers (`{ paseo }`) and `server.on` / `server.before`
  callbacks (`{ paseo, signal }`). The subprocess creates exactly one
  `PaseoApi` (`plugin-process.ts:267`, `createPaseoApi(daemonClient)` over an
  IPC `DaemonClient`) and passes that same instance everywhere, so the server can
  keep a reference from the first RPC or hook call and reuse it for long-lived
  subscriptions.
- There is no server-to-client push channel for plugin data other than
  `timeline.append`. The client polls RPCs (TanStack Query `refetchInterval`).

### 2. Raw items (fixtures in the appendix)

Start, live and history forms are the same:

- Bash `tool_call` first arrives as `detail: { type: "unknown", input: {} }`,
  then `detail: { type: "shell", command }` while `running`, then `completed`
  with `detail.output` = start text. `run_in_background` and the Bash
  `description` are **not** in the item; the only background signal is the text:
  `Command running in background with ID: <taskId>. Output is being written to: <path>. You will be notified when it completes. To check interim output, use Read on that file path.`
- `shell.exitCode` is never set for background starts.

End notifications differ between the live stream and rebuilt history:

| Case | Live (`timeline.subscribe`) | History after archive (`refetch`) |
| --- | --- | --- |
| Exit 0 | `metadata.status: "completed"`, summary `Background command "<desc>" completed (exit code 0)` | Same, but **two copies** (callIds `task_notification_<taskId>` and `task_notification_<uuid>`) |
| Exit ≠ 0 | `status/metadata.status: "failed"`, summary `... failed with exit code 3` | Same, two copies |
| TaskStop | `metadata.status: "stopped"`, **`item.status: "completed"`**, label is just `<desc>` | **Missing** |
| Agent archived | **Nothing** | `metadata.status: "killed"`, `item.status: "completed"`, summary `Background command "<desc>" was stopped` |
| Foreground Bash | Also a `task_notification` with its own taskId, label = command, **no `outputFile`** | Missing |

- Paseo maps only `canceled/cancelled` to `item.status: "canceled"`; `stopped`
  and `killed` become `completed`. **Use `metadata.status`, never `item.status`.**
- Live notification `detail.text` = summary; history `detail.text` = the raw
  `<task-notification>` XML. Use `metadata` + `detail.label`.
- Join on `metadata.toolUseId === start.callId` and `metadata.taskId === parsed
  taskId`. Dedupe by taskId. Ignore notifications for taskIds without a
  background start (foreground Bash, and per plan, subagents and Monitor).
- An idle agent that receives a notification starts a new turn
  (`turn_started` → notification item → assistant reply).
- `TaskStop` tool call: `detail.type: "unknown"`, `input: { task_id }`,
  `output.output: { message: "Successfully stopped task: <id> (<cmd>)", task_id,
  task_type: "local_bash", command }`. This is the only stop signal that
  survives into history, so treat it as a status source too.

### 3. Timeout and Ctrl+B cases

- Foreground Bash with `timeout: 4000`: killed at 4 s, `item.status: "failed"`,
  `error.content: "Exit code 143\nCommand timed out after 4s"`. Not
  auto-backgrounded.
- **Correction (found during the build):** a foreground Bash with `timeout:
  90000` that outlived it *was* moved to the background, with different start
  text: `Command did not complete within its 90s timeout and was moved to the
  background (ID: <taskId>). Output is being written to: <path>. ...` It then
  ends with a normal `task_notification`. Why 4 s was killed and 90 s was
  backgrounded is not known (a minimum timeout is likely). The parser handles both
  texts; fixture `tests/fixtures/timeout-backgrounded-entries.json`.
- Ctrl+B: Paseo drives Claude Code through the SDK, not a TUI. In the Paseo app,
  Ctrl+B toggles the left sidebar (`keyboard-shortcuts.ts:917`). There is no way
  to background a running command, so this case does not exist.

### 4. Live visibility: yes, immediately

- A `timeline.subscribe` observer received the background start ~1 s after the
  model emitted the call, and each notification as it happened, including while
  the agent was idle. The plugin's server `paseo` is the same SDK over an IPC
  transport (`clientType: "cli"`), so a server-side tracker gets the same
  stream. `agent.turn_ended` snapshots are not needed.
- Event envelope: `{ agentId, subscriptionId, timestamp, seq, epoch, event }`,
  `event.type` ∈ `timeline | turn_started | turn_completed | ... |
  replacement | subscription_restored | error`. On `replacement` or
  `subscription_restored`, refetch history and rebuild that agent's state.

### Output files

- Path `/private/tmp/claude-501/<cwd-slug>/<session-id>/tasks/<taskId>.output`
  (macOS `/tmp` → `/private/tmp`; uid 501 is the daemon user). Only background
  tasks get a file. The file persists after the task ends.
- Claude Code appends a footer when the task ends: `\n[exited with code N]\n`,
  or `\n[killed]\n` (TaskStop and agent archive). This is a third end signal
  and an exit-code source that works even when no notification exists.
- Archiving the agent killed the running shell within seconds (process gone,
  footer `[killed]`).

## Proposed design

Server owns the state; client polls.

- **Tracker (server).** Keep the `paseo` from the first RPC or hook. Then list
  non-archived Claude agents with an owned directory subscription. For each one,
  page history with `timeline.refetch` and subscribe live, and drop it on
  archive/close. Feed every `tool_call` item through one pure reducer keyed by
  taskId. Hooks `agent.created` / `agent.turn_started` also start the tracker, so
  tracking begins without an app connected.
- **Status precedence:** notification `metadata.status`
  (`completed`/`failed`/`stopped`/`killed`) → successful `TaskStop` for the
  taskId (`stopped`) → output footer (`[exited with code N]` → completed/failed,
  `[killed]` → stopped) → agent closed or archived with none of these → `ended
  (unknown)` → `running`.
- **Exit code:** `exit code (\d+)` in the summary, else the footer.
- **Description:** `Background command "(.*)"` from the summary when it exists.
  Before that, show the command.
- **Output tail:** `shells.tail({ agentId, taskId, maxBytes })` reads only the
  path recorded for that task. The path's `realpath` must be under
  `realpath("/tmp")/claude-${process.getuid()}/`, contain `/tasks/`, and end
  in `.output`. It returns the last N KB plus the footer status. It never takes
  a path from the client.
- **Client.** One owned agent-directory subscription. For each Claude agent with
  a `workspaceId`, register a pill (`visible: false` until it has shells) and
  update its label `Shells · N running` from a polled `shells.summary` (~2 s
  while any are running, slower otherwise). The pill action opens an agent-
  context panel that polls `shells.list` and the selected shell's `shells.tail`.
- **Ask to stop:** `paseo.agents.ref(agentId).send("Use TaskStop to stop
  background task <id> (<desc or command>). Reply briefly.")`. Shown only for
  `running` shells. Measured in the build: `send` while the agent is mid-turn
  **interrupts** it (see "Build results").

## Proposed file layout

```text
paseo-plugin.json        id "paseo-background-shells", requirements.paseo ">=0.9.0"
package.json             devDeps: @getpaseo/plugin >=0.9.0, zod, typescript; scripts typecheck/test
tsconfig.json
README.md
index.server.ts          handle shells.summary/list/tail; on(agent.created|turn_started) → tracker.start(paseo)
index.client.tsx         pills per agent + agent panel registration; cleanup
shared/
  contracts.ts           defineRpc: shells.summary, shells.list, shells.tail (Zod in/out)
  shell.ts               ShellStatus, ShellTask, ShellSummary types/schemas (plain values)
server/
  parse.ts               parseBackgroundStart, parseNotification, parseTaskStop,
                         parseOutputFooter (pure; all Claude Code strings live here)
  reduce.ts              applyTimelineItem(state, item) → per-agent Map<taskId, ShellTask>
                         (dedupe, ignore foreground/subagent/monitor, status precedence)
  tracker.ts             paseo capture, directory + timeline subscriptions, refetch on
                         replacement/restore, closed/archived → ended(unknown)
  output-tail.ts         realpath root check, last-N-KB read, footer parse
client/
  pills.ts               directory observation → addComposerPill per agent, poll summary
  shells-panel.tsx       list (status, elapsed, exit code), tail view, Ask to stop
  format.ts              elapsed time, status label/colour from theme.colors
tests/
  fixtures/              the JSON items from the appendix, one file per case
  parse.test.ts          every fixture through the parsers
  reduce.test.ts         live sequence, history sequence (duplicates, killed,
                         missing stopped), foreground notification ignored
  output-tail.test.ts    root restriction (symlink, ../, wrong suffix), tail size, footer
```

Tests run with `node --test` (Node 26.5 strips TypeScript types natively, so no
test framework dependency). Relative imports then need `.ts` extensions and
`allowImportingTsExtensions` in tsconfig; confirm the Paseo bundler accepts that
during build step 1, else add `tsx` as a dev dependency.

## Build results (2026-10-06)

Built, installed on the 0.9.1 daemon (`paseo plugin ls`: `running`), and
exercised in the Paseo web app (app.paseo.sh, connected to the local daemon)
at desktop width, at 390 px, and in the Dark theme.

- **No version pins (user decision).** `requirements.paseo` is `">=0.9.0"` with
  no upper bound, and `@getpaseo/plugin` is a `">=0.9.0"` dev dependency (it is
  only for typechecking; the host supplies runtime modules). Caret ranges were
  avoided because `^0.9.x` locks the minor version. npm currently resolves
  0.10.3; the code also typechecks against `@getpaseo/plugin@0.9.1` in a scratch
  copy. Use only APIs that exist in 0.9.x.
- **0.9.1 has no `agent.closed` hook** (the current docs list one). Closed
  sessions are detected from the directory snapshot `status: "closed"`.
- **`send()` mid-turn interrupts.** Measured on test agent `7090b4a6`: the
  running turn ends with `turn_canceled` (`reason: "Interrupted"`), its in-flight
  foreground tool call is canceled (and emits a foreground `task_notification`,
  which the reducer ignores), and a new turn starts with the prompt. Background
  shells survive the interrupt. `PaseoAgentSendOptions` in 0.9.1 has no queue
  option (the app's Cmd/Ctrl+Enter queue is app-side). An idle agent starts a
  new turn immediately.
- **Ask to stop behavior:** idle (or errored) agent → **Ask to stop** sends at
  once. Running agent → **Interrupt to stop** in the danger color; the first
  press arms **Interrupt agent and stop?** for 4 s, the second sends. Closed
  session → no button. After sending: **Stop requested** until the status
  changes. Both paths stopped the shell within about 2 to 12 s in testing.
- **Node type stripping** rejects TypeScript parameter properties.
  `erasableSyntaxOnly` is on in tsconfig so typecheck catches it.
- **Panel order:** running shells first, then newest first. The running dot is
  hollow, because accent and success are both green in the default theme.
- Paseo's esbuild bundler accepts `.ts` import extensions, so no `tsx` dependency.

## Build order (after go-ahead)

1. `paseo plugin init` into this repo; set `requirements.paseo` to `">=0.9.0"`
   (init writes `>=0.10.3`, which the 0.9.1 daemon rejects). ~~Pin
   `@getpaseo/plugin` to `0.9.1`.~~ Open `>=0.9.0` range instead.
2. `shared/`: Zod contracts (`shells.list`, `shells.tail`), shell-state types,
   and the start/end text parsers with fixture tests.
3. `server/`: timeline tracking, output tail with path restriction.
4. `client/`: pill, panel, "Ask to stop" button.
5. Typecheck, install, `paseo plugin ls` shows `running`, exercise on desktop
   and compact width and in a dark theme.

## Testing

Run only tests for new or changed behavior while iterating; after a fix, rerun
the failing test. Run the full suite once before pushing. Don't run tests from
two sessions at once.

## Appendix: raw fixtures (captured 2026-10-06)

Verbatim JSON from test agent `1561de0d`, except that home paths and Claude session IDs
are anonymized (`/Users/me/...`, `11111111-...`) before publishing.
Live events are `update.event`; the envelope adds `agentId`, `subscriptionId`,
`timestamp`, `seq`, `epoch`. History entries are `page.entries[n]`. Copy these into
`tests/fixtures/` in build step 2.

Output file contents at the end of the run:

```text
brag50qof.output  tick 1 … tick 8\n\n[exited with code 0]\n
b83d7jga2.output  failing\n\n[exited with code 3]\n
b9h7mtnuu.output  stop-tick 1 … stop-tick 6\n\n[killed]\n      (TaskStop)
bxq7gqucc.output  orphan-tick 1 … orphan-tick 12\n\n[killed]\n  (agent archived)
```

### Live subscription events (`agent.timeline.subscribe`, `update.event`)

`live-bash-placeholder`: First event for any Bash call: detail not parsed yet.

```json
{
  "type": "timeline",
  "provider": "claude",
  "item": {
    "type": "tool_call",
    "callId": "toolu_018mrHgE4rALtXGmrZcj3XDC",
    "name": "Bash",
    "detail": {
      "type": "unknown",
      "input": {},
      "output": null
    },
    "status": "running",
    "error": null
  },
  "turnId": "foreground-turn-2"
}
```

`live-bash-running`: Command known, still running (before the background start text).

```json
{
  "type": "timeline",
  "provider": "claude",
  "item": {
    "type": "tool_call",
    "callId": "toolu_018mrHgE4rALtXGmrZcj3XDC",
    "name": "Bash",
    "detail": {
      "type": "shell",
      "command": "for i in 1 2 3 4 5 6 7 8; do echo tick $i; sleep 3; done"
    },
    "status": "running",
    "error": null
  },
  "turnId": "foreground-turn-2"
}
```

`live-bash-background-start`: Background start: tool call completes with the start text.

```json
{
  "type": "timeline",
  "provider": "claude",
  "item": {
    "type": "tool_call",
    "callId": "toolu_018mrHgE4rALtXGmrZcj3XDC",
    "name": "Bash",
    "detail": {
      "type": "shell",
      "command": "for i in 1 2 3 4 5 6 7 8; do echo tick $i; sleep 3; done",
      "output": "Command running in background with ID: brag50qof. Output is being written to: /private/tmp/claude-501/-Users-me-dev-project/11111111-1111-4111-8111-111111111111/tasks/brag50qof.output. You will be notified when it completes. To check interim output, use Read on that file path."
    },
    "status": "completed",
    "error": null
  },
  "turnId": "foreground-turn-2"
}
```

`live-notification-completed`

```json
{
  "type": "timeline",
  "provider": "claude",
  "item": {
    "type": "tool_call",
    "callId": "task_notification_b5199799-4615-4b03-a399-3a3e3cd84d02",
    "name": "task_notification",
    "detail": {
      "type": "plain_text",
      "label": "Background command \"tick probe\" completed (exit code 0)",
      "text": "Background command \"tick probe\" completed (exit code 0)",
      "icon": "wrench"
    },
    "metadata": {
      "synthetic": true,
      "source": "claude_task_notification",
      "taskId": "brag50qof",
      "toolUseId": "toolu_018mrHgE4rALtXGmrZcj3XDC",
      "status": "completed",
      "outputFile": "/private/tmp/claude-501/-Users-me-dev-project/11111111-1111-4111-8111-111111111111/tasks/brag50qof.output"
    },
    "status": "completed",
    "error": null
  },
  "turnId": "autonomous-turn-4"
}
```

`live-notification-failed`

```json
{
  "type": "timeline",
  "provider": "claude",
  "item": {
    "type": "tool_call",
    "callId": "task_notification_b6fa7ad0-cf68-4890-8c72-74f259c2fc0f",
    "name": "task_notification",
    "detail": {
      "type": "plain_text",
      "label": "Background command \"fail probe\" failed with exit code 3",
      "text": "Background command \"fail probe\" failed with exit code 3",
      "icon": "wrench"
    },
    "metadata": {
      "synthetic": true,
      "source": "claude_task_notification",
      "taskId": "b83d7jga2",
      "toolUseId": "toolu_01CTFMYgH9FwUk242dabzpiP",
      "status": "failed",
      "outputFile": "/private/tmp/claude-501/-Users-me-dev-project/11111111-1111-4111-8111-111111111111/tasks/b83d7jga2.output"
    },
    "status": "failed",
    "error": {
      "message": "Background command \"fail probe\" failed with exit code 3"
    }
  },
  "turnId": "foreground-turn-2"
}
```

`live-notification-stopped`: After TaskStop. item.status is completed; metadata.status is stopped; label is the description only.

```json
{
  "type": "timeline",
  "provider": "claude",
  "item": {
    "type": "tool_call",
    "callId": "task_notification_67feb5eb-e222-4f11-9e8d-70d6f8c38ab8",
    "name": "task_notification",
    "detail": {
      "type": "plain_text",
      "label": "stop probe",
      "text": "stop probe",
      "icon": "wrench"
    },
    "metadata": {
      "synthetic": true,
      "source": "claude_task_notification",
      "taskId": "b9h7mtnuu",
      "toolUseId": "toolu_01EDkMgdjwdo3LxzqjDQ8Srp",
      "status": "stopped",
      "outputFile": "/private/tmp/claude-501/-Users-me-dev-project/11111111-1111-4111-8111-111111111111/tasks/b9h7mtnuu.output"
    },
    "status": "completed",
    "error": null
  },
  "turnId": "foreground-turn-5"
}
```

`live-taskstop`: TaskStop tool call (completed).

```json
{
  "type": "timeline",
  "provider": "claude",
  "item": {
    "type": "tool_call",
    "callId": "toolu_01NWmfpa1yjPrAd8LP43TfZW",
    "name": "TaskStop",
    "detail": {
      "type": "unknown",
      "input": {
        "task_id": "b9h7mtnuu"
      },
      "output": {
        "output": {
          "message": "Successfully stopped task: b9h7mtnuu (for i in $(seq 1 60); do echo stop-tick $i; sleep 2; done)",
          "task_id": "b9h7mtnuu",
          "task_type": "local_bash",
          "command": "for i in $(seq 1 60); do echo stop-tick $i; sleep 2; done"
        }
      }
    },
    "status": "completed",
    "error": null
  },
  "turnId": "foreground-turn-5"
}
```

`live-notification-foreground`: Foreground `sleep 5` also emits a notification: no outputFile, label = command. Must be ignored.

```json
{
  "type": "timeline",
  "provider": "claude",
  "item": {
    "type": "tool_call",
    "callId": "task_notification_d1e40eb3-5114-42ea-bb66-3a76910f2ab9",
    "name": "task_notification",
    "detail": {
      "type": "plain_text",
      "label": "sleep 5",
      "text": "sleep 5",
      "icon": "wrench"
    },
    "metadata": {
      "synthetic": true,
      "source": "claude_task_notification",
      "taskId": "b5pcm51bh",
      "toolUseId": "toolu_015ogMQEe48FJhRKnGazTkNy",
      "status": "completed"
    },
    "status": "completed",
    "error": null
  },
  "turnId": "foreground-turn-5"
}
```

`live-bash-foreground-timeout`: Foreground Bash with timeout 4000: killed, not auto-backgrounded.

```json
{
  "type": "timeline",
  "provider": "claude",
  "item": {
    "type": "tool_call",
    "callId": "toolu_01D7udFGX3wg5h1RZ4QkRzGV",
    "name": "Bash",
    "detail": {
      "type": "shell",
      "command": "sleep 20; echo timeout-probe-done"
    },
    "status": "failed",
    "error": {
      "type": "tool_result",
      "content": "Exit code 143\nCommand timed out after 4s",
      "is_error": true,
      "tool_use_id": "toolu_01D7udFGX3wg5h1RZ4QkRzGV"
    }
  },
  "turnId": "foreground-turn-5"
}
```

`live-notification-foreground-timeout`

```json
{
  "type": "timeline",
  "provider": "claude",
  "item": {
    "type": "tool_call",
    "callId": "task_notification_c1771907-48ba-462f-937b-571e65de9a54",
    "name": "task_notification",
    "detail": {
      "type": "plain_text",
      "label": "timeout probe",
      "text": "timeout probe",
      "icon": "wrench"
    },
    "metadata": {
      "synthetic": true,
      "source": "claude_task_notification",
      "taskId": "bbzynevtv",
      "toolUseId": "toolu_01D7udFGX3wg5h1RZ4QkRzGV",
      "status": "failed"
    },
    "status": "failed",
    "error": {
      "message": "timeout probe"
    }
  },
  "turnId": "foreground-turn-5"
}
```

### History entries (`agent.timeline.refetch`, after archive)

`history-bash-background-start`

```json
{
  "provider": "claude",
  "item": {
    "type": "tool_call",
    "callId": "toolu_018mrHgE4rALtXGmrZcj3XDC",
    "name": "Bash",
    "detail": {
      "type": "shell",
      "command": "for i in 1 2 3 4 5 6 7 8; do echo tick $i; sleep 3; done",
      "output": "Command running in background with ID: brag50qof. Output is being written to: /private/tmp/claude-501/-Users-me-dev-project/11111111-1111-4111-8111-111111111111/tasks/brag50qof.output. You will be notified when it completes. To check interim output, use Read on that file path."
    },
    "status": "completed",
    "error": null
  },
  "timestamp": "2026-10-06T10:31:20.774Z",
  "seqStart": 4,
  "seqEnd": 5,
  "sourceSeqRanges": [
    {
      "startSeq": 4,
      "endSeq": 5
    }
  ],
  "collapsed": [
    "tool_lifecycle"
  ]
}
```

`history-notification-failed`: Transcript form: callId task_notification_<taskId>, detail.text is the raw XML. A second copy with a uuid callId follows (seq 10).

```json
{
  "provider": "claude",
  "item": {
    "type": "tool_call",
    "callId": "task_notification_b83d7jga2",
    "name": "task_notification",
    "detail": {
      "type": "plain_text",
      "label": "Background command \"fail probe\" failed with exit code 3",
      "icon": "wrench",
      "text": "<task-notification>\n<task-id>b83d7jga2</task-id>\n<tool-use-id>toolu_01CTFMYgH9FwUk242dabzpiP</tool-use-id>\n<output-file>/private/tmp/claude-501/-Users-me-dev-project/11111111-1111-4111-8111-111111111111/tasks/b83d7jga2.output</output-file>\n<status>failed</status>\n<summary>Background command \"fail probe\" failed with exit code 3</summary>\n</task-notification>"
    },
    "metadata": {
      "synthetic": true,
      "source": "claude_task_notification",
      "taskId": "b83d7jga2",
      "toolUseId": "toolu_01CTFMYgH9FwUk242dabzpiP",
      "status": "failed",
      "outputFile": "/private/tmp/claude-501/-Users-me-dev-project/11111111-1111-4111-8111-111111111111/tasks/b83d7jga2.output"
    },
    "status": "failed",
    "error": {
      "message": "Background command \"fail probe\" failed with exit code 3"
    }
  },
  "timestamp": "2026-10-06T10:31:25.090Z",
  "seqStart": 8,
  "seqEnd": 8,
  "sourceSeqRanges": [
    {
      "startSeq": 8,
      "endSeq": 8
    }
  ],
  "collapsed": []
}
```

`history-notification-failed-duplicate`

```json
{
  "provider": "claude",
  "item": {
    "type": "tool_call",
    "callId": "task_notification_4aa4ed47-7077-4475-a73a-bc70b264e42d",
    "name": "task_notification",
    "detail": {
      "type": "plain_text",
      "label": "Background command \"fail probe\" failed with exit code 3",
      "icon": "wrench",
      "text": "<task-notification>\n<task-id>b83d7jga2</task-id>\n<tool-use-id>toolu_01CTFMYgH9FwUk242dabzpiP</tool-use-id>\n<output-file>/private/tmp/claude-501/-Users-me-dev-project/11111111-1111-4111-8111-111111111111/tasks/b83d7jga2.output</output-file>\n<status>failed</status>\n<summary>Background command \"fail probe\" failed with exit code 3</summary>\n</task-notification>"
    },
    "metadata": {
      "synthetic": true,
      "source": "claude_task_notification",
      "taskId": "b83d7jga2",
      "toolUseId": "toolu_01CTFMYgH9FwUk242dabzpiP",
      "status": "failed",
      "outputFile": "/private/tmp/claude-501/-Users-me-dev-project/11111111-1111-4111-8111-111111111111/tasks/b83d7jga2.output"
    },
    "status": "failed",
    "error": {
      "message": "Background command \"fail probe\" failed with exit code 3"
    }
  },
  "timestamp": "2026-10-06T10:31:28.161Z",
  "seqStart": 10,
  "seqEnd": 10,
  "sourceSeqRanges": [
    {
      "startSeq": 10,
      "endSeq": 10
    }
  ],
  "collapsed": []
}
```

`history-notification-killed-on-archive`: Written by Claude Code when the agent was archived; never delivered live. status killed, item.status completed.

```json
{
  "provider": "claude",
  "item": {
    "type": "tool_call",
    "callId": "task_notification_bxq7gqucc",
    "name": "task_notification",
    "detail": {
      "type": "plain_text",
      "label": "Background command \"orphan probe\" was stopped",
      "icon": "wrench",
      "text": "<task-notification>\n<task-id>bxq7gqucc</task-id>\n<tool-use-id>toolu_01EG3vp9gBDkQewRmA3gC4eR</tool-use-id>\n<output-file>/private/tmp/claude-501/-Users-me-dev-project/11111111-1111-4111-8111-111111111111/tasks/bxq7gqucc.output</output-file>\n<status>killed</status>\n<summary>Background command \"orphan probe\" was stopped</summary>\n</task-notification>"
    },
    "metadata": {
      "synthetic": true,
      "source": "claude_task_notification",
      "taskId": "bxq7gqucc",
      "toolUseId": "toolu_01EG3vp9gBDkQewRmA3gC4eR",
      "status": "killed",
      "outputFile": "/private/tmp/claude-501/-Users-me-dev-project/11111111-1111-4111-8111-111111111111/tasks/bxq7gqucc.output"
    },
    "status": "completed",
    "error": null
  },
  "timestamp": "2026-10-06T10:33:16.597Z",
  "seqStart": 31,
  "seqEnd": 31,
  "sourceSeqRanges": [
    {
      "startSeq": 31,
      "endSeq": 31
    }
  ],
  "collapsed": []
}
```

