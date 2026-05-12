import { Feather } from "@expo/vector-icons";
import {
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { LoadingScreen } from "@/components/Loading";
import { useColors } from "@/hooks/useColors";
import { apiRequest } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/toast";
import { isOfflineQueuedResult } from "@/lib/sync/errors";
import { useScopeConflictTick } from "@/lib/sync/use-sync-status";
import {
  WetCheckConflictError,
  wetCheckDetailQueryKey,
  wetCheckIssueTypesQueryKey,
  wetCheckMutate,
  wetCheckMutationKey,
  wetCheckMutationKeyPrefix,
  wetCheckPartsByIssueQueryKey,
} from "@/lib/wet-check";

type IssueTypeConfig = {
  id: number;
  issueType: string;
  issueGroup: string;
  displayLabel: string;
  defaultLaborHours: string;
  partCategoryFilter: string | null;
  isActive: boolean;
  sortOrder: number;
};

type Part = {
  id: number;
  name: string;
  description: string | null;
  price: string;
  category: string;
};

type PartsByIssueResponse = {
  parts: Part[];
  recentPartIds: number[];
};

export { wetCheckDetailQueryKey } from "@/lib/wet-check";

type WetCheckPhoto = {
  id: number;
  wetCheckId: number;
  zoneRecordId: number | null;
  findingId: number | null;
  url: string;
  caption: string | null;
  takenAt: string | null;
};

type WetCheckFinding = {
  id: number;
  zoneRecordId: number;
  issueType: string;
  resolution: string;
  partName: string | null;
  quantity: number;
  laborHours: string | null;
  notes: string | null;
};

type WetCheckZoneRecord = {
  id: number;
  wetCheckId: number;
  controllerLetter: string;
  zoneNumber: number;
  status: string;
  markedCompleteAt: string | null;
  notes: string | null;
  findings: WetCheckFinding[];
};

type WetCheckDetail = {
  id: number;
  customerId: number;
  customerName: string;
  propertyAddress: string | null;
  status: string;
  numControllers: number;
  startedAt: string | null;
  submittedAt: string | null;
  weather: string | null;
  notes: string | null;
  zoneRecords: WetCheckZoneRecord[];
  photos: WetCheckPhoto[];
};

const STATUS_LABELS: Record<string, string> = {
  in_progress: "In progress",
  submitted: "Submitted",
  approved: "Approved",
  partially_converted: "Partially converted",
  converted: "Converted",
};

type ZoneStatusTone = {
  bg: string;
  fg: string;
  borderColor?: string;
};

function zoneStatusTone(
  status: string,
  colors: ReturnType<typeof useColors>,
): ZoneStatusTone {
  switch (status) {
    case "checked_ok":
      return { bg: "#16a34a", fg: "#ffffff" };
    case "checked_with_issues":
      return { bg: "#dc2626", fg: "#ffffff" };
    case "not_applicable":
      return { bg: "#9ca3af", fg: "#ffffff" };
    default:
      return {
        bg: colors.card,
        fg: colors.foreground,
        borderColor: colors.border,
      };
  }
}

export default function WetCheckDetailScreen() {
  const colors = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id: string }>();
  const id = useMemo(() => {
    const n = Number(params.id);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [params.id]);

  const [conflict, setConflict] = useState(false);

  // Surface 409s discovered by background queue drains in the same
  // banner as inline-mutation conflicts.
  const conflictTick = useScopeConflictTick(id != null ? `wc:${id}` : null);
  useEffect(() => {
    if (conflictTick > 0) setConflict(true);
  }, [conflictTick]);

  const detailQuery = useQuery({
    queryKey: id != null ? wetCheckDetailQueryKey(id) : ["wet-check", "missing"],
    enabled: id != null,
    queryFn: () => apiRequest<WetCheckDetail>(`/api/wet-checks/${id}`),
    staleTime: 30_000,
  });

  const wcd = detailQuery.data;

  // Prefetch the issue type catalog and a parts list for each issue type for
  // this customer when the user lands on the wet check. The Add Finding modal
  // (M5) opens off this cache so the issue + parts pickers feel instant on the
  // first tap. Issue types and parts are nearly static at the company level
  // and the staleTime is 5 minutes, so this is cheap.
  const issueTypesQuery = useQuery({
    queryKey: wetCheckIssueTypesQueryKey,
    queryFn: () => apiRequest<IssueTypeConfig[]>("/api/wet-checks/issue-types"),
    staleTime: 5 * 60_000,
    enabled: id != null,
  });

  useEffect(() => {
    if (!wcd || !issueTypesQuery.data) return;
    const customerId = wcd.customerId;
    for (const it of issueTypesQuery.data) {
      const key = wetCheckPartsByIssueQueryKey(it.issueType, customerId);
      if (queryClient.getQueryData(key) !== undefined) continue;
      queryClient
        .prefetchQuery({
          queryKey: key,
          queryFn: () =>
            apiRequest<PartsByIssueResponse>(
              `/api/wet-checks/parts/by-issue?issueType=${encodeURIComponent(it.issueType)}&customerId=${customerId}`,
            ),
          staleTime: 5 * 60_000,
        })
        .catch(() => undefined);
    }
  }, [wcd, issueTypesQuery.data, queryClient]);

  // Track failed mutations against this wet check (zone status, add finding,
  // remove finding, submit). If any logical operation has errored and not
  // yet been retried successfully, gate Submit so a tech can't accidentally
  // submit with un-saved local edits.
  //
  // The TanStack mutation cache retains historical mutations until gcTime
  // expires, so a once-failed mutation that was later retried successfully
  // would otherwise keep `hasPendingLocalError` true. We subscribe to the
  // cache and, whenever a mutation succeeds, prune *only* the errored
  // mutations whose `mutationKey` is identical to the successful one —
  // i.e. errors for the *same logical operation* (zone-status for zone N,
  // finding-add for zone N, finding-delete for finding F, or submit). An
  // unrelated failed edit on another zone keeps Submit gated.
  useEffect(() => {
    if (id == null) return;
    const cache = queryClient.getMutationCache();
    const prefix = wetCheckMutationKeyPrefix(id);
    const sameKey = (a: readonly unknown[] | undefined, b: readonly unknown[]) =>
      a != null && a.length === b.length && a.every((v, i) => v === b[i]);
    const startsWithPrefix = (k: readonly unknown[] | undefined) =>
      k != null && k.length >= prefix.length && prefix.every((v, i) => k[i] === v);
    const unsub = cache.subscribe((event) => {
      if (event.type !== "updated") return;
      if (event.mutation.state.status !== "success") return;
      const winner = event.mutation.options.mutationKey;
      if (!startsWithPrefix(winner)) return;
      for (const m of cache.getAll()) {
        if (m === event.mutation) continue;
        if (m.state.status !== "error") continue;
        if (!sameKey(m.options.mutationKey, winner as readonly unknown[])) continue;
        cache.remove(m);
      }
    });
    return unsub;
  }, [id, queryClient]);

  const failedMutations = useMutationState({
    filters: id != null
      ? { mutationKey: wetCheckMutationKeyPrefix(id), status: "error", exact: false }
      : { mutationKey: ["wet-check", "mutation", -1], status: "error", exact: false },
    select: (m) => ({
      key: m.options.mutationKey,
      error: m.state.error,
    }),
  });
  // Dedupe by mutationKey — multiple historical errors for the same logical
  // op shouldn't be counted twice, and the cleanup subscriber above already
  // ensures successes prune their own key's prior errors.
  const uniqueFailedKeys = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ key: readonly unknown[] | undefined; error: unknown }> = [];
    for (const f of failedMutations) {
      const k = JSON.stringify(f.key ?? []);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(f);
    }
    return out;
  }, [failedMutations]);
  const hasPendingLocalError = uniqueFailedKeys.length > 0;
  const inFlightMutations = useMutationState({
    filters: id != null
      ? { mutationKey: wetCheckMutationKeyPrefix(id), status: "pending", exact: false }
      : { mutationKey: ["wet-check", "mutation", -1], status: "pending", exact: false },
  });
  const hasInFlightMutation = inFlightMutations.length > 0;

  const onRefresh = useCallback(() => {
    setConflict(false);
    detailQuery.refetch();
  }, [detailQuery]);

  const headerTitle = wcd ? `Wet check #${wcd.id}` : "Wet check";

  // Group zone records by controller letter, in alphabetical order.
  const grouped = useMemo(() => {
    if (!wcd) return [] as Array<{ letter: string; zones: WetCheckZoneRecord[] }>;
    const map = new Map<string, WetCheckZoneRecord[]>();
    for (const z of wcd.zoneRecords) {
      const list = map.get(z.controllerLetter) ?? [];
      list.push(z);
      map.set(z.controllerLetter, list);
    }
    const letters: string[] = [];
    for (let i = 0; i < (wcd.numControllers ?? 0); i++) {
      letters.push(String.fromCharCode("A".charCodeAt(0) + i));
    }
    for (const l of map.keys()) {
      if (!letters.includes(l)) letters.push(l);
    }
    letters.sort();
    return letters.map((letter) => ({
      letter,
      zones: (map.get(letter) ?? []).slice().sort(
        (a, b) => a.zoneNumber - b.zoneNumber,
      ),
    }));
  }, [wcd]);

  const counts = useMemo(() => {
    if (!wcd) return { ok: 0, issues: 0, na: 0, notChecked: 0 };
    let ok = 0;
    let issues = 0;
    let na = 0;
    let notChecked = 0;
    for (const z of wcd.zoneRecords) {
      if (z.status === "checked_ok") ok++;
      else if (z.status === "checked_with_issues") issues++;
      else if (z.status === "not_applicable") na++;
      else notChecked++;
    }
    return { ok, issues, na, notChecked };
  }, [wcd]);

  const prefetchZone = useCallback(() => {
    if (id == null || !wcd) return;
    queryClient.setQueryData(wetCheckDetailQueryKey(id), wcd);
  }, [queryClient, id, wcd]);

  const [submitError, setSubmitError] = useState<string | null>(null);

  const submitMutation = useMutation({
    mutationKey: id != null ? wetCheckMutationKey(id, "submit") : ["wet-check", "mutation", -1, "submit"],
    mutationFn: async () => {
      if (id == null) throw new Error("Missing wet check id");
      return wetCheckMutate<WetCheckDetail & { billingSheetId?: number | null }>({
        path: `/api/wet-checks/${id}/submit`,
        method: "POST",
        wetCheckId: id,
        label: "Submit wet check",
      });
    },
    onSuccess: async (data) => {
      setSubmitError(null);
      if (id != null) {
        // When the submit was queued offline (synthetic placeholder), skip
        // the cache merge — its negative `id` would corrupt the wet-check
        // detail cache. The engine will refetch on successful drain.
        if (!isOfflineQueuedResult(data)) {
          // Merge submit response into cache: it contains the updated wet
          // check top-level fields. Keep zoneRecords/photos from current
          // cache.
          queryClient.setQueryData<WetCheckDetail | undefined>(
            wetCheckDetailQueryKey(id),
            (prev) =>
              prev
                ? { ...prev, ...data, zoneRecords: prev.zoneRecords, photos: prev.photos }
                : prev,
          );
        }
        await queryClient.invalidateQueries({ queryKey: wetCheckDetailQueryKey(id) });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    },
    onError: (err) => {
      if (err instanceof WetCheckConflictError) {
        setConflict(true);
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      setSubmitError(friendlyErrorMessage(err, "Couldn't submit wet check"));
    },
  });

  const canSubmit =
    wcd?.status === "in_progress" &&
    !submitMutation.isPending &&
    !hasPendingLocalError &&
    !hasInFlightMutation;

  const onSubmitPressed = useCallback(() => {
    if (!wcd) return;
    Alert.alert(
      "Submit wet check?",
      "This sends the wet check to the office for review. You won't be able to edit zones or add findings after submitting.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Submit",
          style: "destructive",
          onPress: () => submitMutation.mutate(),
        },
      ],
    );
  }, [wcd, submitMutation]);

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
              Invalid wet check
            </Text>
            <RetryButton
              label="Go back"
              colors={colors}
              onPress={() => router.back()}
            />
          </View>
        ) : detailQuery.isLoading ? (
          <LoadingScreen />
        ) : detailQuery.isError || !wcd ? (
          <View style={styles.center}>
            <Feather name="alert-circle" size={32} color={colors.destructive} />
            <Text style={[styles.errorTitle, { color: colors.foreground }]}>
              Couldn't load wet check
            </Text>
            <Text style={[styles.errorBody, { color: colors.mutedForeground }]}>
              {friendlyErrorMessage(detailQuery.error)}
            </Text>
            <RetryButton
              label="Try again"
              colors={colors}
              onPress={() => detailQuery.refetch()}
            />
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.scroll}
            refreshControl={
              <RefreshControl
                refreshing={detailQuery.isRefetching}
                onRefresh={onRefresh}
                tintColor={colors.primary}
              />
            }
          >
            {conflict ? (
              <ConflictBanner
                colors={colors}
                onRefresh={() => {
                  setConflict(false);
                  detailQuery.refetch();
                }}
              />
            ) : null}

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
                  WC #{wcd.id}
                </Text>
                <View
                  style={[
                    styles.statusPill,
                    { backgroundColor: colors.secondary, borderRadius: 999 },
                  ]}
                >
                  <Text
                    style={[
                      styles.statusText,
                      { color: colors.secondaryForeground },
                    ]}
                  >
                    {STATUS_LABELS[wcd.status] ?? wcd.status}
                  </Text>
                </View>
              </View>
              <Text style={[styles.headerCustomer, { color: colors.foreground }]}>
                {wcd.customerName}
              </Text>
              {wcd.propertyAddress ? (
                <Text
                  style={[styles.headerAddress, { color: colors.mutedForeground }]}
                  numberOfLines={2}
                >
                  {wcd.propertyAddress}
                </Text>
              ) : null}
            </View>

            <ChipRow counts={counts} colors={colors} />

            {wcd.weather || wcd.notes ? (
              <View style={styles.section}>
                {wcd.weather ? (
                  <View
                    style={[
                      styles.notesCard,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                        borderRadius: colors.radius,
                      },
                    ]}
                  >
                    <Text style={[styles.notesLabel, { color: colors.mutedForeground }]}>
                      WEATHER
                    </Text>
                    <Text style={[styles.notesBody, { color: colors.foreground }]}>
                      {wcd.weather}
                    </Text>
                  </View>
                ) : null}
                {wcd.notes ? (
                  <View
                    style={[
                      styles.notesCard,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                        borderRadius: colors.radius,
                        marginTop: wcd.weather ? 8 : 0,
                      },
                    ]}
                  >
                    <Text style={[styles.notesLabel, { color: colors.mutedForeground }]}>
                      NOTES
                    </Text>
                    <Text style={[styles.notesBody, { color: colors.foreground }]}>
                      {wcd.notes}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {grouped.length === 0 ? (
              <View
                style={[
                  styles.emptyCard,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    borderRadius: colors.radius,
                  },
                ]}
              >
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                  No zones recorded yet.
                </Text>
              </View>
            ) : (
              grouped.map(({ letter, zones }) => (
                <ControllerSection
                  key={letter}
                  letter={letter}
                  zones={zones}
                  colors={colors}
                  onZonePress={(zone) => {
                    prefetchZone();
                    router.push({
                      pathname: "/wet-check/[id]/zone/[zoneRecordId]",
                      params: {
                        id: String(wcd.id),
                        zoneRecordId: String(zone.id),
                      },
                    });
                  }}
                />
              ))
            )}

            {wcd.status === "in_progress" ? (
              <View style={[styles.section, { marginTop: 8 }]}>
                <Pressable
                  onPress={onSubmitPressed}
                  disabled={!canSubmit}
                  style={({ pressed }) => [
                    styles.submitButton,
                    {
                      backgroundColor: canSubmit ? colors.primary : colors.muted,
                      borderRadius: colors.radius,
                      opacity: pressed && canSubmit ? 0.85 : 1,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Submit wet check"
                  accessibilityState={{ disabled: !canSubmit }}
                >
                  {submitMutation.isPending ? (
                    <ActivityIndicator color={colors.primaryForeground} />
                  ) : (
                    <>
                      <Feather
                        name="check-circle"
                        size={18}
                        color={canSubmit ? colors.primaryForeground : colors.mutedForeground}
                      />
                      <Text
                        style={[
                          styles.submitText,
                          {
                            color: canSubmit
                              ? colors.primaryForeground
                              : colors.mutedForeground,
                          },
                        ]}
                      >
                        Submit wet check
                      </Text>
                    </>
                  )}
                </Pressable>
                {submitError ? (
                  <Text
                    style={[styles.submitHint, { color: colors.destructive }]}
                  >
                    {submitError}
                  </Text>
                ) : hasPendingLocalError ? (
                  <Text
                    style={[styles.submitHint, { color: colors.destructive }]}
                  >
                    {uniqueFailedKeys.length === 1
                      ? "A change couldn't be saved. Retry the failed edit before submitting."
                      : `${uniqueFailedKeys.length} changes couldn't be saved. Retry them before submitting.`}
                  </Text>
                ) : hasInFlightMutation ? (
                  <Text
                    style={[styles.submitHint, { color: colors.mutedForeground }]}
                  >
                    Saving your changes…
                  </Text>
                ) : counts.notChecked > 0 ? (
                  <Text
                    style={[
                      styles.submitHint,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    {counts.notChecked} zone{counts.notChecked === 1 ? "" : "s"} still
                    need to be checked.
                  </Text>
                ) : null}
              </View>
            ) : null}

            <View style={{ height: 24 }} />
          </ScrollView>
        )}
      </SafeAreaView>
    </>
  );
}

function ConflictBanner({
  colors,
  onRefresh,
}: {
  colors: ReturnType<typeof useColors>;
  onRefresh: () => void;
}) {
  return (
    <View
      style={[
        styles.conflictBanner,
        {
          backgroundColor: "#fef3c7",
          borderColor: "#f59e0b",
          borderRadius: colors.radius,
        },
      ]}
    >
      <Feather name="alert-triangle" size={18} color="#b45309" />
      <View style={{ flex: 1 }}>
        <Text style={[styles.conflictTitle, { color: "#92400e" }]}>
          This wet check was edited in the office
        </Text>
        <Text style={[styles.conflictBody, { color: "#78350f" }]}>
          Refresh to see the latest version before continuing.
        </Text>
      </View>
      <Pressable
        onPress={onRefresh}
        style={({ pressed }) => [
          styles.conflictRefresh,
          { borderRadius: 999, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <Text style={styles.conflictRefreshText}>Refresh</Text>
      </Pressable>
    </View>
  );
}

function ChipRow({
  counts,
  colors,
}: {
  counts: { ok: number; issues: number; na: number; notChecked: number };
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.chipRow}>
      <Chip label={`Ran OK · ${counts.ok}`} bg="#16a34a" fg="#ffffff" />
      <Chip label={`Needs work · ${counts.issues}`} bg="#dc2626" fg="#ffffff" />
      <Chip label={`N/A · ${counts.na}`} bg="#9ca3af" fg="#ffffff" />
      {counts.notChecked > 0 ? (
        <Chip
          label={`Not checked · ${counts.notChecked}`}
          bg={colors.secondary}
          fg={colors.secondaryForeground}
        />
      ) : null}
    </View>
  );
}

function Chip({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      <Text style={[styles.chipText, { color: fg }]}>{label}</Text>
    </View>
  );
}

function ControllerSection({
  letter,
  zones,
  colors,
  onZonePress,
}: {
  letter: string;
  zones: WetCheckZoneRecord[];
  colors: ReturnType<typeof useColors>;
  onZonePress: (zone: WetCheckZoneRecord) => void;
}) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
        CONTROLLER {letter}
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
        {zones.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            No zones recorded for this controller.
          </Text>
        ) : (
          <View style={styles.zoneGrid}>
            {zones.map((z) => {
              const tone = zoneStatusTone(z.status, colors);
              const markedComplete =
                z.status === "checked_with_issues" && z.markedCompleteAt != null;
              return (
                <View key={z.id} style={styles.zoneCell}>
                  <Pressable
                    onPress={() => onZonePress(z)}
                    style={({ pressed }) => [
                      styles.zoneTile,
                      {
                        backgroundColor: tone.bg,
                        borderColor: tone.borderColor ?? "transparent",
                        borderWidth: tone.borderColor ? StyleSheet.hairlineWidth : 0,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Zone ${z.zoneNumber}`}
                  >
                    <Text style={[styles.zoneTileText, { color: tone.fg }]}>
                      {z.zoneNumber}
                    </Text>
                    {markedComplete ? (
                      <View style={styles.markedCompleteDot}>
                        <Feather name="check" size={10} color="#16a34a" />
                      </View>
                    ) : null}
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}
      </View>
    </View>
  );
}

function RetryButton({
  label,
  colors,
  onPress,
}: {
  label: string;
  colors: ReturnType<typeof useColors>;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
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
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 16, gap: 12 },
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
    gap: 6,
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerNumber: { fontSize: 12, fontWeight: "600", letterSpacing: 0.4 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontSize: 12, fontWeight: "600" },
  headerCustomer: { fontSize: 19, fontWeight: "700", marginTop: 4 },
  headerAddress: { fontSize: 14 },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  chipText: { fontSize: 12, fontWeight: "600" },
  section: { gap: 6 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    paddingHorizontal: 4,
  },
  sectionCard: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
  },
  notesCard: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 4,
  },
  notesLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
  },
  notesBody: { fontSize: 14, lineHeight: 20 },
  zoneGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -3,
  },
  zoneCell: {
    width: "20%",
    padding: 3,
  },
  zoneTile: {
    aspectRatio: 1,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  zoneTileText: { fontSize: 16, fontWeight: "700" },
  markedCompleteDot: {
    position: "absolute",
    top: -4,
    right: -4,
    width: 16,
    height: 16,
    borderRadius: 999,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#16a34a",
  },
  emptyCard: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    alignItems: "center",
  },
  emptyText: { fontSize: 14 },
  submitButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  submitText: { fontSize: 16, fontWeight: "700" },
  submitHint: {
    fontSize: 12,
    paddingHorizontal: 4,
    textAlign: "center",
  },
  conflictBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  conflictTitle: { fontSize: 13, fontWeight: "700" },
  conflictBody: { fontSize: 12, marginTop: 2 },
  conflictRefresh: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#b45309",
  },
  conflictRefreshText: { color: "#ffffff", fontSize: 12, fontWeight: "700" },
});
