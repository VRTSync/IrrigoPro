import React from "react";
import { StyleSheet, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { budgetStatus, type ActionBoardRow } from "@/lib/action-board";

export function ActionBoardBudgetMeter({ row }: { row: ActionBoardRow }) {
  const colors = useColors();
  const status = budgetStatus(row);
  const ratio =
    row.allocation && row.allocation > 0
      ? Math.max(0, Math.min(row.totalSpend / row.allocation, 1))
      : 0;
  const fill =
    status === "over"
      ? colors.destructive
      : status === "approaching"
        ? colors.primary
        : status === "unset"
          ? colors.mutedForeground
          : colors.accent;

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(ratio * 100) }}
      style={[styles.track, { backgroundColor: colors.muted }]}
    >
      <View style={[styles.fill, { backgroundColor: fill, width: `${ratio * 100}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 5, overflow: "hidden", borderRadius: 3 },
  fill: { height: "100%" },
});