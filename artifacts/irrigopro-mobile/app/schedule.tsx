import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ActionBoardBudgetMeter } from "@/components/ActionBoardBudgetMeter";
import { SyncStatusPill } from "@/components/SyncStatusPill";
import { useColors } from "@/hooks/useColors";
import {
  canViewActionBoard,
  formatCurrency,
  formatDoNotExceed,
  formatWetCheck,
  formatWorkOrders,
  groupActionBoardRows,
  resolveBoardViewState,
  summaryForBoard,
  type ActionBoardLane,
  type ActionBoardResponse,
  type ActionBoardRow,
} from "@/lib/action-board";
import { apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useSyncStatus } from "@/lib/sync/use-sync-status";

type Filter = "all" | "clear" | "blocked";

const LANE_META: Record<
  ActionBoardLane,
  { title: string; subtitle: string; icon: React.ComponentProps<typeof Feather>["name"] }
> = {
  clear_to_send: {
    title: "Clear to send",
    subtitle: "Work is ready and budget or approval is available.",
    icon: "check-circle",
  },
  over_budget_nothing_approved: {
    title: "Over budget · nothing approved",
    subtitle: "Work is waiting, but it is not clear to send.",
    icon: "alert-triangle",
  },
  nothing_pending: {
    title: "Nothing pending",
    subtitle: "No open work is waiting at these properties.",
    icon: "pause-circle",
  },
};

function formatBoardDate(): string {
  const date = new Date();
  const label = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
  const weeksLeft = Math.max(0, Math.ceil(
    (new Date(date.getFullYear(), 10, 1).getTime() - date.getTime()) / (7 * 86_400_000),
  ));
  return `${label} · ${weeksLeft} weeks left in season`;
}

