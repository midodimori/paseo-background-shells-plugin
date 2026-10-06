import assert from "node:assert/strict";
import { test } from "node:test";
import { applyTimelineItem, createAgentShells, resolveShell, type AgentShells } from "../server/reduce.ts";
import { historyEntries, liveItems, timeoutEntries } from "./helpers.ts";

const open = { footer: null, footerAt: null, sessionEnded: false };

function statuses(state: AgentShells, context = open) {
  return Object.fromEntries(
    [...state.shells.values()].map((shell) => {
      const resolved = resolveShell(shell, context);
      return [shell.taskId, [resolved.status, resolved.exitCode, resolved.description]];
    }),
  );
}

test("live stream: tracks only background shells and their ends", () => {
  const state = createAgentShells();
  for (const { item, timestamp } of liveItems()) applyTimelineItem(state, item, timestamp);
  assert.deepEqual(statuses(state), {
    brag50qof: ["completed", 0, "tick probe"],
    b83d7jga2: ["failed", 3, "fail probe"],
    b9h7mtnuu: ["stopped", null, "stop probe"],
    // Archived before any notification; the live stream never reports its end.
    bxq7gqucc: ["running", null, null],
  });
  // Foreground Bash notifications (sleep 5, the timeout probe) never become shells.
  assert.equal(state.shells.has("b5pcm51bh"), false);
  assert.equal(state.shells.has("bbzynevtv"), false);
});

test("live stream: a shell is running as soon as its start arrives", () => {
  const state = createAgentShells();
  const items = liveItems();
  const startIndex = items.findIndex(
    ({ item }) => item.callId === "toolu_018mrHgE4rALtXGmrZcj3XDC" && item.status === "completed",
  );
  for (const { item, timestamp } of items.slice(0, startIndex + 1)) applyTimelineItem(state, item, timestamp);
  const shell = state.shells.get("brag50qof");
  assert.ok(shell);
  assert.equal(shell.startedAt, "2026-10-06T10:31:20.775Z");
  assert.equal(resolveShell(shell, open).status, "running");
});

test("history: deduplicates repeated notifications and recovers the TaskStop", () => {
  const state = createAgentShells();
  for (const { item, timestamp } of historyEntries) applyTimelineItem(state, item, timestamp);
  assert.deepEqual(statuses(state), {
    brag50qof: ["completed", 0, "tick probe"],
    b83d7jga2: ["failed", 3, "fail probe"],
    // History has no stop notification; the TaskStop call is the only signal.
    b9h7mtnuu: ["stopped", null, null],
    bxq7gqucc: ["stopped", null, "orphan probe"],
  });
  // The first of the duplicate notifications sets the end time.
  assert.equal(state.shells.get("b83d7jga2")?.end?.at, "2026-10-06T10:31:25.090Z");
});

test("replaying the same items changes nothing", () => {
  const once = createAgentShells();
  const twice = createAgentShells();
  for (const { item, timestamp } of historyEntries) applyTimelineItem(once, item, timestamp);
  for (const { item, timestamp } of [...historyEntries, ...historyEntries]) applyTimelineItem(twice, item, timestamp);
  assert.deepEqual(statuses(twice), statuses(once));
});

test("a notification that arrives before its start still applies", () => {
  const state = createAgentShells();
  const items = liveItems();
  const notification = items.find(({ item }) => item.name === "task_notification" && item.status === "failed");
  const start = items.findLast(({ item }) => item.callId === "toolu_01CTFMYgH9FwUk242dabzpiP");
  assert.ok(notification && start);
  applyTimelineItem(state, notification.item, notification.timestamp);
  applyTimelineItem(state, start.item, start.timestamp);
  assert.deepEqual(statuses(state), { b83d7jga2: ["failed", 3, "fail probe"] });
});

test("a notification outranks an earlier TaskStop", () => {
  const state = createAgentShells();
  for (const { item, timestamp } of liveItems()) {
    if (item.name === "task_notification") continue;
    applyTimelineItem(state, item, timestamp);
  }
  assert.equal(state.shells.get("b9h7mtnuu")?.end?.source, "task-stop");
  const stopped = liveItems().find(
    ({ item }) => item.name === "task_notification" && (item.metadata as { taskId?: string }).taskId === "b9h7mtnuu",
  );
  assert.ok(stopped);
  applyTimelineItem(state, stopped.item, stopped.timestamp);
  const shell = state.shells.get("b9h7mtnuu");
  assert.equal(shell?.end?.source, "notification");
  assert.equal(shell?.description, "stop probe");
});

test("resolve: footer settles a shell without a notification", () => {
  const state = createAgentShells();
  for (const { item, timestamp } of liveItems()) applyTimelineItem(state, item, timestamp);
  const orphan = state.shells.get("bxq7gqucc");
  assert.ok(orphan);
  const at = "2026-10-06T10:33:17.000Z";
  assert.deepEqual(
    pick(resolveShell(orphan, { footer: { kind: "killed" }, footerAt: at, sessionEnded: false })),
    ["stopped", null, at],
  );
  assert.deepEqual(
    pick(resolveShell(orphan, { footer: { kind: "exited", exitCode: 0 }, footerAt: at, sessionEnded: false })),
    ["completed", 0, at],
  );
  assert.deepEqual(
    pick(resolveShell(orphan, { footer: { kind: "exited", exitCode: 2 }, footerAt: at, sessionEnded: false })),
    ["failed", 2, at],
  );
});

test("resolve: an ended session with no other signal shows ended, not running", () => {
  const state = createAgentShells();
  for (const { item, timestamp } of liveItems()) applyTimelineItem(state, item, timestamp);
  const orphan = state.shells.get("bxq7gqucc");
  assert.ok(orphan);
  assert.deepEqual(pick(resolveShell(orphan, { footer: null, footerAt: null, sessionEnded: true })), [
    "ended",
    null,
    null,
  ]);
});

function pick(shell: ReturnType<typeof resolveShell>) {
  return [shell.status, shell.exitCode, shell.endedAt];
}

test("a timed-out command counts its foreground time in startedAt", () => {
  const state = createAgentShells();
  for (const { item, timestamp } of timeoutEntries) applyTimelineItem(state, item, timestamp);
  const shell = state.shells.get("bgecvpv1q");
  assert.equal(shell?.startedAt, "2026-10-06T15:59:57.318Z");
  assert.deepEqual(statuses(state), {
    bgecvpv1q: ["failed", 144, "Wait for the stop turn to finish and show it"],
  });
});
