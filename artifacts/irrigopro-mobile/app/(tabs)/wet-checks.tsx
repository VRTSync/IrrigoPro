import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

export default function WetChecksScreen() {
  const colors = useColors();
  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: colors.background }]}
      edges={["top", "left", "right"]}
    >
      <View style={styles.center}>
        <Feather name="droplet" size={36} color={colors.primary} />
        <Text style={[styles.title, { color: colors.foreground }]}>
          Wet Checks
        </Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          Wet check inspections will live here. Coming in M4.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 32,
  },
  title: { fontSize: 22, fontWeight: "700" },
  body: { fontSize: 14, textAlign: "center", maxWidth: 280 },
});
