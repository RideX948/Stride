import React, { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRideX } from "@/lib/ridex-context";
import { trpc } from "@/lib/trpc";
import { NotificationsBell } from "@/components/notifications-bell";

const COLORS = {
  bg: "#060c18",
  surface: "#0f1a2e",
  surface2: "#162035",
  primary: "#00e887",
  cyan: "#00c8ff",
  foreground: "#ffffff",
  muted: "#8899aa",
  border: "#1e3050",
  warning: "#f59e0b",
  error: "#ff4444",
};

const SETTINGS = [
  { id: "1", icon: "👤", label: "Personal Information", sub: "Edit your profile details" },
  { id: "2", icon: "🚗", label: "Vehicle Information", sub: "Manage your vehicle details" },
  { id: "3", icon: "💳", label: "Payment Methods", sub: "Manage your payout accounts" },
  { id: "4", icon: "🔔", label: "Notifications", sub: "Ride requests and alerts" },
  { id: "5", icon: "🛡", label: "Privacy & Security", sub: "Manage your account security" },
  { id: "6", icon: "⚙️", label: "App Settings", sub: "Preferences and configurations" },
  { id: "7", icon: "❓", label: "Help & Support", sub: "Get help and contact us" },
  { id: "8", icon: "📄", label: "Legal", sub: "Terms, privacy policy" },
];