function StateMessage({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  const colors = useColors();
  return (
    <View style={[styles.stateCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Feather name="calendar" size={24} color={colors.primary} />
      <Text style={[styles.stateTitle, { color: colors.foreground }]}>{title}</Text>
      <Text style={[styles.stateBody, { color: colors.mutedForeground }]}>{body}</Text>
    </View>
  );
}

function PropertyRow({
  row,
  lane,
}: {
  row: ActionBoardRow;
  lane: ActionBoardLane;
}) {
  const colors = useColors();
  const laneColor =
    lane === "clear_to_send"
      ? colors.accent
      : lane === "over_budget_nothing_approved"
        ? colors.destructive
        : colors.mutedForeground;
  return (
    <View
      testID={`action-board-row-${row.customerId}`}
      style={[
        styles.row,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderLeftColor: laneColor,
          borderRadius: colors.radius,
        },
      ]}
    >
      <View style={styles.rowHeading}>
        <Text style={[styles.propertyName, { color: colors.foreground }]} numberOfLines={2}>
          {row.customerName}
        </Text>
        <Text style={[styles.dne, { color: colors.foreground }]}>
          {formatDoNotExceed(row.headroom)}
        </Text>
      </View>
      <Text style={[styles.detail, { color: colors.mutedForeground }]}>
        {formatWorkOrders(row)}
      </Text>
      <Text style={[styles.detail, { color: colors.mutedForeground }]}>
        {formatWetCheck(row)}
      </Text>
      <ActionBoardBudgetMeter row={row} />
    </View>
  );
}

function LaneSection({
  lane,
  rows,
}: {
  lane: ActionBoardLane;
  rows: ActionBoardRow[];
}) {
  const colors = useColors();
  if (rows.length === 0) return null;
  const meta = LANE_META[lane];
  return (
    <View style={styles.lane}>
      <View style={styles.laneHeading}>
        <Feather name={meta.icon} size={16} color={colors.primary} />
        <View style={styles.laneHeadingText}>
          <Text style={[styles.laneTitle, { color: colors.foreground }]}>
            {meta.title} · {rows.length}
          </Text>
          <Text style={[styles.laneSubtitle, { color: colors.mutedForeground }]}>
            {meta.subtitle}
          </Text>
        </View>
      </View>
      {rows.map((row) => (
        <PropertyRow key={String(row.customerId)} row={row} lane={lane} />
      ))}
    </View>
  );
}

export default function ScheduleScreen() {
  const colors = useColors();
  const router = useRouter();
  const { user } = useAuth();
  const { online } = useSyncStatus();
  const [filter, setFilter] = React.useState<Filter>("all");
  const [selectedCompany, setSelectedCompany] = React.useState("");
  const allowed = canViewActionBoard(user?.role);
  const explicitCompanyId = Number(selectedCompany);
  const companyId = user?.role === "super_admin"
    ? (Number.isInteger(explicitCompanyId) && explicitCompanyId > 0 ? explicitCompanyId : user.companyId)
    : null;
  const url = companyId != null ? `/api/action-board?companyId=${companyId}` : "/api/action-board";
  const query = useQuery({
    queryKey: [url],
    queryFn: () => apiRequest<ActionBoardResponse>(url),
    staleTime: 30_000,
    refetchInterval: 60_000,
    enabled: allowed && (user?.role !== "super_admin" || companyId != null),
  });

  if (!allowed) {
    return (
      <View style={[styles.screen, styles.centered, { backgroundColor: colors.background }]}>
        <StateMessage
          title="Manager access required"
          body="The Action Board is available only to irrigation managers and administrators."
        />
        <Pressable onPress={() => router.replace("/")} style={styles.textButton}>
          <Text style={{ color: colors.primary, fontWeight: "600" }}>Return to Today</Text>
        </Pressable>
      </View>
    );
  }
  if (user?.role === "super_admin" && companyId == null) {
    return (
      <View style={[styles.screen, styles.centered, { backgroundColor: colors.background }]}>
        <StateMessage title="Company required" body="Enter a company ID to view its Action Board." />
        <TextInput
          testID="action-board-company-id"
          keyboardType="number-pad"
          value={selectedCompany}
          onChangeText={setSelectedCompany}
          placeholder="Company ID"
          placeholderTextColor={colors.mutedForeground}
          style={[styles.companyInput, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
        />
      </View>
    );
  }

  if (query.isPending && !query.data && online) {
    return (
      <View style={[styles.screen, styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={{ color: colors.mutedForeground }}>Loading today's board…</Text>
      </View>
    );
  }

  const state = resolveBoardViewState({
    data: query.data,
    online,
    isError: query.isError,
  });
  const rows = query.data?.rows ?? [];
  const grouped = groupActionBoardRows(rows);
  const summary = summaryForBoard(rows);
  const canOpenPlan = state === "ready";

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.foreground }]}>Action Board</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {formatBoardDate()}
          </Text>
        </View>
        <SyncStatusPill />
      </View>
      {user?.role === "super_admin" && (
        <TextInput
          testID="action-board-company-id"
          keyboardType="number-pad"
          value={selectedCompany}
          onChangeText={setSelectedCompany}
          placeholder={`Company ID${companyId != null ? ` · ${companyId}` : ""}`}
          placeholderTextColor={colors.mutedForeground}
          style={[styles.companyInput, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
        />
      )}

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {state === "offline-no-cache" ? (
          <StateMessage
            title="No cached plan yet"
            body="Connect to the internet once to load today's Action Board. Last-known data is available offline after it has been loaded."
          />
        ) : state === "error" ? (
          <StateMessage
            title="Action Board could not load"
            body="The board is unavailable right now. Check your connection and try again."
          />
        ) : state === "no-allocations" ? (
          <StateMessage
            title="Budget goals are not set"
            body="No customers have a monthly allocation. Set budget goals on customer profiles to build today's plan."
          />
        ) : state === "empty" ? (
          <StateMessage
            title="No properties on the board"
            body="There is no Action Board data for the current month."
          />
        ) : (
          <>
            <View
              style={[
                styles.summary,
                { backgroundColor: colors.primary, borderRadius: colors.radius },
              ]}
            >
              <Text style={[styles.summaryEyebrow, { color: colors.primaryForeground }]}>
                Clear to send today
              </Text>
              <Text style={[styles.summaryCount, { color: colors.primaryForeground }]}>
                {summary.clear} {summary.clear === 1 ? "property" : "properties"}
              </Text>
              <Text style={[styles.summaryDetail, { color: colors.primaryForeground }]}>
                {summary.inspectionOnly} inspection only · {summary.checksDue} checks due
                {query.data?.rollup
                  ? ` · ${formatCurrency(Math.max(0, query.data.rollup.seasonPaceTarget - query.data.rollup.seasonPaceSpend))} behind pace`
                  : ""}
              </Text>
            </View>

            <View style={styles.chips}>
              {(
                [
                  ["all", `All ${summary.total}`],
                  ["clear", `Clear ${summary.clear}`],
                  ["blocked", `Blocked ${summary.blocked}`],
                ] as const
              ).map(([value, label]) => {
                const selected = filter === value;
                return (
                  <Pressable
                    key={value}
                    testID={`action-board-filter-${value}`}
                    onPress={() => setFilter(value)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: selected ? colors.primary : colors.card,
                        borderColor: selected ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        color: selected ? colors.primaryForeground : colors.foreground,
                        fontSize: 13,
                        fontWeight: "600",
                      }}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {(filter === "all" || filter === "clear") && (
              <LaneSection lane="clear_to_send" rows={grouped.clear_to_send} />
            )}
            {(filter === "all" || filter === "blocked") && (
              <LaneSection lane="over_budget_nothing_approved" rows={grouped.over_budget_nothing_approved} />
            )}
            {filter === "all" && <LaneSection lane="nothing_pending" rows={grouped.nothing_pending} />}
          </>
        )}
      </ScrollView>
      {canOpenPlan && (
        <Pressable
          testID="action-board-open-plan"
          onPress={() => router.push({
            pathname: "/schedule-plan",
            params: companyId != null ? { companyId: String(companyId) } : {},
          })}
          style={[styles.planButton, { backgroundColor: colors.primary, borderRadius: colors.radius }]}
        >
          <Feather name="copy" color={colors.primaryForeground} size={17} />
          <Text style={{ color: colors.primaryForeground, fontWeight: "700" }}>Copy today's plan</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { alignItems: "center", justifyContent: "center", padding: 20, gap: 12 },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  headerText: { flex: 1 },
  title: { fontSize: 22, fontWeight: "700" },
  subtitle: { fontSize: 12, marginTop: 2 },
  content: { padding: 14, paddingBottom: 40, gap: 16 },
  summary: { padding: 18, gap: 4 },
  summaryEyebrow: { fontSize: 12, fontWeight: "600", opacity: 0.85 },
  summaryCount: { fontSize: 25, fontWeight: "700" },
  summaryDetail: { fontSize: 12, lineHeight: 18, opacity: 0.9 },
  chips: { flexDirection: "row", gap: 8 },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  lane: { gap: 9 },
  laneHeading: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingHorizontal: 2 },
  laneHeadingText: { flex: 1 },
  laneTitle: { fontSize: 15, fontWeight: "700" },
  laneSubtitle: { fontSize: 11, lineHeight: 16, marginTop: 1 },
  row: {
    borderWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 4,
    paddingHorizontal: 12,
    paddingVertical: 11,
    gap: 6,
  },
  rowHeading: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  propertyName: { flex: 1, fontSize: 14, fontWeight: "700" },
  dne: { fontSize: 12, fontWeight: "700" },
  detail: { fontSize: 12 },
  stateCard: {
    width: "100%",
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    padding: 24,
    gap: 8,
    borderRadius: 14,
  },
  stateTitle: { fontSize: 17, fontWeight: "700", textAlign: "center" },
  stateBody: { fontSize: 13, lineHeight: 19, textAlign: "center" },
  textButton: { padding: 10 },
  companyInput: { marginHorizontal: 14, marginTop: 10, borderWidth: 1, borderRadius: 8, padding: 10 },
  planButton: { marginHorizontal: 14, marginBottom: 14, padding: 15, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
});