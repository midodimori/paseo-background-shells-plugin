import assert from "node:assert/strict";
import { test } from "node:test";
import { formatElapsed, pillLabel, shellDetail, shellElapsed, stopPrompt } from "../client/format.ts";
import type { ShellTask } from "../shared/shell.ts";

const shell: ShellTask = {
  taskId: "b636to6ne",
  toolUseId: "toolu_018jZt9JxRcF4PAzJRG1Jach",
  command: "for i in $(seq 1 600); do echo long-tick $i; sleep 1; done",
  description: null,
  status: "running",
  exitCode: null,
  startedAt: "2026-10-06T15:59:38.455Z",
  endedAt: null,
};

test("pill label counts running shells, else all shells", () => {
  assert.equal(pillLabel({ running: 2, total: 3 }), "Shells · 2 running");
  assert.equal(pillLabel({ running: 0, total: 3 }), "Shells · 3");
});

test("formats elapsed time", () => {
  assert.equal(formatElapsed(-5), "0s");
  assert.equal(formatElapsed(8_900), "8s");
  assert.equal(formatElapsed(65_000), "1m 05s");
  assert.equal(formatElapsed(7_380_000), "2h 03m");
});

test("running shells tick from start; ended shells show their run time", () => {
  const now = Date.parse("2026-10-06T16:00:43.455Z");
  assert.equal(shellElapsed(shell, now), "1m 05s");
  const ended = { ...shell, status: "completed" as const, endedAt: "2026-10-06T15:59:51.533Z" };
  assert.equal(shellElapsed(ended, now), "13s");
  assert.equal(shellElapsed({ ...shell, status: "ended", endedAt: null }, now), null);
});

test("detail line joins status, time, exit code, and task id", () => {
  const now = Date.parse("2026-10-06T16:00:43.455Z");
  assert.equal(
    shellDetail({ ...shell, status: "failed", exitCode: 3, endedAt: "2026-10-06T15:59:42.455Z" }, now),
    "Failed · 4s · exit 3 · b636to6ne",
  );
  assert.equal(shellDetail({ ...shell, status: "ended" }, now), "Ended (unknown) · b636to6ne");
});

test("stop prompt names the task and its description or command", () => {
  assert.equal(
    stopPrompt({ ...shell, description: "long ticker" }),
    "Use TaskStop to stop background task b636to6ne (long ticker). Reply briefly.",
  );
  assert.equal(
    stopPrompt({ taskId: "x1", description: null, command: "npm run dev\necho second line" }),
    "Use TaskStop to stop background task x1 (npm run dev). Reply briefly.",
  );
});
