import assert from "node:assert/strict";
import { test } from "node:test";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { contributePills } from "../client/pills.ts";
import type { AgentShellSummary } from "../shared/shell.ts";

const AGENT = "agent-1";
const IDLE_ICON = () => null;

/** Records pill registrations and updates; the directory and summary RPC are driven by hand. */
function fakeClient() {
  let summary: AgentShellSummary[] = [];
  let directoryUpdate: ((message: unknown) => void) | null = null;
  const button = { current: null as Record<string, unknown> | null };
  let ready!: () => void;
  const subscribed = new Promise<void>((resolve) => (ready = resolve));
  const client = {
    paseo: {
      agents: {
        async list() {
          return {
            subscription: {
              subscribe(observer: { snapshot(s: unknown): void; update(m: unknown): void }) {
                directoryUpdate = observer.update;
                observer.snapshot({
                  entries: [{ agent: { id: AGENT, provider: "claude", status: "running", workspaceId: "w1" } }],
                });
                ready();
                return () => {};
              },
            },
          };
        },
      },
    },
    async rpc() {
      return { agents: summary };
    },
    addComposerPill({ button: initial }: { button: Record<string, unknown> }) {
      button.current = { ...initial };
      return {
        update(patch: Record<string, unknown>) {
          button.current = { ...button.current, ...patch };
        },
        remove() {
          button.current = null;
        },
      };
    },
    openPanel() {},
  };
  return {
    client: client as unknown as PluginClientContext,
    button,
    subscribed,
    setSummary(next: AgentShellSummary[]) {
      summary = next;
    },
    setStatus(status: string) {
      directoryUpdate?.({
        type: "agent_update",
        payload: { kind: "upsert", agent: { id: AGENT, provider: "claude", status, workspaceId: "w1" } },
      });
    },
  };
}

async function settle() {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
}

test("the pill warns when the agent goes idle with a running shell", async () => {
  const fake = fakeClient();
  fake.setSummary([{ agentId: AGENT, running: 1, total: 1 }]);
  const stop = contributePills(fake.client, { panelId: "panel", idleIcon: IDLE_ICON });
  await fake.subscribed;
  await settle();
  assert.equal(fake.button.current?.label, "Shells · 1 running");
  assert.equal(fake.button.current?.icon, "SquareTerminal");

  fake.setStatus("idle");
  assert.equal(fake.button.current?.label, "1 running · idle");
  assert.equal(fake.button.current?.icon, IDLE_ICON);
  assert.equal(fake.button.current?.visible, true);

  fake.setStatus("running");
  assert.equal(fake.button.current?.label, "Shells · 1 running");
  assert.equal(fake.button.current?.icon, "SquareTerminal");

  fake.setStatus("closed");
  assert.equal(fake.button.current?.label, "Shells · 1 running");
  await stop();
});

test("an idle agent without shells keeps the pill hidden", async () => {
  const fake = fakeClient();
  const stop = contributePills(fake.client, { panelId: "panel", idleIcon: IDLE_ICON });
  await fake.subscribed;
  await settle();
  fake.setStatus("idle");
  assert.equal(fake.button.current?.visible, false);
  await stop();
});
