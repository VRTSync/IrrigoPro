import { Feather } from "@expo/vector-icons";
import Constants from "expo-constants";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { SyncStatusSummary } from "@/components/SyncStatusPill";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/lib/auth-context";
import { discardEntry, drainQueue } from "@/lib/sync/engine";
import { markAllPending } from "@/lib/sync/queue";
import { useSyncStatus } from "@/lib/sync/use-sync-status";

const ROLE_LABELS: Record<string, string> = {
  field_tech: "Field technician",
  irrigation_manager: "Irrigation manager",
  company_admin: "Company admin",
  billing_manager: "Billing manager",
  super_admin: "Super admin",
};

export default function ProfileScreen() {
  const colors = useColors();
  const { user, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [resyncing, setResyncing] = useState(false);
  const sync = useSyncStatus();

  // Force Resync: re-marks every queued entry as pending and drains.
  // Used when the queue is stuck on a transient server issue and the tech
  // wants to retry everything at once.
  const onForceResync = async () => {
    if (resyncing) return;
    setResyncing(true);
    try {
      await markAllPending();
      await drainQueue();
    } finally {
      setResyncing(false);
    }
  };

  const onDiscardEntry = (id: string, label: string) => {
    Alert.alert(
      "Discard change?",
      `"${label}" will be removed from the queue and won't sync. This can't be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => {
            discardEntry(id).catch(() => undefined);
          },
        },
      ],
    );
  };

  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(" ");
  const displayName = fullName || user?.username || "Signed in";
  const roleLabel = user?.role ? ROLE_LABELS[user.role] ?? user.role : null;

  const appVersion =
    (Constants.expoConfig?.version as string | undefined) ||
    (Constants.manifest as { version?: string } | null)?.version ||
    "—";

  const onSignOutPress = () => {
    if (signingOut) return;
    const doSignOut = async () => {
      setSigningOut(true);
      try {
        await signOut();
      } finally {
        setSigningOut(false);
      }
    };
    if (Platform.OS === "web") {
      void doSignOut();
      return;
    }
    Alert.alert("Sign out?", "You'll need to sign in again to view your work orders.", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => void doSignOut() },
    ]);
  };

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: colors.background }]}
      edges={["top", "left", "right"]}
    >
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={[styles.heading, { color: colors.foreground }]}>Profile</Text>

        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: colors.radius,
            },
          ]}
        >
          <View style={styles.avatarRow}>
            <View
              style={[
                styles.avatar,
                {
                  backgroundColor: colors.primary,
                  borderRadius: 999,
                },
              ]}
            >
              <Text style={[styles.avatarText, { color: colors.primaryForeground }]}>
                {displayName.slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <View style={styles.nameWrap}>
              <Text
                style={[styles.name, { color: colors.foreground }]}
                numberOfLines={1}
              >
                {displayName}
              </Text>
              {roleLabel ? (
                <Text style={[styles.role, { color: colors.mutedForeground }]}>
                  {roleLabel}
                </Text>
              ) : null}
            </View>
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <Row label="Username" value={user?.username ?? "—"} colors={colors} />
          {user?.email ? (
            <Row label="Email" value={user.email} colors={colors} />
          ) : null}
          {user?.companyName ? (
            <Row label="Company" value={user.companyName} colors={colors} />
          ) : user?.companyId != null ? (
            <Row label="Company" value={`#${user.companyId}`} colors={colors} />
          ) : null}
          <Row label="App version" value={appVersion} colors={colors} />
        </View>

        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: colors.radius,
            },
          ]}
        >
          <Text style={[styles.sectionHeading, { color: colors.foreground }]}>
            Sync
          </Text>
          <SyncStatusSummary />
          <Pressable
            onPress={onForceResync}
            disabled={resyncing || sync.total === 0}
            accessibilityRole="button"
            accessibilityLabel="Force resync now"
            style={({ pressed }) => [
              styles.resyncButton,
              {
                borderColor: colors.primary,
                borderRadius: colors.radius - 4,
                opacity:
                  sync.total === 0
                    ? 0.5
                    : resyncing
                      ? 0.6
                      : pressed
                        ? 0.85
                        : 1,
              },
            ]}
          >
            {resyncing ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <>
                <Feather name="refresh-cw" size={14} color={colors.primary} />
                <Text style={[styles.resyncText, { color: colors.primary }]}>
                  Force resync now
                </Text>
              </>
            )}
          </Pressable>

          {sync.entries.length > 0 ? (
            <View style={styles.entriesWrap}>
              {sync.entries.map((e) => {
                const tone =
                  e.status === "conflict"
                    ? "#b45309"
                    : e.status === "failed"
                      ? "#991b1b"
                      : "#854d0e";
                const statusLabel =
                  e.status === "pending"
                    ? sync.online
                      ? "Pending"
                      : "Waiting for connection"
                    : e.status === "conflict"
                      ? "Conflict"
                      : "Failed";
                return (
                  <View
                    key={e.id}
                    style={[
                      styles.entryRow,
                      { borderColor: colors.border },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[styles.entryLabel, { color: colors.foreground }]}
                        numberOfLines={1}
                      >
                        {e.label}
                      </Text>
                      <Text style={[styles.entryMeta, { color: tone }]}>
                        {statusLabel}
                        {e.attempts > 0 ? ` · ${e.attempts} attempt${e.attempts === 1 ? "" : "s"}` : ""}
                      </Text>
                      {e.lastError ? (
                        <Text
                          style={[styles.entryMeta, { color: colors.mutedForeground }]}
                          numberOfLines={2}
                        >
                          {e.lastError}
                        </Text>
                      ) : null}
                    </View>
                    <Pressable
                      onPress={() => onDiscardEntry(e.id, e.label)}
                      accessibilityRole="button"
                      accessibilityLabel={`Discard ${e.label}`}
                      hitSlop={8}
                      style={({ pressed }) => [
                        styles.discardButton,
                        { opacity: pressed ? 0.7 : 1 },
                      ]}
                    >
                      <Feather name="x" size={16} color={colors.destructive} />
                    </Pressable>
                  </View>
                );
              })}
            </View>
          ) : null}
        </View>

        <Pressable
          onPress={onSignOutPress}
          disabled={signingOut}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.signOutButton,
            {
              borderColor: colors.destructive,
              borderRadius: colors.radius - 4,
              opacity: signingOut ? 0.6 : pressed ? 0.85 : 1,
            },
          ]}
        >
          {signingOut ? (
            <ActivityIndicator color={colors.destructive} />
          ) : (
            <Text style={[styles.signOutText, { color: colors.destructive }]}>
              Sign out
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
      <Text
        style={[styles.rowValue, { color: colors.foreground }]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { padding: 20, gap: 20, paddingBottom: 40 },
  sectionHeading: { fontSize: 16, fontWeight: "700", marginBottom: 4 },
  resyncButton: {
    marginTop: 12,
    paddingVertical: 10,
    borderWidth: 1.5,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  resyncText: { fontSize: 14, fontWeight: "600" },
  entriesWrap: { marginTop: 12, gap: 8 },
  entryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
  },
  entryLabel: { fontSize: 14, fontWeight: "600" },
  entryMeta: { fontSize: 12, marginTop: 2 },
  discardButton: { padding: 6 },
  heading: { fontSize: 28, fontWeight: "700", marginTop: 4 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 4,
  },
  avatarRow: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 4 },
  avatar: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 22, fontWeight: "700" },
  nameWrap: { flex: 1 },
  name: { fontSize: 18, fontWeight: "600" },
  role: { fontSize: 13, marginTop: 2 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 12 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    gap: 16,
  },
  rowLabel: { fontSize: 14 },
  rowValue: { fontSize: 14, fontWeight: "500", flexShrink: 1, textAlign: "right" },
  signOutButton: {
    borderWidth: 1.5,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  signOutText: { fontSize: 16, fontWeight: "600" },
});
