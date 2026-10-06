import type { PluginTheme } from "@getpaseo/plugin";
import { type PluginAgentPanelProps, useAgent, usePaseo, useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { shellsListRpc, shellsTailRpc } from "../shared/contracts.ts";
import type { ShellStatus, ShellTask } from "../shared/shell.ts";
import { shellDetail, stopPrompt } from "./format.ts";

const LIST_RUNNING_MS = 2000;
const LIST_IDLE_MS = 10000;
const TAIL_RUNNING_MS = 1500;
const CONFIRM_MS = 4000;

const MONOSPACE = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
});

type Styles = ReturnType<typeof createStyles>;

function createStyles(theme: PluginTheme, compact: boolean) {
  const { colors } = theme;
  return {
    screen: { flex: 1, backgroundColor: colors.surface0 },
    content: { padding: compact ? 12 : 20, gap: compact ? 8 : 12 },
    title: { color: colors.foreground, fontSize: compact ? 17 : 19, fontWeight: "600" as const },
    muted: { color: colors.foregroundMuted, fontSize: 13 },
    error: { color: colors.statusDanger, fontSize: 13 },
    row: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      backgroundColor: colors.surface1,
      overflow: "hidden" as const,
    },
    rowSelected: { borderColor: colors.accent },
    rowHeader: { padding: compact ? 10 : 12, gap: 6 },
    rowTop: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    // Hollow, so running reads differently from completed when accent and success are close.
    dotRunning: { backgroundColor: "transparent", borderWidth: 2 },
    rowTitle: { flex: 1, color: colors.foreground, fontSize: 14, fontWeight: "500" as const },
    command: { color: colors.foregroundMuted, fontFamily: MONOSPACE, fontSize: 12 },
    actions: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8, alignItems: "center" as const },
    button: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface2,
    },
    buttonDanger: { borderColor: colors.statusDanger },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { color: colors.foreground, fontSize: 13 },
    buttonTextDanger: { color: colors.statusDanger, fontSize: 13 },
    tail: {
      maxHeight: compact ? 240 : 360,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.surface0,
    },
    tailContent: { padding: compact ? 10 : 12 },
    tailText: { color: colors.foreground, fontFamily: MONOSPACE, fontSize: 12, lineHeight: 17 },
    fullCommand: {
      maxHeight: compact ? 160 : 240,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    fullCommandContent: { padding: compact ? 10 : 12, gap: 4 },
    label: { color: colors.foregroundMuted, fontSize: 11, fontWeight: "600" as const },
  };
}

function statusColor(theme: PluginTheme, status: ShellStatus): string {
  switch (status) {
    case "running":
      return theme.colors.accent;
    case "completed":
      return theme.colors.statusSuccess;
    case "failed":
      return theme.colors.statusDanger;
    case "stopped":
      return theme.colors.statusWarning;
    case "ended":
      return theme.colors.foregroundMuted;
  }
}

/** Re-renders every second while enabled, so running times tick. */
function useNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [enabled]);
  return now;
}

export function ShellsPanel({ theme, layout, agentId }: PluginAgentPanelProps) {
  const styles = useMemo(() => createStyles(theme, layout.compact), [theme, layout.compact]);
  const listShells = useRpc(shellsListRpc);
  const agent = useAgent(agentId, ({ status, provider }) => ({ status, provider }));
  // Undefined follows the default (newest running shell); null means the user collapsed it.
  const [selected, setSelected] = useState<string | null | undefined>(undefined);

  const list = useQuery({
    queryKey: ["shells", agentId],
    queryFn: () => listShells({ agentId }),
    refetchInterval: (query) =>
      query.state.data?.shells.some((shell) => shell.status === "running") ? LIST_RUNNING_MS : LIST_IDLE_MS,
  });
  const shells = list.data?.shells ?? [];
  const anyRunning = shells.some((shell) => shell.status === "running");
  const now = useNow(anyRunning);
  const selectedId =
    selected === undefined
      ? (shells.find((shell) => shell.status === "running")?.taskId ?? shells[0]?.taskId)
      : selected;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title} accessibilityRole="header">
        Background shells
      </Text>
      {agent && agent.provider !== "claude" ? (
        <Text style={styles.muted}>Background shells are tracked for Claude Code agents only.</Text>
      ) : list.isPending || (list.data && !list.data.tracked) ? (
        <Text style={styles.muted}>Loading shells…</Text>
      ) : list.isError ? (
        <Text style={styles.error}>Could not load shells: {String(list.error)}</Text>
      ) : shells.length === 0 ? (
        <Text style={styles.muted}>This agent has not started any background shells.</Text>
      ) : (
        shells.map((shell) => (
          <ShellRow
            key={shell.taskId}
            agentId={agentId}
            agentStatus={agent?.status ?? null}
            shell={shell}
            now={now}
            selected={shell.taskId === selectedId}
            onSelect={() => setSelected(shell.taskId === selectedId ? null : shell.taskId)}
            styles={styles}
            theme={theme}
          />
        ))
      )}
    </ScrollView>
  );
}

