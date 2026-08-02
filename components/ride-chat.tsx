import { useRouter } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { trpc } from "@/lib/trpc";
import { useRideX } from "@/lib/ridex-context";
import { useRealtimeConnected, useRealtimeTopic } from "@/hooks/use-realtime";

const COLORS = {
  bg: "#060c18",
  surface: "#0f1a2e",
  surface2: "#162035",
  cyan: "#00c8ff",
  green: "#00e887",
  foreground: "#ffffff",
  muted: "#8899aa",
  border: "#1e3050",
  error: "#ff4444",
};

function formatTime(d: Date) {
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  const hr = h % 12 || 12;
  return `${hr}:${m} ${ampm}`;
}

/**
 * Driver ↔ passenger chat for a ride. Messages arrive instantly via the
 * ride:<id> WS topic (message:new → setData in use-realtime.ts); the list
 * query only polls as a fallback while the socket is down.
 *
 * `backTo` is required because chat lives inside a Tabs navigator: plain
 * router.back() can land on the wrong tab (e.g. home instead of tracking),
 * stranding the user away from their live ride.
 */
export function RideChat({
  rideId,
  accent = COLORS.cyan,
  title = "Chat",
  backTo,
}: {
  rideId: number;
  accent?: string;
  title?: string;
  backTo?: string;
}) {
  const router = useRouter();
  const { user } = useRideX();
  const myUserId = Number(user?.id);
  const [draft, setDraft] = useState("");
  const listRef = useRef<FlatList>(null);
  const live = useRealtimeConnected();
  const utils = trpc.useUtils();

  // Realtime delivery for this ride's messages (and status updates)
  useRealtimeTopic(`ride:${rideId}`);

  const listQuery = trpc.messages.list.useQuery(
    { rideId },
    { enabled: Number.isFinite(rideId) && rideId > 0, refetchInterval: live ? false : 5000 }
  );
  const messages = listQuery.data ?? [];

  const sendMutation = trpc.messages.send.useMutation({
    onSuccess: (message) => {
      // Append optimistically-ish; the WS broadcast dedupes by id
      utils.messages.list.setData({ rideId }, (old) => {
        if (!old) return [message];
        if (old.some((m) => m.id === message.id)) return old;
        return [...old, message];
      });
    },
  });

  const handleSend = useCallback(() => {
    const body = draft.trim();
    if (!body || sendMutation.isPending) return;
    setDraft("");
    sendMutation.mutate(
      { rideId, body },
      {
        onError: () => setDraft(body), // give the text back on failure
      }
    );
  }, [draft, rideId, sendMutation]);

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => {
            // Return to the ride screen explicitly — back() inside a Tabs
            // navigator may land on another tab and strand the user.
            if (backTo) {
              router.replace(backTo as any);
            } else {
              router.back();
            }
          }}
        >
          <Text style={styles.backBtnText}>‹</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{title}</Text>
          <Text style={[styles.headerSub, { color: live ? COLORS.green : COLORS.muted }]}>
            {live ? "● live" : "connecting..."}
          </Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        {/* Messages */}
        {listQuery.isLoading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={accent} />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => String(m.id)}
            contentContainerStyle={styles.listContent}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyIcon}>💬</Text>
                <Text style={styles.emptyText}>No messages yet. Say hello!</Text>
              </View>
            }
            renderItem={({ item }) => {
              const mine = item.senderId === myUserId;
              return (
                <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : null]}>
                  <View
                    style={[
                      styles.bubble,
                      mine ? { backgroundColor: accent } : styles.bubbleTheirs,
                    ]}
                  >
                    <Text style={[styles.bubbleText, mine ? styles.bubbleTextMine : null]}>
                      {item.body}
                    </Text>
                    <Text style={[styles.bubbleTime, mine ? styles.bubbleTimeMine : null]}>
                      {formatTime(new Date(item.createdAt))}
                    </Text>
                  </View>
                </View>
              );
            }}
          />
        )}

        {/* Composer */}
        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Type a message..."
            placeholderTextColor={COLORS.muted}
            multiline
            maxLength={1000}
            onSubmitEditing={handleSend}
          />
          <TouchableOpacity
            style={[
              styles.sendBtn,
              { backgroundColor: draft.trim() ? accent : COLORS.surface2 },
            ]}
            onPress={handleSend}
            disabled={!draft.trim() || sendMutation.isPending}
          >
            {sendMutation.isPending ? (
              <ActivityIndicator size="small" color="#000" />
            ) : (
              <Text style={[styles.sendBtnText, { color: draft.trim() ? "#000" : COLORS.muted }]}>
                ➤
              </Text>
            )}
          </TouchableOpacity>
        </View>
        {sendMutation.isError && (
          <Text style={styles.errorText}>
            {sendMutation.error?.message ?? "Couldn't send. Try again."}
          </Text>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: COLORS.surface2,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  backBtnText: { fontSize: 22, color: COLORS.foreground, marginTop: -2 },
  headerTitle: { fontSize: 16, fontWeight: "800", color: COLORS.foreground },
  headerSub: { fontSize: 11, fontWeight: "600" },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 16, gap: 8, flexGrow: 1 },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  emptyIcon: { fontSize: 36 },
  emptyText: { fontSize: 14, color: COLORS.muted },
  bubbleRow: { flexDirection: "row", justifyContent: "flex-start" },
  bubbleRowMine: { justifyContent: "flex-end" },
  bubble: {
    maxWidth: "78%",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleTheirs: {
    backgroundColor: COLORS.surface2,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  bubbleText: { fontSize: 14, color: COLORS.foreground, lineHeight: 19 },
  bubbleTextMine: { color: "#001018" },
  bubbleTime: { fontSize: 9, color: COLORS.muted, marginTop: 4, alignSelf: "flex-end" },
  bubbleTimeMine: { color: "rgba(0,16,24,0.55)" },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 110,
    backgroundColor: COLORS.surface2,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: COLORS.foreground,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnText: { fontSize: 17, fontWeight: "700" },
  errorText: {
    fontSize: 12,
    color: COLORS.error,
    textAlign: "center",
    paddingBottom: 8,
    backgroundColor: COLORS.surface,
  },
});
