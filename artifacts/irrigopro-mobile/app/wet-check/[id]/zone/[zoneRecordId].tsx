import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React, { useMemo } from "react";
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
import { wetCheckDetailQueryKey } from "../../[id]";

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
  observedPressure: string | null;
  observedFlow: string | null;
  ranSuccessfully: boolean | null;
  findings: WetCheckFinding[];
};

type WetCheckDetail = {
  id: number;
  customerName: string;
  zoneRecords: WetCheckZoneRecord[];
  photos: WetCheckPhoto[];
};

const ZONE_STATUS_LABELS: Record<string, string> = {
  checked_ok: "Ran OK",
  checked_with_issues: "Needs work",
  not_applicable: "Skipped (N/A)",
  not_checked: "Not checked",
};

const FINDING_RESOLUTION_LABELS: Record<string, string> = {
  pending: "Pending decision",
  repaired_in_field: "Completed in field",
  sent_to_estimate: "Sent to estimate",
  deferred_to_work_order: "Deferred to work order",
  documented_only: "Documented only",
};

function prettyIssueType(s: string): string {
  return s
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function zoneStatusColor(status: string, colors: ReturnType<typeof useColors>) {
  switch (status) {
    case "checked_ok":
      return { bg: "#16a34a", fg: "#ffffff" };
    case "checked_with_issues":
      return { bg: "#dc2626", fg: "#ffffff" };
    case "not_applicable":
      return { bg: "#9ca3af", fg: "#ffffff" };
    default:
      return { bg: colors.secondary, fg: colors.secondaryForeground };
  }
}

export default function ZoneDetailScreen() {
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; zoneRecordId: string }>();
  const wetCheckId = useMemo(() => {
    const n = Number(params.id);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [params.id]);
  const zoneRecordId = useMemo(() => {
    const n = Number(params.zoneRecordId);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [params.zoneRecordId]);

  // Refetch the parent wet check so pull-to-refresh on the zone screen
  // reflects the latest server-side data — there's no per-zone-record
  // endpoint today.
  const {
    data: wc,
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey:
      wetCheckId != null
        ? wetCheckDetailQueryKey(wetCheckId)
        : ["wet-check", "missing"],
    enabled: wetCheckId != null,
    queryFn: () =>
      apiRequest<WetCheckDetail>(`/api/wet-checks/${wetCheckId}`),
    staleTime: 30_000,
  });

  const zone = useMemo<WetCheckZoneRecord | undefined>(() => {
    if (!wc || zoneRecordId == null) return undefined;
    return wc.zoneRecords.find((z) => z.id === zoneRecordId);
  }, [wc, zoneRecordId]);

  const zonePhotos = useMemo<WetCheckPhoto[]>(() => {
    if (!wc || zoneRecordId == null) return [];
    const findingIds = new Set(
      wc.zoneRecords
        .find((z) => z.id === zoneRecordId)
        ?.findings.map((f) => f.id) ?? [],
    );
    return wc.photos.filter(
      (p) => p.zoneRecordId === zoneRecordId || (p.findingId != null && findingIds.has(p.findingId)),
    );
  }, [wc, zoneRecordId]);

  const headerTitle = zone
    ? `Controller ${zone.controllerLetter} · Zone ${zone.zoneNumber}`
    : "Zone";

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
        {wetCheckId == null || zoneRecordId == null ? (
          <View style={styles.center}>
            <Text style={[styles.errorTitle, { color: colors.foreground }]}>
              Invalid zone
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
              <Text
                style={[styles.retryText, { color: colors.primaryForeground }]}
              >
                Go back
              </Text>
            </Pressable>
          </View>
        ) : isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : isError || !wc ? (
          <View style={styles.center}>
            <Feather name="alert-circle" size={32} color={colors.destructive} />
            <Text style={[styles.errorTitle, { color: colors.foreground }]}>
              Couldn't load zone
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
              <Text
                style={[styles.retryText, { color: colors.primaryForeground }]}
              >
                Try again
              </Text>
            </Pressable>
          </View>
        ) : !zone ? (
          <View style={styles.center}>
            <Text style={[styles.errorTitle, { color: colors.foreground }]}>
              Zone not found
            </Text>
            <Text style={[styles.errorBody, { color: colors.mutedForeground }]}>
              This zone is no longer part of the wet check.
            </Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.scroll}
            refreshControl={
              <RefreshControl
                refreshing={isRefetching}
                onRefresh={() => refetch()}
                tintColor={colors.primary}
              />
            }
          >
            <ZoneStatusCard zone={zone} colors={colors} />

            {zone.notes ? (
              <Section title="Zone notes" colors={colors}>
                <Text style={[styles.bodyText, { color: colors.foreground }]}>
                  {zone.notes}
                </Text>
              </Section>
            ) : null}

            <Section
              title={`Findings (${zone.findings.length})`}
              colors={colors}
            >
              {zone.findings.length === 0 ? (
                <Text
                  style={[styles.emptyText, { color: colors.mutedForeground }]}
                >
                  No findings recorded for this zone.
                </Text>
              ) : (
                zone.findings.map((f, idx) => (
                  <View
                    key={f.id}
                    style={[
                      styles.findingRow,
                      idx > 0 && {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: colors.border,
                        paddingTop: 12,
                      },
                    ]}
                  >
                    <View style={styles.findingTopRow}>
                      <Text
                        style={[
                          styles.findingTitle,
                          { color: colors.foreground },
                        ]}
                      >
                        {prettyIssueType(f.issueType)}
                      </Text>
                      <View
                        style={[
                          styles.resolutionPill,
                          {
                            backgroundColor: colors.secondary,
                            borderRadius: 999,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.resolutionText,
                            { color: colors.secondaryForeground },
                          ]}
                        >
                          {FINDING_RESOLUTION_LABELS[f.resolution] ?? f.resolution}
                        </Text>
                      </View>
                    </View>
                    {f.partName ? (
                      <DetailLine
                        icon="package"
                        label={`${f.partName} × ${f.quantity}`}
                        colors={colors}
                      />
                    ) : null}
                    {f.laborHours && parseFloat(f.laborHours) > 0 ? (
                      <DetailLine
                        icon="clock"
                        label={`${f.laborHours} labor hr${
                          parseFloat(f.laborHours) === 1 ? "" : "s"
                        }`}
                        colors={colors}
                      />
                    ) : null}
                    {f.notes ? (
                      <Text
                        style={[
                          styles.findingNotes,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        {f.notes}
                      </Text>
                    ) : null}
                  </View>
                ))
              )}
            </Section>

            <Section
              title={`Photos (${zonePhotos.length})`}
              colors={colors}
            >
              {zonePhotos.length === 0 ? (
                <Text
                  style={[styles.emptyText, { color: colors.mutedForeground }]}
                >
                  No photos for this zone.
                </Text>
              ) : (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.photoStrip}
                >
                  {zonePhotos.map((p) => (
                    <View
                      key={p.id}
                      style={[
                        styles.photoFrame,
                        {
                          borderColor: colors.border,
                          borderRadius: colors.radius - 4,
                          backgroundColor: colors.secondary,
                        },
                      ]}
                    >
                      <Image
                        source={{ uri: p.url }}
                        style={styles.photoImage}
                        contentFit="cover"
                        transition={150}
                        cachePolicy="memory-disk"
                        accessibilityLabel={p.caption ?? "Wet check photo"}
                      />
                    </View>
                  ))}
                </ScrollView>
              )}
            </Section>

            <View style={{ height: 24 }} />
          </ScrollView>
        )}
      </SafeAreaView>
    </>
  );
}

function ZoneStatusCard({
  zone,
  colors,
}: {
  zone: WetCheckZoneRecord;
  colors: ReturnType<typeof useColors>;
}) {
  const tone = zoneStatusColor(zone.status, colors);
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
          Controller {zone.controllerLetter} · Zone {zone.zoneNumber}
        </Text>
        <View
          style={[
            styles.statusPill,
            { backgroundColor: tone.bg, borderRadius: 999 },
          ]}
        >
          <Text style={[styles.statusText, { color: tone.fg }]}>
            {ZONE_STATUS_LABELS[zone.status] ?? zone.status}
          </Text>
        </View>
      </View>

      {zone.status === "checked_with_issues" && zone.markedCompleteAt ? (
        <View style={styles.markedCompleteRow}>
          <Feather name="check-circle" size={14} color="#16a34a" />
          <Text
            style={[styles.markedCompleteText, { color: colors.foreground }]}
          >
            Marked complete by tech
          </Text>
        </View>
      ) : null}

      {zone.observedPressure || zone.observedFlow ? (
        <View style={styles.metricsRow}>
          {zone.observedPressure ? (
            <DetailLine
              icon="activity"
              label={`Pressure ${zone.observedPressure} PSI`}
              colors={colors}
            />
          ) : null}
          {zone.observedFlow ? (
            <DetailLine
              icon="droplet"
              label={`Flow ${zone.observedFlow} GPM`}
              colors={colors}
            />
          ) : null}
        </View>
      ) : null}
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

function DetailLine({
  icon,
  label,
  colors,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.detailLine}>
      <Feather name={icon} size={14} color={colors.mutedForeground} />
      <Text style={[styles.detailLineText, { color: colors.foreground }]}>
        {label}
      </Text>
    </View>
  );
}

const PHOTO_SIZE = 120;

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
    gap: 8,
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  headerNumber: {
    fontSize: 13,
    fontWeight: "600",
    flexShrink: 1,
  },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontSize: 12, fontWeight: "700" },
  markedCompleteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  markedCompleteText: { fontSize: 13, fontWeight: "600" },
  metricsRow: { gap: 4 },
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
    gap: 8,
  },
  bodyText: { fontSize: 14, lineHeight: 20 },
  emptyText: { fontSize: 14 },
  findingRow: { gap: 4 },
  findingTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  findingTitle: { fontSize: 15, fontWeight: "600", flexShrink: 1 },
  resolutionPill: { paddingHorizontal: 8, paddingVertical: 3 },
  resolutionText: { fontSize: 11, fontWeight: "600" },
  findingNotes: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  detailLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  detailLineText: { fontSize: 13 },
  photoStrip: { gap: 8, paddingVertical: 4 },
  photoFrame: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  photoImage: { width: "100%", height: "100%" },
});
