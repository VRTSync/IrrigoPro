import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  ToastAndroid,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { apiRequest } from "@/lib/api";

type WorkOrder = {
  id: number;
  workOrderNumber: string;
  customerId: number | null;
  customerName: string;
  customerPhone: string | null;
  projectName: string;
  projectAddress: string | null;
  branchName: string | null;
  status: string;
  priority: string;
  scheduledDate: string | null;
  startedAt: string | null;
  completedAt: string | null;
  description: string | null;
  specialInstructions: string | null;
  accessInstructions: string | null;
  locationNotes: string | null;
  notes: string | null;
  workLocationLat: string | null;
  workLocationLng: string | null;
  workLocationAddress: string | null;
};

type WetCheck = {
  id: number;
  customerId: number;
  customerName: string;
  status: string;
  startedAt: string | null;
  submittedAt: string | null;
};

type BillingSheet = {
  id: number;
  billingNumber: string;
  status: string;
  workDate: string | null;
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

export const workOrderQueryKey = (id: number) => ["work-order", id] as const;
export const workOrderBillingSheetQueryKey = (id: number) =>
  ["work-order", id, "billing-sheet"] as const;
export const workOrderWetChecksQueryKey = (id: number) =>
  ["work-order", id, "wet-checks"] as const;

function showToast(message: string) {
  if (Platform.OS === "android") {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  } else {
    Alert.alert("", message);
  }
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "Not scheduled";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Not scheduled";
  return d.toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function openMaps(wo: WorkOrder) {
  const lat = wo.workLocationLat ? Number(wo.workLocationLat) : null;
  const lng = wo.workLocationLng ? Number(wo.workLocationLng) : null;
  const label = encodeURIComponent(wo.customerName || wo.projectName || "Job");
  let url: string;
  if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
    url =
      Platform.OS === "ios"
        ? `http://maps.apple.com/?ll=${lat},${lng}&q=${label}`
        : `geo:${lat},${lng}?q=${lat},${lng}(${label})`;
  } else {
    const addr = wo.workLocationAddress || wo.projectAddress;
    if (!addr) return;
    const q = encodeURIComponent(addr);
    url =
      Platform.OS === "ios"
        ? `http://maps.apple.com/?q=${q}`
        : `geo:0,0?q=${q}`;
  }
  Linking.openURL(url).catch(() => {
    showToast("Couldn't open maps");
  });
}

function openDial(phone: string) {
  const cleaned = phone.replace(/[^\d+]/g, "");
  if (!cleaned) return;
  Linking.openURL(`tel:${cleaned}`).catch(() => {
    showToast("Couldn't open dialer");
  });
}

export default function WorkOrderDetailScreen() {
  const colors = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id: string }>();
  const id = useMemo(() => {
    const n = Number(params.id);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [params.id]);

  const {
    data: wo,
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: id != null ? workOrderQueryKey(id) : ["work-order", "missing"],
    enabled: id != null,
    queryFn: () => apiRequest<WorkOrder>(`/api/work-orders/${id}`),
  });

  // Wet checks attached to this work order via
  // wet_check_findings.work_order_id (the canonical schema link).
  const wetChecksQuery = useQuery({
    queryKey: id != null ? workOrderWetChecksQueryKey(id) : ["wo-wc", "missing"],
    enabled: id != null,
    queryFn: () =>
      apiRequest<WetCheck[]>(`/api/work-orders/${id}/wet-checks`),
  });
  useEffect(() => {
    if (wetChecksQuery.isError) {
      showToast(
        wetChecksQuery.error instanceof Error
          ? `Failed to load wet checks: ${wetChecksQuery.error.message}`
          : "Failed to load wet checks",
      );
    }
  }, [wetChecksQuery.isError, wetChecksQuery.error]);

  // Billing sheets attached to this work order via the canonical
  // billing_sheets.work_order_id link populated by the conversion
  // endpoint.
  const billingSheetsQuery = useQuery({
    queryKey: id != null ? workOrderBillingSheetQueryKey(id) : ["wo-bs", "missing"],
    enabled: id != null,
    queryFn: () =>
      apiRequest<BillingSheet[]>(`/api/work-orders/${id}/billing-sheets`),
  });
  useEffect(() => {
    if (billingSheetsQuery.isError) {
      showToast(
        billingSheetsQuery.error instanceof Error
          ? `Failed to load billing sheets: ${billingSheetsQuery.error.message}`
          : "Failed to load billing sheets",
      );
    }
  }, [billingSheetsQuery.isError, billingSheetsQuery.error]);

  const invalidateWorkOrder = useCallback(() => {
    if (id == null) return;
    queryClient.invalidateQueries({ queryKey: workOrderQueryKey(id) });
    queryClient.invalidateQueries({ queryKey: ["work-orders"] });
  }, [id, queryClient]);

  const startMutation = useMutation({
    mutationFn: () =>
      apiRequest<WorkOrder>(`/api/work-orders/${id}`, {
        method: "PATCH",
        body: { status: "in_progress", startedAt: new Date().toISOString() },
      }),
    onSuccess: () => {
      showToast("Work started");
      invalidateWorkOrder();
    },
    onError: (err) => {
      showToast(err instanceof Error ? err.message : "Couldn't start work");
    },
  });

  const completeMutation = useMutation({
    mutationFn: () =>
      apiRequest<WorkOrder>(`/api/work-orders/${id}/complete`, {
        method: "POST",
        body: {},
      }),
    onSuccess: () => {
      showToast("Marked complete");
      invalidateWorkOrder();
    },
    onError: (err) => {
      showToast(err instanceof Error ? err.message : "Couldn't complete work");
    },
  });

  const onStart = useCallback(() => {
    Alert.alert(
      "Start work?",
      "This will mark the work order as in progress.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Start", onPress: () => startMutation.mutate() },
      ],
    );
  }, [startMutation]);

  const onComplete = useCallback(() => {
    Alert.alert(
      "Mark complete?",
      "This sends the work order to your manager for review. You won't be able to make further changes until it's reviewed.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Mark complete",
          style: "destructive",
          onPress: () => completeMutation.mutate(),
        },
      ],
    );
  }, [completeMutation]);

  const headerTitle = wo ? `#${wo.workOrderNumber}` : "Work order";

  return (
    <>
      <Stack.Screen
        options={{
          title: headerTitle,
          headerStyle: { backgroundColor: colors.background },
          headerTitleStyle: { color: colors.foreground },
          headerTintColor: colors.primary,
        }}
      />
      <SafeAreaView
        style={[styles.safe, { backgroundColor: colors.background }]}
        edges={["left", "right", "bottom"]}
      >
        {id == null ? (
          <View style={styles.center}>
            <Text style={[styles.errorTitle, { color: colors.foreground }]}>
              Invalid work order
            </Text>
            <Pressable
              onPress={() => router.back()}
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
                Go back
              </Text>
            </Pressable>
          </View>
        ) : isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : isError || !wo ? (
          <View style={styles.center}>
            <Feather name="alert-circle" size={32} color={colors.destructive} />
            <Text style={[styles.errorTitle, { color: colors.foreground }]}>
              Couldn't load work order
            </Text>
            <Text style={[styles.errorBody, { color: colors.mutedForeground }]}>
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
        ) : (
          <ScrollView
            contentContainerStyle={styles.scroll}
            refreshControl={
              <RefreshControl
                refreshing={isRefetching}
                onRefresh={() => {
                  refetch();
                  wetChecksQuery.refetch();
                  billingSheetsQuery.refetch();
                }}
                tintColor={colors.primary}
              />
            }
          >
            <Header wo={wo} colors={colors} />

            <Section title="Details" colors={colors}>
              <DetailRow
                label="Scheduled"
                value={formatDateTime(wo.scheduledDate)}
                colors={colors}
              />
              {wo.startedAt ? (
                <DetailRow
                  label="Started"
                  value={formatDateTime(wo.startedAt)}
                  colors={colors}
                />
              ) : null}
              {wo.completedAt ? (
                <DetailRow
                  label="Completed"
                  value={formatDateTime(wo.completedAt)}
                  colors={colors}
                />
              ) : null}
              {wo.branchName ? (
                <DetailRow label="Branch" value={wo.branchName} colors={colors} />
              ) : null}
              {wo.priority ? (
                <DetailRow
                  label="Priority"
                  value={wo.priority.charAt(0).toUpperCase() + wo.priority.slice(1)}
                  colors={colors}
                />
              ) : null}
            </Section>

            {wo.description ? (
              <Section title="Description" colors={colors}>
                <Text style={[styles.bodyText, { color: colors.foreground }]}>
                  {wo.description}
                </Text>
              </Section>
            ) : null}

            {wo.accessInstructions ? (
              <Section title="Access instructions" colors={colors}>
                <Text style={[styles.bodyText, { color: colors.foreground }]}>
                  {wo.accessInstructions}
                </Text>
              </Section>
            ) : null}

            {wo.specialInstructions ? (
              <Section title="Special instructions" colors={colors}>
                <Text style={[styles.bodyText, { color: colors.foreground }]}>
                  {wo.specialInstructions}
                </Text>
              </Section>
            ) : null}

            {wo.locationNotes ? (
              <Section title="Location notes" colors={colors}>
                <Text style={[styles.bodyText, { color: colors.foreground }]}>
                  {wo.locationNotes}
                </Text>
              </Section>
            ) : null}

            {wo.notes ? (
              <Section title="Notes" colors={colors}>
                <Text style={[styles.bodyText, { color: colors.foreground }]}>
                  {wo.notes}
                </Text>
              </Section>
            ) : null}

            <AttachedRecords
              wetChecks={wetChecksQuery.data ?? []}
              wetChecksLoading={wetChecksQuery.isLoading}
              billingSheets={billingSheetsQuery.data ?? []}
              billingSheetsLoading={billingSheetsQuery.isLoading}
              colors={colors}
            />

            <View style={{ height: 24 }} />
          </ScrollView>
        )}

        {wo ? (
          <PrimaryActions
            wo={wo}
            colors={colors}
            isStarting={startMutation.isPending}
            isCompleting={completeMutation.isPending}
            onStart={onStart}
            onComplete={onComplete}
            onAddWetCheck={() =>
              showToast("Wet checks arrive in the next update")
            }
            onAddBillingSheet={() =>
              showToast("Billing sheets arrive in a later update")
            }
          />
        ) : null}
      </SafeAreaView>
    </>
  );
}

