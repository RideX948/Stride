import React, { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { trpc } from "@/lib/trpc";
import { useRideX } from "@/lib/ridex-context";
import { useRealtimeConnected } from "@/hooks/use-realtime";

const COLORS = {
  bg: "#060c18",
  surface: "#0f1a2e",
  surface2: "#162035",
  primary: "#00c8ff",
  success: "#00e887",
  foreground: "#ffffff",
  muted: "#8899aa",
  border: "#1e3050",
  error: "#ff4444",
};

// Icon per notification type (types come from server/routers.ts createNotification calls)
const TYPE_ICONS: Record<string, string> = {
  ride_requested: "🔍",
  driver_assigned: "🚗",
  driver_arriving: "📍",
  trip_started: "🛣️",
  ride_completed: "🎉",
  ride_cancelled: "✕",
  rating_received: "⭐",
  sos_alert: "🚨",
};

function timeAgo(date: string | Date): string {
  const diffMs = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Bell icon + unread badge + slide-up notifications panel.
 * Drop-in replacement for the previously-dead bell buttons: polls the unread
 * count, and opens a panel listing notifications (tap = mark read).
 *
 * Pass `accent` to match the host screen (cyan for passenger, green for driver).
 */
export function NotificationsBell({
  accent = COLORS.primary,
  style,
}: {
  accent?: string;
  style?: object;
}) {
  const { user } = useRideX();
  const userId = Number(user?.id);
  const [open, setOpen] = useState(false);
  // notification:new events invalidate this cache instantly; the poll is a
  // slow fallback while the push channel is down
  const live = useRealtimeConnected();

  const unreadQuery = trpc.notifications.getUnreadCount.useQuery(
    { userId },
    { enabled: Number.isFinite(userId), refetchInterval: live ? 60000 : 15000 }
  );
  const listQuery = trpc.notifications.getAll.useQuery(
    { userId, limit: 30 },
    { enabled: Number.isFinite(userId) && open }
  );
  const markRead = trpc.notifications.markRead.useMutation();
  const markAllRead = trpc.notifications.markAllRead.useMutation();

  const unread = unreadQuery.data?.count ?? 0;
  const notifications = listQuery.data ?? [];

  const refresh = () => {
    unreadQuery.refetch();
    listQuery.refetch();
  };

  const handleOpen = () => {
    setOpen(true);
    listQuery.refetch();
  };

  const handleTap = async (id: number, isRead: boolean) => {
    if (isRead) return;
    try {
      await markRead.mutateAsync({ notificationId: id });
      refresh();
    } catch (err) {
      console.warn("[Notifications] markRead failed:", err);
    }
  };

  const handleMarkAll = async () => {
    try {
      await markAllRead.mutateAsync({ userId });
      refresh();
    } catch (err) {
      console.warn("[Notifications] markAllRead failed:", err);
    }
  };

  return (
    <>
      <TouchableOpacity style={[styles.bellBtn, style]} onPress={handleOpen}>
        <Text style={styles.bellIcon}>🔔</Text>
        {unread > 0 && (
          <View style={[styles.badge, { backgroundColor: accent }]}>
            <Text style={styles.badgeText}>{unread > 9 ? "9+" : unread}</Text>
          </View>
        )}
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" transparent>
        <View style={styles.overlay}>
          <View style={styles.panel}>
            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.title}>Notifications</Text>
              <View style={styles.headerActions}>
                {unread > 0 && (
                  <TouchableOpacity onPress={handleMarkAll}>
                    <Text style={[styles.markAll, { color: accent }]}>Mark all read</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => setOpen(false)}>
                  <Text style={styles.closeBtn}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* List */}
            {listQuery.isLoading ? (
              <View style={styles.empty}>
                <ActivityIndicator color={accent} />
              </View>
            ) : (
              <FlatList
                data={notifications}
                keyExtractor={(item) => String(item.id)}
                refreshing={listQuery.isRefetching}
                onRefresh={refresh}
                ListEmptyComponent={
                  <View style={styles.empty}>
                    <Text style={styles.emptyIcon}>🔕</Text>
                    <Text style={styles.emptyText}>No notifications yet</Text>
                  </View>
                }
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[styles.row, !item.isRead && styles.rowUnread]}
                    onPress={() => handleTap(item.id, item.isRead)}
                  >
                    <View style={styles.rowIconWrap}>
                      <Text style={styles.rowIcon}>
                        {TYPE_ICONS[item.type] ?? "🔔"}
                      </Text>
                    </View>
                    <View style={styles.rowInfo}>
                      <Text style={[styles.rowTitle, !item.isRead && styles.rowTitleUnread]}>
                        {item.title}
                      </Text>
                      <Text style={styles.rowBody} numberOfLines={2}>
                        {item.body}
                      </Text>
                      <Text style={styles.rowTime}>{timeAgo(item.createdAt)}</Text>
                    </View>
                    {!item.isRead && <View style={[styles.unreadDot, { backgroundColor: accent }]} />}
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bellBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
    position: "relative",
  },
  bellIcon: {
    fontSize: 18,
  },
  badge: {
    position: "absolute",
    top: 4,
    right: 4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    fontSize: 9,
    fontWeight: "800",
    color: "#000",
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  panel: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 32,
    maxHeight: "75%",
    minHeight: "50%",
    borderTopWidth: 1,
    borderColor: COLORS.border,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    color: COLORS.foreground,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  markAll: {
    fontSize: 13,
    fontWeight: "700",
  },
  closeBtn: {
    fontSize: 18,
    color: COLORS.muted,
    padding: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  rowUnread: {
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  rowIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: COLORS.surface2,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  rowIcon: {
    fontSize: 18,
  },
  rowInfo: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.muted,
    marginBottom: 2,
  },
  rowTitleUnread: {
    color: COLORS.foreground,
    fontWeight: "700",
  },
  rowBody: {
    fontSize: 12,
    color: COLORS.muted,
    marginBottom: 4,
    lineHeight: 17,
  },
  rowTime: {
    fontSize: 11,
    color: COLORS.muted,
    opacity: 0.7,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
  },
  empty: {
    alignItems: "center",
    paddingVertical: 48,
    gap: 10,
  },
  emptyIcon: {
    fontSize: 40,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.muted,
  },
});
