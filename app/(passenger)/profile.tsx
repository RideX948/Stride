import { useRouter } from "expo-router";
import React from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRideX } from "@/lib/ridex-context";
import { trpc } from "@/lib/trpc";

const COLORS = {
  bg: "#060c18",
  surface: "#0f1a2e",
  surface2: "#162035",
  primary: "#00c8ff",
  success: "#00e887",
  foreground: "#ffffff",
  muted: "#8899aa",
  border: "#1e3050",
  warning: "#f59e0b",
  error: "#ff4444",
  purple: "#8844ff",
};

const SETTINGS = [
  { id: "1", icon: "👤", label: "Account Information", sub: "Edit your profile details" },
  { id: "2", icon: "💳", label: "Payment Methods", sub: "Manage your cards and wallets" },
  { id: "3", icon: "🛡️", label: "Privacy & Security", sub: "Manage your account security" },
  { id: "4", icon: "🔔", label: "Notifications", sub: "Manage your alerts" },
  { id: "5", icon: "⚙️", label: "App Settings", sub: "Preferences and configurations" },
  { id: "6", icon: "❓", label: "Help & Support", sub: "Get help and contact us" },
];

export default function PassengerProfileScreen() {
  const router = useRouter();
  const { user, logout } = useRideX();
  const userId = Number(user?.id);

  const profileQuery = trpc.passenger.getProfile.useQuery(undefined, {
    enabled: Number.isFinite(userId),
  });
  const walletQuery = trpc.passenger.getWallet.useQuery(undefined, {
    enabled: Number.isFinite(userId),
  });
  const historyQuery = trpc.rides.passengerHistory.useQuery(
    { limit: 50 },
    { enabled: Number.isFinite(userId) }
  );

  const profile = profileQuery.data;
  const totalRides = profile?.totalRides ?? 0;
  const walletBalance = parseFloat(walletQuery.data?.balance ?? "0");
  const completed = (historyQuery.data ?? []).filter((r) => r.status === "completed");
  const totalSpent = completed.reduce(
    (s, r) => s + parseFloat(r.actualFare ?? r.estimatedFare ?? "0"),
    0
  );
  const totalKm = completed.reduce((s, r) => s + parseFloat(r.distanceKm ?? "0"), 0);
  const recentRides = completed.slice(0, 2).map((r) => ({
    id: String(r.id),
    from: r.pickupAddress,
    to: r.destinationAddress,
    date:
      new Date(r.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
      ", " +
      new Date(r.createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
    fare: parseFloat(r.actualFare ?? r.estimatedFare ?? "0"),
    type: r.rideType.charAt(0).toUpperCase() + r.rideType.slice(1),
    duration: r.durationMin ?? 0,
    distance: parseFloat(r.distanceKm ?? "0"),
  }));

  const handleLogout = async () => {
    await logout();
    router.replace("/auth" as any);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backIcon}>←</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.editBtn}>
            <Text style={styles.editIcon}>✏️</Text>
            <Text style={styles.editText}>Edit Profile</Text>
          </TouchableOpacity>
        </View>

        {/* Profile Card */}
        <View style={styles.profileCard}>
          <View style={styles.avatarWrap}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {user?.name?.charAt(0) ?? "A"}
              </Text>
            </View>
            <View style={styles.verifiedBadge}>
              <Text style={styles.verifiedIcon}>✓</Text>
            </View>
          </View>
          <Text style={styles.profileName}>{user?.name ?? "RideX User"}</Text>
          <Text style={styles.profilePhone}>{user?.phone ?? ""}</Text>
        </View>

        {/* Stats Row */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{totalRides}</Text>
            <Text style={styles.statLabel}>Total Rides</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>GH₵{totalSpent.toFixed(0)}</Text>
            <Text style={styles.statLabel}>Total Spent</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{totalKm.toFixed(0)} km</Text>
            <Text style={styles.statLabel}>Distance</Text>
          </View>
        </View>

        {/* Ride History */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Ride History</Text>
            <TouchableOpacity onPress={() => router.push("/(passenger)/activity" as any)}>
              <Text style={styles.viewAll}>View All ›</Text>
            </TouchableOpacity>
          </View>
          {recentRides.length === 0 && (
            <Text style={{ color: COLORS.muted, fontSize: 13, marginBottom: 4 }}>
              No completed rides yet.
            </Text>
          )}
          {recentRides.map((ride) => (
            <TouchableOpacity key={ride.id} style={styles.rideCard}>
              <View style={styles.rideMiniMap}>
                <View style={styles.rideMiniRoute}>
                  <View style={styles.rideMiniStart} />
                  <View style={styles.rideMiniLine} />
                  <View style={styles.rideMiniEnd} />
                </View>
              </View>
              <View style={styles.rideInfo}>
                <Text style={styles.rideDate}>{ride.date}</Text>
                <Text style={styles.rideFrom} numberOfLines={1}>📍 {ride.from}</Text>
                <Text style={styles.rideTo} numberOfLines={1}>🔴 {ride.to}</Text>
                <View style={styles.rideMeta}>
                  <Text style={styles.rideMetaText}>🚗 {ride.type}</Text>
                  <Text style={styles.rideMetaDot}>·</Text>
                  <Text style={styles.rideMetaText}>⏱ {ride.duration} min</Text>
                  <Text style={styles.rideMetaDot}>·</Text>
                  <Text style={styles.rideMetaText}>📍 {ride.distance} km</Text>
                </View>
              </View>
              <View style={styles.rideFareWrap}>
                <Text style={styles.rideFare}>GH₵{ride.fare.toFixed(2)}</Text>
                <Text style={styles.rideChevron}>›</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* Wallet Balance */}
        <View style={styles.section}>
          <TouchableOpacity style={styles.walletCard} onPress={() => router.push("/(passenger)/wallet" as any)}>
            <View style={styles.walletIconWrap}>
              <Text style={styles.walletIcon}>💳</Text>
            </View>
            <View style={styles.walletInfo}>
              <Text style={styles.walletLabel}>Wallet Balance</Text>
              <Text style={styles.walletAmount}>GH₵{walletBalance.toFixed(2)}</Text>
            </View>
            <TouchableOpacity style={styles.addMoneyBtn}>
              <Text style={styles.addMoneyText}>Add Money</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </View>

        {/* Settings */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Settings</Text>
          <View style={styles.settingsList}>
            {SETTINGS.map((s) => (
              <TouchableOpacity key={s.id} style={styles.settingRow}>
                <View style={styles.settingIconWrap}>
                  <Text style={styles.settingIcon}>{s.icon}</Text>
                </View>
                <View style={styles.settingInfo}>
                  <Text style={styles.settingLabel}>{s.label}</Text>
                  {s.sub && <Text style={styles.settingSub}>{s.sub}</Text>}
                </View>
                <Text style={styles.settingChevron}>›</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Logout */}
        <View style={styles.section}>
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
            <Text style={styles.logoutIcon}>🚪</Text>
            <Text style={styles.logoutText}>Log Out</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  backIcon: {
    fontSize: 18,
    color: COLORS.foreground,
  },
  editBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  editIcon: {
    fontSize: 14,
  },
  editText: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.foreground,
  },
  profileCard: {
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  avatarWrap: {
    position: "relative",
    marginBottom: 14,
  },
  avatar: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: COLORS.surface,
  },
  avatarText: {
    fontSize: 36,
    fontWeight: "700",
    color: "#fff",
  },
  verifiedBadge: {
    position: "absolute",
    bottom: 2,
    right: 2,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: COLORS.bg,
  },
  verifiedIcon: {
    fontSize: 12,
    color: "#fff",
    fontWeight: "700",
  },
  profileName: {
    fontSize: 24,
    fontWeight: "800",
    color: COLORS.foreground,
    marginBottom: 4,
  },
  profilePhone: {
    fontSize: 14,
    color: COLORS.muted,
    marginBottom: 12,
  },
  statsRow: {
    flexDirection: "row",
    marginHorizontal: 20,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statItem: {
    flex: 1,
    alignItems: "center",
  },
  statValue: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.foreground,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 11,
    color: COLORS.muted,
    textAlign: "center",
  },
  statDivider: {
    width: 1,
    backgroundColor: COLORS.border,
    marginVertical: 4,
  },
  section: {
    marginHorizontal: 20,
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.foreground,
    marginBottom: 12,
  },
  viewAll: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: "600",
  },
  rideCard: {
    flexDirection: "row",
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    overflow: "hidden",
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
  },
  rideMiniMap: {
    width: 72,
    height: 80,
    backgroundColor: COLORS.surface2,
    position: "relative",
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },
  rideMiniRoute: {
    alignItems: "center",
    height: 50,
  },
  rideMiniStart: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.success,
  },
  rideMiniLine: {
    flex: 1,
    width: 2,
    backgroundColor: COLORS.primary,
    opacity: 0.5,
  },
  rideMiniEnd: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.error,
  },
  rideInfo: {
    flex: 1,
    padding: 12,
  },
  rideDate: {
    fontSize: 11,
    color: COLORS.muted,
    marginBottom: 4,
  },
  rideFrom: {
    fontSize: 13,
    color: COLORS.foreground,
    fontWeight: "500",
    marginBottom: 2,
  },
  rideTo: {
    fontSize: 13,
    color: COLORS.foreground,
    fontWeight: "500",
    marginBottom: 6,
  },
  rideMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  rideMetaText: {
    fontSize: 11,
    color: COLORS.muted,
  },
  rideMetaDot: {
    fontSize: 11,
    color: COLORS.border,
  },
  rideFareWrap: {
    alignItems: "flex-end",
    paddingRight: 12,
    gap: 4,
  },
  rideFare: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.foreground,
  },
  rideChevron: {
    fontSize: 18,
    color: COLORS.muted,
  },
  walletCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 14,
  },
  walletIconWrap: {
    width: 50,
    height: 50,
    borderRadius: 14,
    backgroundColor: "rgba(136, 68, 255, 0.15)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(136, 68, 255, 0.3)",
  },
  walletIcon: {
    fontSize: 22,
  },
  walletInfo: {
    flex: 1,
  },
  walletLabel: {
    fontSize: 13,
    color: COLORS.muted,
    marginBottom: 3,
  },
  walletAmount: {
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.foreground,
  },
  addMoneyBtn: {
    backgroundColor: COLORS.purple,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  addMoneyText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#fff",
  },
  settingsList: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: "hidden",
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: 12,
  },
  settingIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: COLORS.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  settingIcon: {
    fontSize: 18,
  },
  settingInfo: {
    flex: 1,
  },
  settingLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.foreground,
    marginBottom: 2,
  },
  settingSub: {
    fontSize: 12,
    color: COLORS.muted,
  },
  settingChevron: {
    fontSize: 20,
    color: COLORS.muted,
  },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 68, 68, 0.1)",
    borderRadius: 16,
    height: 52,
    gap: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 68, 68, 0.25)",
  },
  logoutIcon: {
    fontSize: 18,
  },
  logoutText: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.error,
  },
});
