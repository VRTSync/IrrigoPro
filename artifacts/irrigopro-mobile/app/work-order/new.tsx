// routes-todo: Full "Create work order" screen — wire up in a future slice.
import { Stack, useRouter } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

export default function NewWorkOrderScreen() {
  const colors = useColors();
  const router = useRouter();
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: "Create Work Order" }} />
      <View style={styles.center}>
        <Text style={[styles.title, { color: colors.foreground }]}>Coming soon</Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          The work order creation flow will be available in a future update.
        </Text>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: colors.primary,
              borderRadius: colors.radius - 4,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>
            Go back
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 },
  title: { fontSize: 20, fontWeight: "700" },
  body: { fontSize: 14, textAlign: "center", maxWidth: 280 },
  button: { paddingHorizontal: 20, paddingVertical: 10, marginTop: 8 },
  buttonText: { fontSize: 15, fontWeight: "600" },
});
