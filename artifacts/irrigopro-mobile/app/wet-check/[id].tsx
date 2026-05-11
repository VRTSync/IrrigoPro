import { Feather } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { apiRequest } from "@/lib/api";

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

export const wetCheckDetailQueryKey = (id: number) =>
  ["wet-check", id] as const;

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

  const {
    data: wc,
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: id != null ? wetCheckDetailQueryKey(id) : ["wet-check", "missing"],
    enabled: id != null,
    queryFn: () => apiRequest<WetCheckDetail>(`/api/wet-checks/${id}`),
    staleTime: 30_000,
  });

  const onRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const headerTitle = wc ? `Wet check #${wc.id}` : "Wet check";

  // Group zone records by controller letter, in alphabetical order.
  const grouped = useMemo(() => {
    if (!wc) return [] as Array<{ letter: string; zones: WetCheckZoneRecord[] }>;
    const map = new Map<string, WetCheckZoneRecord[]>();
    for (const z of wc.zoneRecords) {
      const list = map.get(z.controllerLetter) ?? [];
      list.push(z);
      map.set(z.controllerLetter, list);
    }
    // Always show every expected controller (A..numControllers) so empty
    // controllers still render a heading + empty grid hint.
    const letters: string[] = [];
    for (let i = 0; i < (wc.numControllers ?? 0); i++) {
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
  }, [wc]);

  // Status chip counts mirroring the web Slice 7 layout.
  const counts = useMemo(() => {
    if (!wc) {
      return { ok: 0, issues: 0, na: 0, notChecked: 0 };
    }
    let ok = 0;
    let issues = 0;
    let na = 0;
    let notChecked = 0;
    for (const z of wc.zoneRecords) {
      if (z.status === "checked_ok") ok++;
      else if (z.status === "checked_with_issues") issues++;
      else if (z.status === "not_applicable") na++;
      else notChecked++;
    }
    return { ok, issues, na, notChecked };
  }, [wc]);

  // Warm the parent wet-check cache before navigating so the zone screen,
  // which reads the same `["wet-check", id]` query, mounts with data
  // already in hand instead of showing a loading state.
  const prefetchZone = useCallback(() => {
    if (id == null || !wc) return;
    queryClient.setQueryData(wetCheckDetailQueryKey(id), wc);
  }, [queryClient, id, wc]);

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
        ) : isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : isError || !wc ? (
          <View style={styles.center}>
            <Feather name="alert-circle" size={32} color={colors.destructive} />
            <Text style={[styles.errorTitle, { color: colors.foreground }]}>
              Couldn't load wet check
            </Text>
            <Text style={[styles.errorBody, { color: colors.mutedForeground }]}>
              {error instanceof Error ? error.message : "Something went wrong."}
            </Text>
            <RetryButton
              label="Try again"
              colors={colors}
              onPress={() => refetch()}
            />
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.scroll}
            refreshControl={
              <RefreshControl
                refreshing={isRefetching}
                onRefresh={onRefresh}
                tintColor={colors.primary}
              />
            }
          >
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
                  WC #{wc.id}
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
                    {STATUS_LABELS[wc.status] ?? wc.status}
                  </Text>
                </View>
              </View>
              <Text style={[styles.headerCustomer, { color: colors.foreground }]}>
                {wc.customerName}
              </Text>
              {wc.propertyAddress ? (
                <Text
                  style={[styles.headerAddress, { color: colors.mutedForeground }]}
                  numberOfLines={2}
                >
                  {wc.propertyAddress}
                </Text>
              ) : null}
            </View>

            <ChipRow counts={counts} colors={colors} />

            {wc.weather || wc.notes ? (
              <View style={styles.section}>
                {wc.weather ? (
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
                    <Text
                      style={[
                        styles.notesLabel,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      WEATHER
                    </Text>
                    <Text
                      style={[styles.notesBody, { color: colors.foreground }]}
                    >
                      {wc.weather}
                    </Text>
                  </View>
                ) : null}
                {wc.notes ? (
                  <View
                    style={[
                      styles.notesCard,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                        borderRadius: colors.radius,
                        marginTop: wc.weather ? 8 : 0,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.notesLabel,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      NOTES
                    </Text>
                    <Text
                      style={[styles.notesBody, { color: colors.foreground }]}
                    >
                      {wc.notes}
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
                <Text
                  style={[styles.emptyText, { color: colors.mutedForeground }]}
                >
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
                        id: String(wc.id),
                        zoneRecordId: String(zone.id),
                      },
                    });
                  }}
                />
              ))
            )}

            <View style={{ height: 24 }} />
          </ScrollView>
        )}
      </SafeAreaView>
    </>
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
      <Chip
        label={`Ran OK · ${counts.ok}`}
        bg="#16a34a"
        fg="#ffffff"
      />
      <Chip
        label={`Needs work · ${counts.issues}`}
        bg="#dc2626"
        fg="#ffffff"
      />
      <Chip
        label={`N/A · ${counts.na}`}
        bg="#9ca3af"
        fg="#ffffff"
      />
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
          <Text
            style={[styles.emptyText, { color: colors.mutedForeground }]}
          >
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
                        borderWidth: tone.borderColor
                          ? StyleSheet.hairlineWidth
                          : 0,
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
});
