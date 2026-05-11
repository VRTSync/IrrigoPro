import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export default function SignInScreen() {
  const colors = useColors();
  const { signIn } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberDevice, setRememberDevice] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onSubmit = async () => {
    if (submitting) return;
    setErrorMessage(null);
    if (!username.trim() || !password) {
      setErrorMessage("Please enter your username and password.");
      return;
    }

    setSubmitting(true);
    if (Platform.OS !== "web") {
      Haptics.selectionAsync().catch(() => undefined);
    }

    try {
      const deviceName = rememberDevice
        ? `${Platform.OS === "ios" ? "iOS" : Platform.OS === "android" ? "Android" : "Web"} device`
        : null;
      await signIn({
        username: username.trim(),
        password,
        deviceName,
      });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setErrorMessage("That username or password didn't work. Please try again.");
        } else if (err.status === 403) {
          setErrorMessage(
            err.message ||
              "Mobile sign-in is restricted to field technicians and irrigation managers.",
          );
        } else {
          setErrorMessage(err.message);
        }
      } else {
        setErrorMessage(
          "Couldn't reach the server. Check your connection and try again.",
        );
      }
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
          () => undefined,
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: colors.background }]}
      edges={["top", "left", "right"]}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <View
              style={[
                styles.logoBadge,
                { backgroundColor: colors.primary, borderRadius: colors.radius },
              ]}
            >
              <Text style={[styles.logoText, { color: colors.primaryForeground }]}>
                IP
              </Text>
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>
              IrrigoPro
            </Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              Sign in to view today's work.
            </Text>
          </View>

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
            <Text style={[styles.label, { color: colors.foreground }]}>
              Username
            </Text>
            <TextInput
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              textContentType="username"
              editable={!submitting}
              placeholder="username"
              placeholderTextColor={colors.mutedForeground}
              style={[
                styles.input,
                {
                  color: colors.foreground,
                  borderColor: colors.input,
                  backgroundColor: colors.background,
                  borderRadius: colors.radius - 4,
                },
              ]}
            />

            <Text style={[styles.label, { color: colors.foreground, marginTop: 14 }]}>
              Password
            </Text>
            <View style={styles.passwordRow}>
              <TextInput
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="password"
                textContentType="password"
                editable={!submitting}
                placeholder="••••••••"
                placeholderTextColor={colors.mutedForeground}
                onSubmitEditing={onSubmit}
                style={[
                  styles.input,
                  styles.flex,
                  {
                    color: colors.foreground,
                    borderColor: colors.input,
                    backgroundColor: colors.background,
                    borderRadius: colors.radius - 4,
                    paddingRight: 44,
                  },
                ]}
              />
              <Pressable
                onPress={() => setShowPassword((s) => !s)}
                hitSlop={12}
                style={styles.eyeButton}
                accessibilityRole="button"
                accessibilityLabel={showPassword ? "Hide password" : "Show password"}
              >
                <Feather
                  name={showPassword ? "eye-off" : "eye"}
                  size={20}
                  color={colors.mutedForeground}
                />
              </Pressable>
            </View>

            <View style={styles.rememberRow}>
              <Switch
                value={rememberDevice}
                onValueChange={setRememberDevice}
                disabled={submitting}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={Platform.OS === "android" ? colors.card : undefined}
              />
              <Text
                style={[styles.rememberLabel, { color: colors.foreground }]}
                onPress={() => setRememberDevice((v) => !v)}
              >
                Remember this device
              </Text>
            </View>

            {errorMessage ? (
              <View
                style={[
                  styles.errorBox,
                  {
                    borderColor: colors.destructive,
                    backgroundColor: colors.destructive + "15",
                    borderRadius: colors.radius - 6,
                  },
                ]}
              >
                <Text
                  style={[styles.errorText, { color: colors.destructive }]}
                >
                  {errorMessage}
                </Text>
              </View>
            ) : null}

            <Pressable
              onPress={onSubmit}
              disabled={submitting}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.submitButton,
                {
                  backgroundColor: colors.primary,
                  borderRadius: colors.radius - 4,
                  opacity: submitting ? 0.6 : pressed ? 0.85 : 1,
                },
              ]}
            >
              {submitting ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text
                  style={[styles.submitText, { color: colors.primaryForeground }]}
                >
                  Sign in
                </Text>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 32,
    gap: 24,
  },
  header: { alignItems: "center", gap: 8 },
  logoBadge: {
    width: 64,
    height: 64,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  logoText: { fontSize: 24, fontWeight: "700" },
  title: { fontSize: 28, fontWeight: "700" },
  subtitle: { fontSize: 15 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 20,
    gap: 4,
  },
  label: { fontSize: 14, fontWeight: "500", marginBottom: 6 },
  input: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  passwordRow: { flexDirection: "row", alignItems: "center", position: "relative" },
  eyeButton: {
    position: "absolute",
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  rememberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 16,
  },
  rememberLabel: { fontSize: 15 },
  errorBox: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 16,
  },
  errorText: { fontSize: 14, fontWeight: "500" },
  submitButton: {
    marginTop: 20,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  submitText: { fontSize: 16, fontWeight: "600" },
});