interface ShellRowProps {
  agentId: string;
  agentStatus: string | null;
  shell: ShellTask;
  now: number;
  selected: boolean;
  onSelect(): void;
  styles: Styles;
  theme: PluginTheme;
}

function ShellRow({ agentId, agentStatus, shell, now, selected, onSelect, styles, theme }: ShellRowProps) {
  const title = shell.description ?? shell.command.split("\n", 1)[0];
  return (
    <View style={[styles.row, selected ? styles.rowSelected : null]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: selected }}
        accessibilityLabel={`${title}, ${shellDetail(shell, now)}. ${selected ? "Hide" : "Show"} command and output`}
        onPress={onSelect}
        style={styles.rowHeader}
      >
        <View style={styles.rowTop}>
          <View
            style={[
              styles.dot,
              shell.status === "running"
                ? [styles.dotRunning, { borderColor: statusColor(theme, shell.status) }]
                : { backgroundColor: statusColor(theme, shell.status) },
            ]}
          />
          <Text style={styles.rowTitle} numberOfLines={1}>
            {title}
          </Text>
        </View>
        {shell.description && !selected ? (
          <Text style={styles.command} numberOfLines={2}>
            {shell.command}
          </Text>
        ) : null}
        <View style={styles.actions}>
          <Text style={styles.muted}>{shellDetail(shell, now)}</Text>
          {shell.status === "running" ? (
            <AskToStop agentId={agentId} agentStatus={agentStatus} shell={shell} styles={styles} />
          ) : null}
        </View>
      </Pressable>
      {selected ? <FullCommand command={shell.command} styles={styles} /> : null}
      {selected ? <OutputTail agentId={agentId} shell={shell} styles={styles} /> : null}
    </View>
  );
}

// Outside the row's Pressable, so selecting text to copy it does not collapse the row.
function FullCommand({ command, styles }: { command: string; styles: Styles }) {
  return (
    <ScrollView style={styles.fullCommand} contentContainerStyle={styles.fullCommandContent} nestedScrollEnabled>
      <Text style={styles.label}>Command</Text>
      <Text style={styles.tailText} selectable>
        {command}
      </Text>
    </ScrollView>
  );
}

interface AskToStopProps {
  agentId: string;
  agentStatus: string | null;
  shell: ShellTask;
  styles: Styles;
}

/**
 * Sending a prompt while the agent is mid-turn interrupts that turn (measured on 0.9.1),
 * so a busy agent needs a second press to confirm.
 */
function AskToStop({ agentId, agentStatus, shell, styles }: AskToStopProps) {
  const paseo = usePaseo();
  const [confirming, setConfirming] = useState(false);
  const send = useMutation({
    mutationFn: () => paseo.agents.ref(agentId).send(stopPrompt(shell)),
  });
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirming]);

  if (agentStatus === "closed" || agentStatus === null) return null;
  if (send.isSuccess || send.isPending) {
    return (
      <View style={[styles.button, styles.buttonDisabled]}>
        <Text style={styles.buttonText}>Stop requested</Text>
      </View>
    );
  }
  const busy = agentStatus === "running";
  const label = confirming ? "Interrupt agent and stop?" : busy ? "Interrupt to stop" : "Ask to stop";
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          busy
            ? `Interrupt the agent's current turn and ask it to stop ${shell.taskId}`
            : `Ask the agent to stop ${shell.taskId}`
        }
        onPress={() => {
          if (busy && !confirming) setConfirming(true);
          else send.mutate();
        }}
        style={[styles.button, busy ? styles.buttonDanger : null]}
      >
        <Text style={busy ? styles.buttonTextDanger : styles.buttonText}>{label}</Text>
      </Pressable>
      {send.isError ? <Text style={styles.error}>Could not send: {String(send.error)}</Text> : null}
    </>
  );
}

interface OutputTailProps {
  agentId: string;
  shell: ShellTask;
  styles: Styles;
}

function OutputTail({ agentId, shell, styles }: OutputTailProps) {
  const readTail = useRpc(shellsTailRpc);
  const scroll = useRef<ScrollView>(null);
  const tail = useQuery({
    queryKey: ["tail", agentId, shell.taskId],
    queryFn: () => readTail({ agentId, taskId: shell.taskId }),
    refetchInterval: shell.status === "running" ? TAIL_RUNNING_MS : false,
  });
  const text = tail.data?.text ?? "";
  const placeholder = tail.isPending
    ? "Loading output…"
    : tail.isError
      ? `Could not read output: ${String(tail.error)}`
      : !tail.data?.available
        ? "Output file is not available."
        : text.length === 0
          ? "No output yet."
          : null;

  return (
    <ScrollView
      ref={scroll}
      style={styles.tail}
      contentContainerStyle={styles.tailContent}
      nestedScrollEnabled
      onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
    >
      {tail.data?.truncated ? <Text style={styles.muted}>Showing the last part of the output.</Text> : null}
      <Text style={placeholder ? styles.muted : styles.tailText} selectable>
        {placeholder ?? text}
      </Text>
    </ScrollView>
  );
}
