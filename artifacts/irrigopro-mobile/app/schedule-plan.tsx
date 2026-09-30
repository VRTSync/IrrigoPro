import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { SyncStatusPill } from "@/components/SyncStatusPill";
import { useColors } from "@/hooks/useColors";
import {
  canViewActionBoard,
  createCopyPlanPressHandler,
  planTextForBoard,
  type ActionBoardResponse,
} from "@/lib/action-board";
import { apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useSyncStatus } from "@/lib/sync/use-sync-status";

export default function SchedulePlanScreen() {
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ companyId?: string }>();
  const { user } = useAuth();
  const { online } = useSyncStatus();
  const [draft, setDraft] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState("");
  const allowed = canViewActionBoard(user?.role);
  const requestedCompanyId = Number(params.companyId);
  const companyId = user?.role === "super_admin"
    ? (Number.isInteger(requestedCompanyId) && requestedCompanyId > 0 ? requestedCompanyId : user.companyId)
    : null;
  const url = companyId != null ? `/api/action-board?companyId=${companyId}` : "/api/action-board";
  const query = useQuery({
    queryKey: [url],
    queryFn: () => apiRequest<ActionBoardResponse>(url),
    staleTime: 30_000,
    refetchInterval: 60_000,
    enabled: allowed && (user?.role !== "super_admin" || companyId != null),
  });
  const generatedText = query.data ? planTextForBoard(query.data) : "";
  const text = draft ?? generatedText;
  const canShare = query.data && query.data.rows.length > 0;

  if (!allowed || (user?.role === "super_admin" && companyId == null)) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.foreground, textAlign: "center" }}>
          {!allowed ? "Manager access required" : "Company required. Open the Action Board and select a company."}
        </Text>
        <Pressable onPress={() => router.replace("/")}><Text style={{ color: colors.primary }}>Return to Today</Text></Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground }]}>Today's plan</Text>
          <Text style={{ color: colors.mutedForeground }}>Edit before copying or sharing</Text>
        </View>
        <SyncStatusPill />
      </View>
      {!query.data ? (
        <View style={styles.center}>
          {query.isPending && online && <ActivityIndicator color={colors.primary} />}
          <Text style={{ color: colors.mutedForeground, textAlign: "center" }}>
            {!online
              ? "No cached plan yet. Connect once to load the Action Board."
              : query.isError
                ? "The plan could not load. Check your connection and try again."
                : "Loading today's plan…"}
          </Text>
        </View>
      ) : !canShare ? (
        <View style={styles.center}>
          <Text style={{ color: colors.foreground, textAlign: "center" }}>
            {query.data.excludedWithoutBudgetGoal > 0
              ? "Budget goals are not set. Set monthly allocations on customer profiles to make a plan."
              : "No properties on the board for this month."}
          </Text>
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <TextInput
              testID="action-board-plan-text"
              multiline
              textAlignVertical="top"
              value={text}
              onChangeText={setDraft}
              style={[styles.editor, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}
            />
          </ScrollView>
          {notice ? <Text accessibilityRole="alert" style={[styles.notice, { color: colors.foreground }]}>{notice}</Text> : null}
          <View style={styles.actions}>
            <Pressable
              testID="action-board-copy-plan"
              onPress={createCopyPlanPressHandler(
                text,
                Clipboard.setStringAsync,
                () => setNotice("Copied to clipboard"),
                () => setNotice("Could not copy the plan"),
              )}
              style={[styles.button, { backgroundColor: colors.primary, borderRadius: colors.radius }]}
            >
              <Feather name="copy" size={16} color={colors.primaryForeground} />
              <Text style={{ color: colors.primaryForeground, fontWeight: "700" }}>Copy</Text>
            </Pressable>
            <Pressable
              testID="action-board-share-plan"
              onPress={() => Share.share({ message: text }).catch(() => setNotice("Could not share the plan"))}
              style={[styles.button, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: colors.radius }]}
            >
              <Feather name="share" size={16} color={colors.foreground} />
              <Text style={{ color: colors.foreground, fontWeight: "700" }}>Share</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 25, gap: 14 },
  header: { padding: 16, flexDirection: "row", alignItems: "center", gap: 10 },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 3 },
  content: { paddingHorizontal: 14, paddingBottom: 20 },
  editor: { minHeight: 360, borderWidth: 1, padding: 16, fontSize: 15, lineHeight: 23 },
  actions: { flexDirection: "row", gap: 10, paddingHorizontal: 14, paddingBottom: 16 },
  button: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", padding: 15, gap: 8 },
  notice: { textAlign: "center", padding: 6 },
});