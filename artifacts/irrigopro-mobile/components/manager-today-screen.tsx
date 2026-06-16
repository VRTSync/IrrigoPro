import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { SyncStatusPill } from "@/components/SyncStatusPill";
import { useColors } from "@/hooks/useColors";
import { apiRequest } from "@/lib/api";

interface StatusStrip {
  indicators: {
    wcsPendingReview: number;
    wosAwaitingApproval: number;
    approvedThisWeek: number;
  };
  oldestAgeHours: {
    wcsPendingReview: number | null;
    wosAwaitingApproval: number | null;
  };
}

function formatTodayHeader(): string {
  return new Date().toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function subtitleForAge(hours: number | null): string {
  if (hours === null) return "";
  if (hours < 1) return "Oldest: < 1h ago";
  if (hours < 24) return `Oldest: ${Math.round(hours)}h ago`;
  const days = Math.floor(hours / 24);
  return `Oldest: ${days}d ago`;
}

type FieldActionConfig = {
  label: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  route: string;
};

const FIELD_ACTIONS: FieldActionConfig[] = [
  { label: "Start wet check", icon: "droplet", route: "/wet-check/new" },
  { label: "Create work order", icon: "plus-circle", route: "/work-order/new" },
  { label: "Assign tech", icon: "user-check", route: "/work-order/assign" },
  { label: "Today's schedule", icon: "calendar", route: "/schedule" },
];

function FieldActionButton({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.actionButton,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <Feather name={icon} size={24} color={colors.primary} />
      <Text style={[styles.actionButtonLabel, { color: colors.foreground }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function ActionTile({
  label,
  count,
  subtitle,
  onPress,
}: {
  label: string;
  count: number;
  subtitle: string;
  onPress: () => void;
}) {
  const colors = useColors();
  const isEmpty = count === 0;

  return (
    <Pressable
      onPress={isEmpty ? undefined : onPress}
      accessibilityRole={isEmpty ? "none" : "button"}
      accessibilityLabel={`${label}: ${count}`}
      style={({ pressed }) => [
        styles.actionTile,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
          opacity: isEmpty ? 0.45 : pressed ? 0.8 : 1,
        },
      ]}
    >
      <View style={styles.actionTileLeft}>
        <Text
          style={[
            styles.actionTileLabel,
            { color: isEmpty ? colors.mutedForeground : colors.foreground },
          ]}
        >
          {label}
        </Text>
        {subtitle ? (
          <Text style={[styles.actionTileSubtitle, { color: colors.mutedForeground }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={styles.actionTileRight}>
        <Text
          style={[
            styles.actionTileCount,
            { color: isEmpty ? colors.mutedForeground : colors.primary },
          ]}
        >
          {count}
        </Text>
        {!isEmpty && (
          <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
        )}
      </View>
    </Pressable>
  );
}

export function ManagerTodayScreen() {
  const colors = useColors();
  const router = useRouter();

  const { data } = useQuery({
    queryKey: ["/api/manager-workspace/status-strip"],
    queryFn: () => apiRequest<StatusStrip>("/api/manager-workspace/status-strip"),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const ind = data?.indicators;
  const ages = data?.oldestAgeHours;

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: colors.background }]}
      edges={["top", "left", "right"]}
    >
      <View style={styles.header}>
        <View style={styles.headerTextWrap}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            Today
          </Text>
          <Text style={[styles.headerSubtitle, { color: colors.mutedForeground }]}>
            {formatTodayHeader()}
          </Text>
        </View>
        <SyncStatusPill />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.actionsGrid}>
          {FIELD_ACTIONS.map((action) => (
            <FieldActionButton
              key={action.label}
              label={action.label}
              icon={action.icon}
              onPress={() => router.push(action.route as any)}
            />
          ))}
        </View>

        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
          Action needed
        </Text>

        <View style={styles.tilesSection}>
          <ActionTile
            label="Wet checks pending review"
            count={ind?.wcsPendingReview ?? 0}
            subtitle={subtitleForAge(ages?.wcsPendingReview ?? null)}
            onPress={() => router.push("/wet-checks" as any)}
          />
          <ActionTile
            label="WOs awaiting approval"
            count={ind?.wosAwaitingApproval ?? 0}
            subtitle={subtitleForAge(ages?.wosAwaitingApproval ?? null)}
            onPress={() => router.push("/work-orders" as any)}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerTextWrap: { flex: 1 },
  headerTitle: { fontSize: 28, fontWeight: "700" },
  headerSubtitle: { fontSize: 14, marginTop: 2 },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 100,
    gap: 16,
  },
  actionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  actionButton: {
    width: "47%",
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    alignItems: "center",
    gap: 8,
  },
  actionButtonLabel: {
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginTop: 4,
  },
  tilesSection: { gap: 10 },
  actionTile: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  actionTileLeft: { flex: 1, gap: 2 },
  actionTileLabel: { fontSize: 15, fontWeight: "600" },
  actionTileSubtitle: { fontSize: 12 },
  actionTileRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginLeft: 12,
  },
  actionTileCount: { fontSize: 22, fontWeight: "700" },
});
