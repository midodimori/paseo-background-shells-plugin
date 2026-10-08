import assert from "node:assert/strict";
import { test } from "node:test";
import { ShellTracker, type FooterReading, type TrackerPaseo } from "../server/tracker.ts";
import { historyEntries, liveUpdates } from "./helpers.ts";

const AGENT = "1561de0d-3cd9-4854-a04e-89c30bf6c8a0";

interface FakeAgent {
  id: string;
  provider: string;
  status: string;
  archivedAt?: string | null;
}

/** The slice of PaseoApi the tracker uses, driven by hand. */
function fakePaseo(initial: FakeAgent[], history: unknown[] = []) {
  const timelineHandlers = new Map<string, (update: unknown) => void>();
  const released: string[] = [];
  let directoryUpdate: ((message: unknown) => void) | null = null;
  const refetches: string[] = [];
  const paseo = {
    agents: {
      async list() {
        return {
          entries: initial.map((agent) => ({ agent })),
          subscription: {
            subscribe(observer: { update(message: unknown): void }) {
              directoryUpdate = observer.update;
              return () => {};
            },
            async release() {},
          },
        };
      },
      ref(id: string) {
        return {
          timeline: {
            async refetch() {
              refetches.push(id);
              return { entries: history, agent: null };
            },
            subscribe(handler: (update: unknown) => void) {
              timelineHandlers.set(id, handler);
              return Object.assign(() => {}, {
                ready: Promise.resolve(),
                release: async () => void released.push(id),
              });
            },
          },
        };
      },
    },
  };
  return {
    paseo: paseo as unknown as TrackerPaseo,
    refetches,
    released,
    emit(agentId: string, update: unknown) {
      timelineHandlers.get(agentId)?.(update);
    },
    directory(message: unknown) {
      directoryUpdate?.(message);
    },
  };
}

function tracker(footers: Record<string, FooterReading | "missing"> = {}) {
  return new ShellTracker({
    async readFooter(outputFile) {
      const id = outputFile.split("/").pop()?.replace(".output", "") ?? "";
      return footers[id] ?? null;
    },
    loadTimeoutMs: 100,
  });
}

function statuses(shells: { taskId: string; status: string }[]) {
  return Object.fromEntries(shells.map((shell) => [shell.taskId, shell.status]));
}

test("tracks only Claude agents and replays live updates", async () => {
  const fake = fakePaseo([
    { id: AGENT, provider: "claude", status: "idle" },
    { id: "codex-agent", provider: "codex", status: "idle" },
  ]);
  const shells = tracker();
  await shells.start(fake.paseo);
  assert.deepEqual(fake.refetches, [AGENT]);
  for (const update of liveUpdates) fake.emit(AGENT, { agentId: AGENT, ...update });
  const listed = await shells.list(AGENT);
  assert.equal(listed.tracked, true);
  assert.deepEqual(statuses(listed.shells), {
    bxq7gqucc: "running",
    b9h7mtnuu: "stopped",
    b83d7jga2: "failed",
    brag50qof: "completed",
  });
  // Running first, then newest first.
  assert.deepEqual(
    listed.shells.map((shell) => shell.taskId),
    ["bxq7gqucc", "b9h7mtnuu", "b83d7jga2", "brag50qof"],
  );
  assert.deepEqual(await shells.summary(), [{ agentId: AGENT, running: 1, total: 4 }]);
  assert.deepEqual(await shells.list("codex-agent"), { tracked: false, shells: [] });
  await shells.stop();
});

test("loads history on start and again after a replacement", async () => {
  const fake = fakePaseo([{ id: AGENT, provider: "claude", status: "idle" }], historyEntries);
  const shells = tracker();
  await shells.start(fake.paseo);
  assert.deepEqual(statuses((await shells.list(AGENT)).shells), {
    bxq7gqucc: "stopped",
    b9h7mtnuu: "stopped",
    b83d7jga2: "failed",
    brag50qof: "completed",
  });
  fake.emit(AGENT, { agentId: AGENT, event: { type: "replacement", epoch: "next" } });
  await shells.list(AGENT);
  assert.deepEqual(fake.refetches, [AGENT, AGENT]);
  await shells.stop();
});

test("a footer settles a running shell; a closed session ends it", async () => {
  const fake = fakePaseo([{ id: AGENT, provider: "claude", status: "idle" }]);
  const shells = tracker({ bxq7gqucc: { footer: { kind: "killed" }, at: "2026-10-06T10:33:17.000Z" } });
  await shells.start(fake.paseo);
  for (const update of liveUpdates) fake.emit(AGENT, { agentId: AGENT, ...update });
  const orphan = (await shells.list(AGENT)).shells.find((shell) => shell.taskId === "bxq7gqucc");
  assert.equal(orphan?.status, "stopped");
  assert.equal(orphan?.endedAt, "2026-10-06T10:33:17.000Z");
  await shells.stop();

  const closed = fakePaseo([{ id: AGENT, provider: "claude", status: "idle" }]);
  const ended = tracker();
  await ended.start(closed.paseo);
  for (const update of liveUpdates) closed.emit(AGENT, { agentId: AGENT, ...update });
  closed.directory({
    type: "agent_update",
    payload: { kind: "upsert", agent: { id: AGENT, provider: "claude", status: "closed" } },
  });
  const after = (await ended.list(AGENT)).shells.find((shell) => shell.taskId === "bxq7gqucc");
  assert.equal(after?.status, "ended");
  await ended.stop();
});

test("a shell whose output file is gone stops counting as running", async () => {
  const fake = fakePaseo([{ id: AGENT, provider: "claude", status: "idle" }]);
  const shells = tracker({ bxq7gqucc: "missing" });
  await shells.start(fake.paseo);
  for (const update of liveUpdates) fake.emit(AGENT, { agentId: AGENT, ...update });
  const stale = (await shells.list(AGENT)).shells.find((shell) => shell.taskId === "bxq7gqucc");
  assert.equal(stale?.status, "ended");
  assert.deepEqual(await shells.summary(), [{ agentId: AGENT, running: 0, total: 4 }]);
  await shells.stop();
});

test("archiving or removing an agent releases its timeline", async () => {
  const fake = fakePaseo([{ id: AGENT, provider: "claude", status: "idle" }]);
  const shells = tracker();
  await shells.start(fake.paseo);
  fake.directory({
    type: "agent_update",
    payload: { kind: "upsert", agent: { id: AGENT, provider: "claude", status: "idle", archivedAt: "x" } },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(fake.released, [AGENT]);
  assert.deepEqual(await shells.list(AGENT), { tracked: false, shells: [] });
  await shells.stop();
});

test("start is idempotent", async () => {
  const fake = fakePaseo([{ id: AGENT, provider: "claude", status: "idle" }]);
  const shells = tracker();
  await Promise.all([shells.start(fake.paseo), shells.start(fake.paseo)]);
  assert.deepEqual(fake.refetches, [AGENT]);
  await shells.stop();
});
