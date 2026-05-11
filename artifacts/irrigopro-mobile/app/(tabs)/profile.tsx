import Constants from "expo-constants";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/lib/auth-context";

const ROLE_LABELS: Record<string, string> = {
  field_tech: "Field technician",
  irrigation_manager: "Irrigation manager",
  company_admin: "Company admin",
  billing_manager: "Billing manager",
  super_admin: "Super admin",
};

export default function ProfileScreen() {
  const colors = useColors();
  const { user, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(" ");
  const displayName = fullName || user?.username || "Signed in";
  const roleLabel = user?.role ? ROLE_LABELS[user.role] ?? user.role : null;

  const appVersion =
    (Constants.expoConfig?.version as string | undefined) ||
    (Constants.manifest as { version?: string } | null)?.version ||
    "—";

  const onSignOutPress = () => {
    if (signingOut) return;
    const doSignOut = async () => {
      setSigningOut(true);
      try {
        await signOut();
      } finally {
        setSigningOut(false);
      }
    };
    if (Platform.OS === "web") {
      void doSignOut();
      return;
    }
    Alert.alert("Sign out?", "You'll need to sign in again to view your work orders.", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => void doSignOut() },
    ]);
  };

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: colors.background }]}
      edges={["top", "left", "right"]}
    >
      <View style={styles.container}>
        <Text style={[styles.heading, { color: colors.foreground }]}>Profile</Text>

        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: colors.radius,
            },
          ]}
        >
          <View style={styles.avatarRow}>
            <View
              style={[
                styles.avatar,
                {
                  backgroundColor: colors.primary,
                  borderRadius: 999,
                },
              ]}
            >
              <Text style={[styles.avatarText, { color: colors.primaryForeground }]}>
                {displayName.slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <View style={styles.nameWrap}>
              <Text
                style={[styles.name, { color: colors.foreground }]}
                numberOfLines={1}
              >
                {displayName}
              </Text>
              {roleLabel ? (
                <Text style={[styles.role, { color: colors.mutedForeground }]}>
                  {roleLabel}
                </Text>
              ) : null}
            </View>
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <Row label="Username" value={user?.username ?? "—"} colors={colors} />
          {user?.email ? (
            <Row label="Email" value={user.email} colors={colors} />
          ) : null}
          {user?.companyName ? (
            <Row label="Company" value={user.companyName} colors={colors} />
          ) : user?.companyId != null ? (
            <Row label="Company" value={`#${user.companyId}`} colors={colors} />
          ) : null}
          <Row label="App version" value={appVersion} colors={colors} />
        </View>

        <Pressable
          onPress={onSignOutPress}
          disabled={signingOut}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.signOutButton,
            {
              borderColor: colors.destructive,
              borderRadius: colors.radius - 4,
              opacity: signingOut ? 0.6 : pressed ? 0.85 : 1,
            },
          ]}
        >
          {signingOut ? (
            <ActivityIndicator color={colors.destructive} />
          ) : (
            <Text style={[styles.signOutText, { color: colors.destructive }]}>
              Sign out
            </Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function Row({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
      <Text
        style={[styles.rowValue, { color: colors.foreground }]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { flex: 1, padding: 20, gap: 20 },
  heading: { fontSize: 28, fontWeight: "700", marginTop: 4 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 4,
  },
  avatarRow: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 4 },
  avatar: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 22, fontWeight: "700" },
  nameWrap: { flex: 1 },
  name: { fontSize: 18, fontWeight: "600" },
  role: { fontSize: 13, marginTop: 2 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 12 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    gap: 16,
  },
  rowLabel: { fontSize: 14 },
  rowValue: { fontSize: 14, fontWeight: "500", flexShrink: 1, textAlign: "right" },
  signOutButton: {
    borderWidth: 1.5,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  signOutText: { fontSize: 16, fontWeight: "600" },
});
