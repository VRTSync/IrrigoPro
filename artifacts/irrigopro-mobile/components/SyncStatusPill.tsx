import { Feather } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { drainQueue } from "@/lib/sync/engine";
import { useSyncStatus } from "@/lib/sync/use-sync-status";

type Tone = {
  bg: string;
  fg: string;
  border: string;
};

const TONES: Record<"synced" | "pending" | "offline" | "failed", Tone> = {
  synced: { bg: "#dcfce7", fg: "#166534", border: "#86efac" },
  pending: { bg: "#fef9c3", fg: "#854d0e", border: "#fde047" },
  offline: { bg: "#fee2e2", fg: "#991b1b", border: "#fca5a5" },
  failed: { bg: "#fee2e2", fg: "#991b1b", border: "#fca5a5" },
};

export function SyncStatusPill() {
  const colors = useColors();
  const { online, pending, failed, conflict } = useSyncStatus();
  const [busy, setBusy] = React.useState(false);

  let tone: Tone;
  let icon: React.ComponentProps<typeof Feather>["name"];
  let label: string;

  if (!online) {
    tone = TONES.offline;
    icon = "wifi-off";
    label = pending + failed + conflict > 0 ? `Offline · ${pending + failed + conflict}` : "Offline";
  } else if (failed + conflict > 0) {
    tone = TONES.failed;
    icon = "alert-circle";
    label = `${failed + conflict} stuck`;
  } else if (pending > 0) {
    tone = TONES.pending;
    icon = "upload-cloud";
    label = `${pending} pending`;
  } else {
    tone = TONES.synced;
    icon = "check";
    label = "Synced";
  }

  const onPress = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await drainQueue();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Sync status: ${label}. Tap to sync now.`}
      style={({ pressed }) => [
        styles.pill,
        {
          backgroundColor: tone.bg,
          borderColor: tone.border,
          borderRadius: colors.radius - 4,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={tone.fg} />
      ) : (
        <Feather name={icon} size={12} color={tone.fg} />
      )}
      <Text style={[styles.text, { color: tone.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export function SyncStatusSummary() {
  const colors = useColors();
  const { online, pending, failed, conflict, total } = useSyncStatus();
  const lines: Array<{ label: string; value: string; tone: string }> = [
    { label: "Connection", value: online ? "Online" : "Offline", tone: online ? "#166534" : "#991b1b" },
    { label: "Pending", value: String(pending), tone: pending > 0 ? "#854d0e" : colors.mutedForeground },
    { label: "Failed", value: String(failed), tone: failed > 0 ? "#991b1b" : colors.mutedForeground },
    { label: "Conflicts", value: String(conflict), tone: conflict > 0 ? "#991b1b" : colors.mutedForeground },
    { label: "Total queued", value: String(total), tone: colors.foreground },
  ];
  return (
    <View>
      {lines.map((l) => (
        <View key={l.label} style={styles.row}>
          <Text style={[styles.rowLabel, { color: colors.mutedForeground }]}>{l.label}</Text>
          <Text style={[styles.rowValue, { color: l.tone }]}>{l.value}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: StyleSheet.hairlineWidth,
  },
  text: { fontSize: 12, fontWeight: "600" },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  rowLabel: { fontSize: 13 },
  rowValue: { fontSize: 13, fontWeight: "600" },
});
