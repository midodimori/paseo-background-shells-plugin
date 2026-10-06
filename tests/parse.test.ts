import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseBackgroundStart,
  parseOutputFooter,
  parseTaskNotification,
  parseTaskStop,
} from "../server/parse.ts";
import { historyEntries, lastLive, liveItems, metadataTaskId, timeoutEntries } from "./helpers.ts";

const TASKS_DIR =
  "/private/tmp/claude-501/-Users-me-dev-project/11111111-1111-4111-8111-111111111111/tasks";

test("parses the background start text from a completed Bash call", () => {
  const item = lastLive((item) => item.callId === "toolu_018mrHgE4rALtXGmrZcj3XDC");
  assert.deepEqual(parseBackgroundStart(item), {
    taskId: "brag50qof",
    toolUseId: "toolu_018mrHgE4rALtXGmrZcj3XDC",
    command: "for i in 1 2 3 4 5 6 7 8; do echo tick $i; sleep 3; done",
    outputFile: `${TASKS_DIR}/brag50qof.output`,
    ranForegroundMs: 0,
  });
});

test("parses a foreground command that timed out and moved to the background", () => {
  const start = parseBackgroundStart(timeoutEntries[0].item);
  assert.equal(start?.taskId, "bgecvpv1q");
  assert.equal(start?.toolUseId, "toolu_01RHWSyqZZzrzXsiMY9Fn3sW");
  assert.equal(start?.ranForegroundMs, 90_000);
  assert.equal(
    start?.outputFile,
    "/private/tmp/claude-501/-Users-me-dev-project/22222222-2222-4222-8222-222222222222/tasks/bgecvpv1q.output",
  );
  assert.deepEqual(parseTaskNotification(timeoutEntries[1].item), {
    taskId: "bgecvpv1q",
    toolUseId: "toolu_01RHWSyqZZzrzXsiMY9Fn3sW",
    status: "failed",
    exitCode: 144,
    description: "Wait for the stop turn to finish and show it",
  });
});

test("ignores shell output that only mentions background tasks", () => {
  const echoed = {
    type: "tool_call",
    callId: "toolu_echo",
    detail: { type: "shell", command: "cat notes", output: "notes: Command running in background with ID: x." },
  };
  assert.equal(parseBackgroundStart(echoed), null);
});

test("ignores Bash calls that are still running or ran in the foreground", () => {
  const starts = liveItems()
    .map(({ item }) => parseBackgroundStart(item))
    .filter((start) => start !== null)
    .map((start) => start.taskId);
  assert.deepEqual([...new Set(starts)], ["brag50qof", "b83d7jga2", "b9h7mtnuu", "bxq7gqucc"]);
});

test("parses live completed, failed, and stopped notifications", () => {
  const byTask = (taskId: string) => parseTaskNotification(lastLive((item) => metadataTaskId(item) === taskId));
  assert.deepEqual(byTask("brag50qof"), {
    taskId: "brag50qof",
    toolUseId: "toolu_018mrHgE4rALtXGmrZcj3XDC",
    status: "completed",
    exitCode: 0,
    description: "tick probe",
  });
  assert.deepEqual(byTask("b83d7jga2"), {
    taskId: "b83d7jga2",
    toolUseId: "toolu_01CTFMYgH9FwUk242dabzpiP",
    status: "failed",
    exitCode: 3,
    description: "fail probe",
  });
  // item.status is "completed" here; metadata.status says stopped.
  assert.deepEqual(byTask("b9h7mtnuu"), {
    taskId: "b9h7mtnuu",
    toolUseId: "toolu_01EDkMgdjwdo3LxzqjDQ8Srp",
    status: "stopped",
    exitCode: null,
    description: "stop probe",
  });
});

test("parses the killed notification Claude Code writes when the agent is archived", () => {
  const entry = historyEntries.find(({ item }) => metadataTaskId(item) === "bxq7gqucc");
  assert.deepEqual(parseTaskNotification(entry?.item), {
    taskId: "bxq7gqucc",
    toolUseId: "toolu_01EG3vp9gBDkQewRmA3gC4eR",
    status: "stopped",
    exitCode: null,
    description: "orphan probe",
  });
});

test("rejects tool calls that are not Claude task notifications", () => {
  const bash = lastLive((item) => item.callId === "toolu_018mrHgE4rALtXGmrZcj3XDC");
  assert.equal(parseTaskNotification(bash), null);
  assert.equal(
    parseTaskNotification({ type: "tool_call", name: "task_notification", detail: {}, metadata: { taskId: "x" } }),
    null,
  );
});

test("parses a successful TaskStop call", () => {
  const stop = lastLive((item) => item.name === "TaskStop");
  assert.deepEqual(parseTaskStop(stop), { taskId: "b9h7mtnuu" });
  const running = liveItems().find(({ item }) => item.name === "TaskStop")?.item;
  assert.equal(parseTaskStop(running), null);
});

test("rejects a TaskStop that reports failure", () => {
  const failed = {
    type: "tool_call",
    name: "TaskStop",
    status: "completed",
    detail: { type: "unknown", input: { task_id: "abc" }, output: { output: { message: "No task found with ID: abc" } } },
  };
  assert.equal(parseTaskStop(failed), null);
});

test("parses output footers", () => {
  assert.deepEqual(parseOutputFooter("tick 8\n\n[exited with code 0]\n"), { kind: "exited", exitCode: 0 });
  assert.deepEqual(parseOutputFooter("failing\n\n[exited with code 3]\n"), { kind: "exited", exitCode: 3 });
  assert.deepEqual(parseOutputFooter("stop-tick 6\n\n[killed]\n"), { kind: "killed" });
  assert.equal(parseOutputFooter("tick 3\n"), null);
  assert.equal(parseOutputFooter("echo [killed] in the middle\nmore\n"), null);
});
