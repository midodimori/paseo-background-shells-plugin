import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { readOutputTail, resolveOutputPath } from "../server/output-tail.ts";

let base: string;
let root: string;
let tasks: string;

before(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), "bgshells-")));
  root = path.join(base, "claude-501");
  tasks = path.join(root, "-Users-me-project", "session", "tasks");
  await mkdir(tasks, { recursive: true });
  await writeFile(path.join(tasks, "done.output"), "tick 1\ntick 2\n\n[exited with code 0]\n");
  await writeFile(path.join(tasks, "running.output"), "tick 1\n");
  await writeFile(path.join(tasks, "notes.txt"), "not output\n");
  await writeFile(path.join(base, "secret.output"), "outside the root\n");
  await mkdir(path.join(root, "elsewhere"), { recursive: true });
  await writeFile(path.join(root, "elsewhere", "stray.output"), "not in a tasks directory\n");
  await symlink(path.join(base, "secret.output"), path.join(tasks, "link.output"));
});

after(async () => {
  await rm(base, { recursive: true, force: true });
});

test("reads a whole small file and its footer", async () => {
  const tail = await readOutputTail(path.join(tasks, "done.output"), 1024, root);
  assert.equal(tail.available, true);
  assert.equal(tail.text, "tick 1\ntick 2\n\n[exited with code 0]\n");
  assert.equal(tail.truncated, false);
  assert.deepEqual(tail.footer, { kind: "exited", exitCode: 0 });
});

test("a running task has no footer", async () => {
  const tail = await readOutputTail(path.join(tasks, "running.output"), 1024, root);
  assert.equal(tail.footer, null);
  assert.equal(tail.text, "tick 1\n");
});

test("truncates to the last bytes and drops the partial first line", async () => {
  const lines = Array.from({ length: 200 }, (_, index) => `line ${index}`).join("\n") + "\n";
  const file = path.join(tasks, "long.output");
  await writeFile(file, lines);
  const tail = await readOutputTail(file, 50, root);
  assert.equal(tail.truncated, true);
  assert.equal(tail.size, Buffer.byteLength(lines));
  assert.ok(Buffer.byteLength(tail.text) <= 50);
  assert.ok(tail.text.endsWith("line 199\n"));
  assert.match(tail.text, /^line \d+\n/);
});

test("rejects paths outside the root, symlink escapes, and other files", async () => {
  assert.equal(await resolveOutputPath(path.join(base, "secret.output"), root), null);
  assert.equal(await resolveOutputPath(path.join(tasks, "link.output"), root), null);
  assert.equal(await resolveOutputPath(path.join(tasks, "..", "..", "..", "..", "secret.output"), root), null);
  assert.equal(await resolveOutputPath(path.join(tasks, "notes.txt"), root), null);
  assert.equal(await resolveOutputPath(path.join(root, "elsewhere", "stray.output"), root), null);
  assert.equal(await resolveOutputPath("relative/tasks/done.output", root), null);
  assert.equal(await resolveOutputPath(path.join(tasks, "missing.output"), root), null);
  const unavailable = await readOutputTail(path.join(tasks, "link.output"), 1024, root);
  assert.equal(unavailable.available, false);
  assert.equal(unavailable.text, "");
});

test("no root means nothing is readable", async () => {
  const tail = await readOutputTail(path.join(tasks, "done.output"), 1024, null);
  assert.equal(tail.available, false);
});
