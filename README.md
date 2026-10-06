# paseo-background-shells-plugin

Shows each Claude Code agent's **background shells** in Paseo: commands started
with `run_in_background`, and foreground commands that Claude Code moved to the
background after their timeout.

A **Shells** pill appears in the agent's composer, next to Tasks and Subagents,
once the agent starts a background shell. It opens a panel listing each shell
with its status (running, completed, failed, stopped, or ended), elapsed time,
exit code, and a live tail of its output.

Background shells outlive the agent's turn. When an agent is idle with shells
still running, the pill reads `1 running · idle` with its icon in the warning
color, and the panel shows a note. The shells stop when the agent is
archived.

**Ask to stop** asks the agent to stop a running shell with its TaskStop tool;
the plugin cannot kill the shell itself. If the agent is busy, sending interrupts
its current turn, so the button reads **Interrupt to stop** and needs a second
press to confirm.

Output is read only from the task's own output file under `/tmp/claude-<uid>`.

## Install

Requires Paseo with plugin support on both the daemon and client.

Install directly from GitHub:

```sh
paseo plugin add https://github.com/midodimori/paseo-background-shells-plugin.git
```

Paseo downloads and manages its own copy on the daemon host. No manual clone is needed.

To disable the plugin:

```sh
paseo plugin disable paseo-background-shells
```

To enable it again:

```sh
paseo plugin enable paseo-background-shells
```

## Compatibility

- Supports Claude Code agents only.
- Requires Paseo 0.9.0 or later.
- Recognizes shells by Claude Code's exact "Command running in background" and
  "did not complete within its timeout" wording, so a Claude Code change may
  require an update.

## Develop

For development, clone the repository and run from its root directory:

```sh
npm ci
npm run typecheck
npm test
paseo plugin add "$PWD"
paseo plugin reload paseo-background-shells
```

Reload after editing an installed local copy. The tests replay timeline items
captured from Paseo and cover parsing, live and history timelines, the output
file restriction, and the panel's labels. They use Node's built-in test runner
(Node 22.18 or later).

## License

[MIT](LICENSE)
