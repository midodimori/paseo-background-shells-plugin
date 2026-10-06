# paseo-background-shells

Shows each Claude Code agent's **background shells** in Paseo: commands started
with `run_in_background`, and foreground commands Claude Code moved to the
background after their timeout.

- A composer pill, `Shells · 2 running`, appears next to Tasks and Subagents once
  an agent has started a background shell.
- The pill opens a panel listing the agent's shells with status (running,
  completed, failed, stopped, ended), elapsed time, exit code, and a live tail of
  the selected shell's output.
- **Ask to stop** sends the agent a prompt to stop that task with its TaskStop
  tool. A plugin cannot kill the shell itself.

## Install

Requires Paseo 0.9 or later on the daemon and the app, with plugins enabled.

```sh
paseo plugin install /absolute/path/to/paseo-background-shells-plugin
paseo plugin ls
```

## How it works

The daemon side follows every non-archived Claude agent's timeline. A background
shell starts with a Bash tool call whose result reads `Command running in
background with ID: …`, or `Command did not complete within its Ns timeout and
was moved to the background (ID: …)`. It ends with Paseo's `task_notification`
item, a TaskStop call, or the `[exited with code N]` / `[killed]` footer Claude
Code appends to the output file. A shell with none of these after the agent's
session closed shows as **ended (unknown)**.

Output is read only from the file recorded for that task, and only when it
resolves to a `tasks/*.output` file under `/tmp/claude-<uid>`. The panel shows
the last 16 KB.

## Limits

- Claude Code agents only.
- Asking a busy agent to stop interrupts its current turn, because Paseo has no
  way to queue a prompt from a plugin. The button reads **Interrupt to stop** and
  needs a second press to confirm.
- The plugin recognizes Claude Code's own wording. If a Claude Code update
  changes it, shells stop appearing until `server/parse.ts` is updated.
- Archiving an agent kills its background shells. They drop out of the list with
  the agent.

## Develop

```sh
npm ci
npm run typecheck
npm test
paseo plugin install "$PWD"
paseo plugin reload paseo-background-shells
paseo plugin logs paseo-background-shells
```

Tests run with Node's built-in runner and type stripping (Node 22.18 or later).
Fixtures in `tests/fixtures` are raw timeline items captured from Paseo 0.9.1
with Claude Code 2.1.284.
