import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useMemo } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

type WetCheckListItem = {
  id: number;
  customerId: number;
  customerName: string;
  propertyAddress: string | null;
  status: string;
  numControllers: number;
  zoneCount: number;
  workOrderIds: number[];
  startedAt: string | null;
  submittedAt: string | null;
  technicianId: number | null;
};

const STATUS_LABELS: Record<string, string> = {
  in_progress: "In progress",
  submitted: "Submitted",
  approved: "Approved",
  partially_converted: "Partially converted",
  converted: "Converted",
};

export const wetChecksOpenQueryKey = (techId: number | undefined) =>
  ["wet-checks", "open", techId] as const;

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

export default function WetChecksScreen() {
  const colors = useColors();
  const router = useRouter();
  const { user } = useAuth();
  const techId = user?.id;

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: wetChecksOpenQueryKey(techId),
    enabled: typeof techId === "number",
    queryFn: () =>
      apiRequest<WetCheckListItem[]>(
        `/api/wet-checks?mine=1&status=in_progress`,
      ),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  const items = useMemo<WetCheckListItem[]>(() => {
    if (!Array.isArray(data)) return [];
    return [...data].sort((a, b) => {
      const ta = a.startedAt ? new Date(a.startedAt).getTime() : 0;
      const tb = b.startedAt ? new Date(b.startedAt).getTime() : 0;
      return tb - ta;
    });
  }, [data]);

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: colors.background }]}
      edges={["top", "left", "right"]}
    >
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>
          Wet Checks
        </Text>
        <Text style={[styles.headerSubtitle, { color: colors.mutedForeground }]}>
          Open inspections assigned to you
        </Text>
      </View>

      {techId == null || isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <Feather name="alert-circle" size={32} color={colors.destructive} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            Couldn't load wet checks
          </Text>
          <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
            {error instanceof Error ? error.message : "Something went wrong."}
          </Text>
          <Pressable
            onPress={() => refetch()}
            style={({ pressed }) => [
              styles.retryButton,
              {
                backgroundColor: colors.primary,
                borderRadius: colors.radius - 4,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Text style={[styles.retryText, { color: colors.primaryForeground }]}>
              Try again
            </Text>
          </Pressable>
        </View>
      ) : items.length === 0 ? (
        <FlatList
          data={[] as WetCheckListItem[]}
          keyExtractor={() => ""}
          renderItem={() => null}
          contentContainerStyle={styles.emptyList}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Feather name="droplet" size={32} color={colors.accent} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                No open wet checks
              </Text>
              <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
                You don't have any wet checks in progress.
              </Text>
            </View>
          }
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <WetCheckCard
              wc={item}
              onPress={() =>
                router.push({
                  pathname: "/wet-check/[id]",
                  params: { id: String(item.id) },
                })
              }
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

function WetCheckCard({
  wc,
  onPress,
}: {
  wc: WetCheckListItem;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={styles.cardTopRow}>
        <Text
          style={[styles.cardNumber, { color: colors.mutedForeground }]}
          numberOfLines={1}
        >
          WC #{wc.id}
        </Text>
        <View
          style={[
            styles.statusPill,
            { backgroundColor: colors.secondary, borderRadius: 999 },
          ]}
        >
          <Text style={[styles.statusText, { color: colors.secondaryForeground }]}>
            {STATUS_LABELS[wc.status] ?? wc.status}
          </Text>
        </View>
      </View>
      <Text
        style={[styles.customer, { color: colors.foreground }]}
        numberOfLines={1}
      >
        {wc.customerName}
      </Text>
      {wc.propertyAddress ? (
        <View style={styles.metaRow}>
          <Feather name="map-pin" size={14} color={colors.mutedForeground} />
          <Text
            style={[styles.metaText, { color: colors.mutedForeground }]}
            numberOfLines={2}
          >
            {wc.propertyAddress}
          </Text>
        </View>
      ) : null}
      <View style={styles.metaRow}>
        <Feather name="grid" size={14} color={colors.mutedForeground} />
        <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
          {wc.zoneCount} {wc.zoneCount === 1 ? "zone" : "zones"} ·{" "}
          {wc.numControllers}{" "}
          {wc.numControllers === 1 ? "controller" : "controllers"}
          {wc.startedAt ? ` · started ${formatDate(wc.startedAt)}` : ""}
        </Text>
      </View>
      {wc.workOrderIds.length > 0 ? (
        <View style={styles.metaRow}>
          <Feather name="link" size={14} color={colors.mutedForeground} />
          <Text
            style={[styles.metaText, { color: colors.mutedForeground }]}
            numberOfLines={1}
          >
            {wc.workOrderIds.length === 1
              ? `Work order #${wc.workOrderIds[0]}`
              : `Work orders ${wc.workOrderIds
                  .map((id) => `#${id}`)
                  .join(", ")}`}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
  },
  headerTitle: { fontSize: 28, fontWeight: "700" },
  headerSubtitle: { fontSize: 14, marginTop: 2 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 32,
  },
  emptyTitle: { fontSize: 18, fontWeight: "600", marginTop: 8 },
  emptyBody: { fontSize: 14, textAlign: "center", maxWidth: 280 },
  emptyList: { flexGrow: 1, paddingBottom: 80 },
  retryButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    marginTop: 12,
  },
  retryText: { fontSize: 15, fontWeight: "600" },
  list: { paddingHorizontal: 16, paddingBottom: 100, gap: 12 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 6,
  },
  cardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardNumber: { fontSize: 12, fontWeight: "600", letterSpacing: 0.4 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontSize: 12, fontWeight: "600" },
  customer: { fontSize: 17, fontWeight: "600", marginTop: 4 },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  metaText: { fontSize: 13, flexShrink: 1 },
});