function Header({
  wo,
  colors,
}: {
  wo: WorkOrder;
  colors: ReturnType<typeof useColors>;
}) {
  const phone = wo.customerPhone?.trim();
  const hasMapTarget = Boolean(
    wo.workLocationAddress ||
      wo.projectAddress ||
      (wo.workLocationLat && wo.workLocationLng),
  );
  return (
    <View
      style={[
        styles.headerCard,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
        },
      ]}
    >
      <View style={styles.headerTopRow}>
        <Text
          style={[styles.headerNumber, { color: colors.mutedForeground }]}
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

      <Text style={[styles.headerCustomer, { color: colors.foreground }]}>
        {wo.customerName}
      </Text>
      {wo.projectName ? (
        <Text style={[styles.headerProject, { color: colors.foreground }]}>
          {wo.projectName}
        </Text>
      ) : null}

      <View style={styles.tapRow}>
        {hasMapTarget ? (
          <Pressable
            onPress={() => openMaps(wo)}
            style={({ pressed }) => [
              styles.tapChip,
              {
                backgroundColor: colors.secondary,
                borderRadius: colors.radius - 4,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Feather name="map-pin" size={14} color={colors.secondaryForeground} />
            <Text
              style={[styles.tapChipText, { color: colors.secondaryForeground }]}
              numberOfLines={2}
            >
              {wo.workLocationAddress || wo.projectAddress || "Open in maps"}
            </Text>
          </Pressable>
        ) : null}

        {phone ? (
          <Pressable
            onPress={() => openDial(phone)}
            style={({ pressed }) => [
              styles.tapChip,
              {
                backgroundColor: colors.secondary,
                borderRadius: colors.radius - 4,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Feather name="phone" size={14} color={colors.secondaryForeground} />
            <Text style={[styles.tapChipText, { color: colors.secondaryForeground }]}>
              {phone}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function Section({
  title,
  children,
  colors,
}: {
  title: string;
  children: React.ReactNode;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
        {title.toUpperCase()}
      </Text>
      <View
        style={[
          styles.sectionCard,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius: colors.radius,
          },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

function DetailRow({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
      <Text style={[styles.detailValue, { color: colors.foreground }]}>
        {value}
      </Text>
    </View>
  );
}

function AttachedRecords({
  wetChecks,
  wetChecksLoading,
  billingSheets,
  billingSheetsLoading,
  colors,
}: {
  wetChecks: WetCheck[];
  wetChecksLoading: boolean;
  billingSheets: BillingSheet[];
  billingSheetsLoading: boolean;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <>
      <Section title="Wet checks" colors={colors}>
        {wetChecksLoading ? (
          <Text style={[styles.emptyRowText, { color: colors.mutedForeground }]}>
            Loading…
          </Text>
        ) : wetChecks.length === 0 ? (
          <Text style={[styles.emptyRowText, { color: colors.mutedForeground }]}>
            No wet checks attached yet.
          </Text>
        ) : (
          wetChecks.map((wc) => (
            <Pressable
              key={wc.id}
              onPress={() => {
                showToast("Wet check detail arrives in a later update");
              }}
              style={({ pressed }) => [
                styles.subRow,
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.subRowTitle, { color: colors.foreground }]}>
                  Wet check #{wc.id}
                </Text>
                <Text
                  style={[styles.subRowMeta, { color: colors.mutedForeground }]}
                  numberOfLines={1}
                >
                  {STATUS_LABELS[wc.status] ?? wc.status}
                  {wc.submittedAt
                    ? ` · ${new Date(wc.submittedAt).toLocaleDateString()}`
                    : wc.startedAt
                    ? ` · started ${new Date(wc.startedAt).toLocaleDateString()}`
                    : ""}
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </Pressable>
          ))
        )}
      </Section>

      <Section title="Billing sheets" colors={colors}>
        {billingSheetsLoading ? (
          <Text style={[styles.emptyRowText, { color: colors.mutedForeground }]}>
            Loading…
          </Text>
        ) : billingSheets.length === 0 ? (
          <Text style={[styles.emptyRowText, { color: colors.mutedForeground }]}>
            No billing sheets attached yet.
          </Text>
        ) : (
          billingSheets.map((bs) => (
            <Pressable
              key={bs.id}
              onPress={() => {
                showToast("Billing sheet detail arrives in a later update");
              }}
              style={({ pressed }) => [
                styles.subRow,
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.subRowTitle, { color: colors.foreground }]}>
                  #{bs.billingNumber}
                </Text>
                <Text
                  style={[styles.subRowMeta, { color: colors.mutedForeground }]}
                  numberOfLines={1}
                >
                  {STATUS_LABELS[bs.status] ?? bs.status}
                  {bs.workDate
                    ? ` · ${new Date(bs.workDate).toLocaleDateString()}`
                    : ""}
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </Pressable>
          ))
        )}
      </Section>
    </>
  );
}

function PrimaryActions({
  wo,
  colors,
  isStarting,
  isCompleting,
  onStart,
  onComplete,
  onAddWetCheck,
  onAddBillingSheet,
}: {
  wo: WorkOrder;
  colors: ReturnType<typeof useColors>;
  isStarting: boolean;
  isCompleting: boolean;
  onStart: () => void;
  onComplete: () => void;
  onAddWetCheck: () => void;
  onAddBillingSheet: () => void;
}) {
  const status = wo.status;
  const isStartable = status === "pending" || status === "assigned";
  const isInProgress = status === "in_progress";

  if (!isStartable && !isInProgress) {
    return null;
  }

  return (
    <View
      style={[
        styles.actionBar,
        { backgroundColor: colors.card, borderTopColor: colors.border },
      ]}
    >
      {isStartable ? (
        <PrimaryButton
          label={isStarting ? "Starting…" : "Start work"}
          icon="play"
          onPress={onStart}
          disabled={isStarting}
          colors={colors}
          variant="primary"
        />
      ) : (
        <>
          <View style={styles.secondaryRow}>
            <PrimaryButton
              label="Add wet check"
              icon="droplet"
              onPress={onAddWetCheck}
              colors={colors}
              variant="secondary"
              flex
            />
            <PrimaryButton
              label="Add billing sheet"
              icon="file-text"
              onPress={onAddBillingSheet}
              colors={colors}
              variant="secondary"
              flex
            />
          </View>
          <PrimaryButton
            label={isCompleting ? "Submitting…" : "Mark complete"}
            icon="check-circle"
            onPress={onComplete}
            disabled={isCompleting}
            colors={colors}
            variant="primary"
          />
        </>
      )}
    </View>
  );
}

function PrimaryButton({
  label,
  icon,
  onPress,
  disabled,
  colors,
  variant,
  flex,
}: {
  label: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  onPress: () => void;
  disabled?: boolean;
  colors: ReturnType<typeof useColors>;
  variant: "primary" | "secondary";
  flex?: boolean;
}) {
  const bg = variant === "primary" ? colors.primary : colors.secondary;
  const fg =
    variant === "primary" ? colors.primaryForeground : colors.secondaryForeground;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.actionButton,
        {
          backgroundColor: bg,
          borderRadius: colors.radius - 4,
          opacity: disabled ? 0.6 : pressed ? 0.85 : 1,
        },
        flex ? { flex: 1 } : null,
      ]}
    >
      <Feather name={icon} size={16} color={fg} />
      <Text style={[styles.actionButtonText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 16, gap: 16 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 32,
  },
  errorTitle: { fontSize: 18, fontWeight: "600", marginTop: 8 },
  errorBody: { fontSize: 14, textAlign: "center", maxWidth: 280 },
  retryButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    marginTop: 12,
  },
  retryText: { fontSize: 15, fontWeight: "600" },

  headerCard: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 8,
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerNumber: { fontSize: 12, fontWeight: "600", letterSpacing: 0.4 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontSize: 12, fontWeight: "600" },
  headerCustomer: { fontSize: 20, fontWeight: "700", marginTop: 4 },
  headerProject: { fontSize: 15 },
  tapRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  tapChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: "100%",
  },
  tapChipText: { fontSize: 13, fontWeight: "500", flexShrink: 1 },

  section: { gap: 6 },
  sectionTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 0.6, paddingHorizontal: 4 },
  sectionCard: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 10,
  },

  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  detailLabel: { fontSize: 13, fontWeight: "500" },
  detailValue: { fontSize: 14, fontWeight: "600", flexShrink: 1, textAlign: "right" },

  bodyText: { fontSize: 14, lineHeight: 20 },

  subRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 4,
  },
  subRowTitle: { fontSize: 14, fontWeight: "600" },
  subRowMeta: { fontSize: 12, marginTop: 2 },
  emptyRowText: { fontSize: 13, fontStyle: "italic" },

  actionBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 8,
  },
  secondaryRow: { flexDirection: "row", gap: 8 },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  actionButtonText: { fontSize: 15, fontWeight: "600" },
});