export default function DriverProfileScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ setup?: string }>();
  const { user, logout } = useRideX();
  const userId = Number(user?.id);

  const profileQuery = trpc.driver.getProfile.useQuery(
    { userId },
    { enabled: Number.isFinite(userId) }
  );
  const profile = profileQuery.data;
  const driverId = profile?.id;

  const walletQuery = trpc.driver.getWallet.useQuery(
    { driverId: driverId ?? 0 },
    { enabled: !!driverId }
  );
  const earningsQuery = trpc.driver.earningsSummary.useQuery(
    { driverId: driverId ?? 0, period: "week" },
    { enabled: !!driverId }
  );
  const updateProfile = trpc.driver.updateProfile.useMutation();

  // Vehicle edit modal
  const [showVehicle, setShowVehicle] = useState(false);
  const [vehicleModel, setVehicleModel] = useState("");
  const [vehiclePlate, setVehiclePlate] = useState("");
  const [vehicleColor, setVehicleColor] = useState("");
  const [vehicleType, setVehicleType] = useState<"economy" | "comfort" | "premium">("economy");

  const openVehicleEditor = () => {
    setVehicleModel(profile?.vehicleModel ?? "");
    setVehiclePlate(profile?.vehiclePlate ?? "");
    setVehicleColor(profile?.vehicleColor ?? "");
    setVehicleType((profile?.vehicleType as "economy" | "comfort" | "premium") ?? "economy");
    setShowVehicle(true);
  };

  const handleSaveVehicle = async () => {
    try {
      await updateProfile.mutateAsync({
        userId,
        vehicleModel: vehicleModel.trim() || undefined,
        vehiclePlate: vehiclePlate.trim() || undefined,
        vehicleColor: vehicleColor.trim() || undefined,
        vehicleType,
      });
      setShowVehicle(false);
      profileQuery.refetch();
    } catch (err) {
      Alert.alert("Save failed", err instanceof Error ? err.message : "Could not reach the server.");
    }
  };

  // New drivers arrive from role-select with ?setup=1 — open the vehicle
  // editor once the profile has loaded so they can enter their details.
  const [setupOpened, setSetupOpened] = useState(false);
  useEffect(() => {
    if (params.setup === "1" && profile && !setupOpened) {
      openVehicleEditor();
      setSetupOpened(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.setup, profile, setupOpened]);

  const handleLogout = async () => {
    await logout();
    router.replace("/auth" as any);
  };

  const initials = (user?.name ?? "R X")
    .split(" ")
    .map((w) => w.charAt(0))
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const rating = parseFloat(profile?.rating ?? "5");
  const totalTrips = profile?.totalTrips ?? 0;
  const memberSince = profile?.createdAt
    ? new Date(profile.createdAt).toLocaleDateString(undefined, { month: "short", year: "numeric" })
    : "—";
  const walletBalance = parseFloat(walletQuery.data?.balance ?? "0");

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Profile</Text>
          <NotificationsBell accent="#00e887" />
        </View>

        {/* Profile Card */}
        <View style={styles.profileCard}>
          <View style={styles.profileTop}>
            <View style={styles.avatarWrap}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initials}</Text>
              </View>
              {profile?.isVerified && (
                <View style={styles.verifiedBadge}>
                  <Text style={styles.verifiedIcon}>✓</Text>
                </View>
              )}
            </View>
            <TouchableOpacity style={styles.editBtn} onPress={openVehicleEditor}>
              <Text style={styles.editBtnText}>✏ Edit Vehicle</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.profileName}>{user?.name ?? "RideX Driver"}</Text>
          <Text style={styles.profilePhone}>{user?.phone ?? ""}</Text>

          {/* Rating */}
          <View style={styles.ratingRow}>
            {[1, 2, 3, 4, 5].map((i) => (
              <Text key={i} style={[styles.star, i <= Math.round(rating) ? styles.starFilled : styles.starHalf]}>★</Text>
            ))}
            <Text style={styles.ratingText}>{rating.toFixed(2)}</Text>
            <Text style={styles.ratingCount}>· {totalTrips.toLocaleString()} trips</Text>
          </View>

          {/* Driver Stats */}
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{rating.toFixed(2)}</Text>
              <Text style={styles.statLabel}>Rating</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{totalTrips.toLocaleString()}</Text>
              <Text style={styles.statLabel}>Trips</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>
                {parseFloat(profile?.acceptanceRate ?? "100").toFixed(0)}%
              </Text>
              <Text style={styles.statLabel}>Acceptance</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{memberSince}</Text>
              <Text style={styles.statLabel}>Member</Text>
            </View>
          </View>
        </View>

        {/* Vehicle Card */}
        <TouchableOpacity style={styles.vehicleCard} onPress={openVehicleEditor}>
          <View style={styles.vehicleLeft}>
            <Text style={styles.vehicleIcon}>🚗</Text>
            <View>
              <Text style={styles.vehicleModel}>
                {profile?.vehicleModel ?? "Add your vehicle"}
              </Text>
              <Text style={styles.vehiclePlate}>
                {profile?.vehicleModel
                  ? [profile?.vehiclePlate, profile?.vehicleColor].filter(Boolean).join(" · ") || "Tap to add details"
                  : "Passengers see this on their tracking screen"}
              </Text>
            </View>
          </View>
          {profile?.isVerified ? (
            <View style={styles.vehicleBadge}>
              <Text style={styles.vehicleBadgeText}>✓ Verified</Text>
            </View>
          ) : (
            <Text style={styles.settingChevron}>›</Text>
          )}
        </TouchableOpacity>

        {/* Wallet Card */}
        <View style={styles.walletCard}>
          <View style={styles.walletLeft}>
            <View style={styles.walletIconWrap}>
              <Text style={styles.walletIcon}>💰</Text>
            </View>
            <View>
              <Text style={styles.walletLabel}>Wallet Balance</Text>
              <Text style={styles.walletAmount}>GH₵{walletBalance.toFixed(2)}</Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.withdrawBtn}
            onPress={() => router.push("/(driver)/earnings" as any)}
          >
            <Text style={styles.withdrawBtnText}>Withdraw</Text>
          </TouchableOpacity>
        </View>

        {/* Performance Card */}
        <View style={styles.performanceCard}>
          <Text style={styles.sectionTitle}>This Week's Performance</Text>
          <View style={styles.perfRow}>
            <View style={styles.perfItem}>
              <Text style={styles.perfValue}>GH₵{earningsQuery.data?.total ?? "0.00"}</Text>
              <Text style={styles.perfLabel}>Earnings</Text>
            </View>
            <View style={styles.perfItem}>
              <Text style={styles.perfValue}>{earningsQuery.data?.tripsCount ?? 0}</Text>
              <Text style={styles.perfLabel}>Trips</Text>
            </View>
            <View style={styles.perfItem}>
              <Text style={styles.perfValue}>
                {parseFloat(profile?.completionRate ?? "100").toFixed(0)}%
              </Text>
              <Text style={styles.perfLabel}>Completion</Text>
            </View>
          </View>
        </View>

        {/* Settings */}
        <View style={styles.settingsSection}>
          <Text style={styles.sectionTitle}>Settings</Text>
          {SETTINGS.map((item, index) => {
            const onPress = () => {
              if (item.label === "Vehicle Information" || item.label === "Personal Information") {
                openVehicleEditor();
              } else if (item.label === "Payment Methods") {
                router.push("/(driver)/earnings" as any);
              } else {
                Alert.alert(item.label, "This section is coming soon.");
              }
            };
            return (
              <TouchableOpacity
                key={item.id}
                style={[
                  styles.settingRow,
                  index === SETTINGS.length - 1 && styles.settingRowLast,
                ]}
                onPress={onPress}
              >
                <View style={styles.settingIconWrap}>
                  <Text style={styles.settingIcon}>{item.icon}</Text>
                </View>
                <View style={styles.settingInfo}>
                  <Text style={styles.settingLabel}>{item.label}</Text>
                  <Text style={styles.settingSub}>{item.sub}</Text>
                </View>
                <Text style={styles.settingChevron}>›</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Logout */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutIcon}>🚪</Text>
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Vehicle Edit Modal */}
      <Modal visible={showVehicle} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.vehicleModal}>
            <View style={styles.vehicleModalHeader}>
              <Text style={styles.vehicleModalTitle}>Vehicle Information</Text>
              <TouchableOpacity onPress={() => setShowVehicle(false)}>
                <Text style={styles.vehicleModalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>Vehicle Model</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Toyota Corolla 2021"
              placeholderTextColor={COLORS.muted}
              value={vehicleModel}
              onChangeText={setVehicleModel}
            />

            <Text style={styles.inputLabel}>License Plate</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. GR-1234-22"
              placeholderTextColor={COLORS.muted}
              value={vehiclePlate}
              onChangeText={setVehiclePlate}
              autoCapitalize="characters"
            />

            <Text style={styles.inputLabel}>Color</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Silver"
              placeholderTextColor={COLORS.muted}
              value={vehicleColor}
              onChangeText={setVehicleColor}
            />

            <Text style={styles.inputLabel}>Ride Type</Text>
            <View style={styles.typeRow}>
              {(["economy", "comfort", "premium"] as const).map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.typeChip, vehicleType === t && styles.typeChipActive]}
                  onPress={() => setVehicleType(t)}
                >
                  <Text style={[styles.typeChipText, vehicleType === t && styles.typeChipTextActive]}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.typeHint}>
              You'll receive requests for this ride type.
            </Text>

            <TouchableOpacity
              style={[styles.saveBtn, updateProfile.isPending && { opacity: 0.7 }]}
              onPress={handleSaveVehicle}
              disabled={updateProfile.isPending}
            >
              <Text style={styles.saveBtnText}>
                {updateProfile.isPending ? "Saving..." : "Save Vehicle"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: COLORS.foreground,
  },
  notifBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  notifIcon: {
    fontSize: 20,
  },
  notifDot: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
  },
  profileCard: {
    marginHorizontal: 20,
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  profileTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  avatarWrap: {
    position: "relative",
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(0, 232, 135, 0.15)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: COLORS.primary,
  },
  avatarText: {
    fontSize: 28,
    fontWeight: "800",
    color: COLORS.primary,
  },
  verifiedBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: COLORS.surface,
  },
  verifiedIcon: {
    fontSize: 11,
    fontWeight: "800",
    color: "#000",
  },
  editBtn: {
    backgroundColor: COLORS.surface2,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  editBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.foreground,
  },
  profileName: {
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.foreground,
    marginBottom: 2,
  },
  profilePhone: {
    fontSize: 14,
    color: COLORS.muted,
    marginBottom: 10,
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    marginBottom: 16,
  },
  star: {
    fontSize: 16,
  },
  starFilled: {
    color: COLORS.warning,
  },
  starHalf: {
    color: COLORS.border,
  },
  ratingText: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.foreground,
    marginLeft: 4,
  },
  ratingCount: {
    fontSize: 13,
    color: COLORS.muted,
  },
  statsRow: {
    flexDirection: "row",
    backgroundColor: COLORS.surface2,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statItem: {
    flex: 1,
    alignItems: "center",
  },
  statValue: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.foreground,
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 10,
    color: COLORS.muted,
  },
  statDivider: {
    width: 1,
    backgroundColor: COLORS.border,
    marginVertical: 4,
  },
  vehicleCard: {
    marginHorizontal: 20,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  vehicleLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  vehicleIcon: {
    fontSize: 28,
  },
  vehicleModel: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.foreground,
    marginBottom: 2,
  },
  vehiclePlate: {
    fontSize: 12,
    color: COLORS.muted,
  },
  vehicleBadge: {
    backgroundColor: "rgba(0, 232, 135, 0.1)",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: "rgba(0, 232, 135, 0.25)",
  },
  vehicleBadgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.primary,
  },
  walletCard: {
    marginHorizontal: 20,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  walletLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  walletIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "rgba(0, 232, 135, 0.1)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(0, 232, 135, 0.2)",
  },
  walletIcon: {
    fontSize: 22,
  },
  walletLabel: {
    fontSize: 12,
    color: COLORS.muted,
    marginBottom: 2,
  },
  walletAmount: {
    fontSize: 20,
    fontWeight: "800",
    color: COLORS.foreground,
  },
  withdrawBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  withdrawBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#000",
  },
  performanceCard: {
    marginHorizontal: 20,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.foreground,
    marginBottom: 12,
  },
  perfRow: {
    flexDirection: "row",
    marginBottom: 14,
  },
  perfItem: {
    flex: 1,
    alignItems: "center",
  },
  perfValue: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.foreground,
    marginBottom: 2,
  },
  perfLabel: {
    fontSize: 11,
    color: COLORS.muted,
    marginBottom: 2,
  },
  perfChange: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.primary,
  },
  goalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  goalLabel: {
    fontSize: 12,
    color: COLORS.muted,
  },
  goalPct: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.primary,
  },
  progressBg: {
    height: 6,
    backgroundColor: COLORS.surface2,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: COLORS.primary,
    borderRadius: 3,
  },
  settingsSection: {
    marginHorizontal: 20,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    marginBottom: 12,
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
  settingRowLast: {
    borderBottomWidth: 0,
  },
  settingIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: COLORS.surface2,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  settingIcon: {
    fontSize: 18,
  },
  settingInfo: {
    flex: 1,
  },
  settingLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.foreground,
    marginBottom: 1,
  },
  settingSub: {
    fontSize: 11,
    color: COLORS.muted,
  },
  settingChevron: {
    fontSize: 20,
    color: COLORS.muted,
  },
  logoutBtn: {
    marginHorizontal: 20,
    backgroundColor: "rgba(255, 68, 68, 0.08)",
    borderRadius: 14,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(255, 68, 68, 0.2)",
  },
  logoutIcon: {
    fontSize: 18,
  },
  logoutText: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.error,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "flex-end",
  },
  vehicleModal: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  vehicleModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  vehicleModalTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: COLORS.foreground,
  },
  vehicleModalClose: {
    fontSize: 18,
    color: COLORS.muted,
    padding: 4,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.muted,
    marginBottom: 6,
  },
  input: {
    backgroundColor: COLORS.surface2,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 48,
    fontSize: 15,
    color: COLORS.foreground,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 14,
  },
  typeRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 6,
  },
  typeChip: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    backgroundColor: COLORS.surface2,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  typeChipActive: {
    backgroundColor: "rgba(0, 232, 135, 0.1)",
    borderColor: COLORS.primary,
  },
  typeChipText: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.muted,
  },
  typeChipTextActive: {
    color: COLORS.primary,
  },
  typeHint: {
    fontSize: 11,
    color: COLORS.muted,
    marginBottom: 16,
  },
  saveBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: "800",
    color: "#000",
  },
});
