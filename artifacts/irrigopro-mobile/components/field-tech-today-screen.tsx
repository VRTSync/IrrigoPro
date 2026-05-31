import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useMemo } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { LoadingScreen } from "@/components/Loading";
import { SyncStatusPill } from "@/components/SyncStatusPill";
import { useColors } from "@/hooks/useColors";
import { apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { drainQueue } from "@/lib/sync/engine";
import { friendlyErrorMessage } from "@/lib/toast";

type WorkOrder = {
  id: number;
  workOrderNumber: string;
  customerName: string;
  projectName: string;
  projectAddress: string | null;
  branchName: string | null;
  status: string;
  priority: string;
  scheduledDate: string | null;
  assignedTechnicianId: number | null;
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  assigned: "Assigned",
  in_progress: "In progress",
  work_completed: "Completed",
  pending_manager_review: "Awaiting review",
  approved_passed_to_billing: "Approved",
  billed: "Billed",
  cancelled: "Cancelled",
};

function isToday(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function formatTime(iso: string | null): string {
  if (!iso) return "No time set";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "No time set";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatTodayHeader(): string {
  return new Date().toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function FieldTechTodayScreen() {
  const colors = useColors();
  const router = useRouter();
  const { user } = useAuth();

  const techId = user?.id;

  const onPullRefresh = React.useCallback(() => {
    drainQueue().catch(() => undefined);
    return refetchRef.current?.();
  }, []);

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ["work-orders", "by-technician", techId],
    enabled: typeof techId === "number",
    queryFn: () =>
      apiRequest<WorkOrder[]>(`/api/work-orders?technician=${techId}`),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  const refetchRef = React.useRef(refetch);
  React.useEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);

  const todayOrders = useMemo<WorkOrder[]>(() => {
    if (!Array.isArray(data)) return [];
    const filtered = data.filter((wo) => isToday(wo.scheduledDate));
    return filtered.sort((a, b) => {
      const ta = a.scheduledDate ? new Date(a.scheduledDate).getTime() : Infinity;
      const tb = b.scheduledDate ? new Date(b.scheduledDate).getTime() : Infinity;
      return ta - tb;
    });
  }, [data]);

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

      {isLoading ? (
        <LoadingScreen />
      ) : isError ? (
        <View style={styles.center}>
          <Feather name="alert-circle" size={32} color={colors.destructive} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            Couldn't load work orders
          </Text>
          <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
            {friendlyErrorMessage(error)}
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
      ) : todayOrders.length === 0 ? (
        <FlatList
          data={[] as WorkOrder[]}
          keyExtractor={() => ""}
          renderItem={() => null}
          contentContainerStyle={styles.emptyList}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={onPullRefresh}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Feather name="check-circle" size={32} color={colors.accent} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                Nothing scheduled
              </Text>
              <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
                You don't have any work orders for today.
              </Text>
            </View>
          }
        />
      ) : (
        <FlatList
          data={todayOrders}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <WorkOrderCard
              wo={item}
              onPress={() =>
                router.push({
                  pathname: "/work-order/[id]",
                  params: { id: String(item.id) },
                })
              }
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={onPullRefresh}
              tintColor={colors.primary}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

function WorkOrderCard({ wo, onPress }: { wo: WorkOrder; onPress: () => void }) {
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
          #{wo.workOrderNumber}
        </Text>
        <View
          style={[
            styles.statusPill,
            { backgroundColor: colors.secondary, borderRadius: 999 },
          ]}
        >
          <Text style={[styles.statusText, { color: colors.secondaryForeground }]}>
            {STATUS_LABELS[wo.status] ?? wo.status}
          </Text>
        </View>
      </View>
      <Text style={[styles.customer, { color: colors.foreground }]} numberOfLines={1}>
        {wo.customerName}
      </Text>
      {wo.projectName ? (
        <Text style={[styles.project, { color: colors.foreground }]} numberOfLines={2}>
          {wo.projectName}
        </Text>
      ) : null}
      {wo.projectAddress ? (
        <View style={styles.metaRow}>
          <Feather name="map-pin" size={14} color={colors.mutedForeground} />
          <Text
            style={[styles.metaText, { color: colors.mutedForeground }]}
            numberOfLines={2}
          >
            {wo.projectAddress}
            {wo.branchName ? ` · ${wo.branchName}` : ""}
          </Text>
        </View>
      ) : wo.branchName ? (
        <View style={styles.metaRow}>
          <Feather name="map-pin" size={14} color={colors.mutedForeground} />
          <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
            {wo.branchName}
          </Text>
        </View>
      ) : null}
      <View style={styles.metaRow}>
        <Feather name="clock" size={14} color={colors.mutedForeground} />
        <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
          {formatTime(wo.scheduledDate)}
        </Text>
      </View>
    </Pressable>
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
  project: { fontSize: 14 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  metaText: { fontSize: 13, flexShrink: 1 },
});
