import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { useColors } from "@/hooks/useColors";

/**
 * Full-screen loading spinner used by every screen while its primary
 * query hydrates. Keeping the markup in one component keeps the
 * loading UX identical app-wide (M9 polish).
 */
export function LoadingScreen() {
  const colors = useColors();
  return (
    <View style={[styles.center, { backgroundColor: colors.background }]}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

/**
 * Inline loading row — used inside cards/sections that load
 * independently from the screen's primary query (e.g. attached wet
 * checks on the work order detail screen).
 */
export function LoadingRow() {
  const colors = useColors();
  return (
    <View style={styles.inline}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

/**
 * Static, non-animated skeleton block. Used as a placeholder for
 * fixed-shape content (rows, cards) before the query resolves.
 * Intentionally non-animated to keep CPU/battery use minimal on field
 * hardware that may already be juggling photo encodes.
 */
export function Skeleton({
  width,
  height,
  radius = 6,
  style,
}: {
  width?: number | `${number}%`;
  height: number;
  radius?: number;
  style?: object;
}) {
  const colors = useColors();
  return (
    <View
      style={[
        {
          width: width ?? "100%",
          height,
          borderRadius: radius,
          backgroundColor: colors.muted,
          opacity: 0.6,
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  inline: { paddingVertical: 12, alignItems: "center" },
});
