import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRideX } from "@/lib/ridex-context";
import { trpc } from "@/lib/trpc";

const { width } = Dimensions.get("window");

const COLORS = {
  bg: "#060c18",
  surface: "#0f1a2e",
  surface2: "#162035",
  primary: "#00c8ff",
  success: "#00e887",
  foreground: "#ffffff",
  muted: "#8899aa",
  border: "#1e3050",
};

export default function RoleSelectScreen() {
  const router = useRouter();
  const { setRole } = useRideX();
  const [selected, setSelected] = useState<"passenger" | "driver" | null>(null);
  const [loading, setLoading] = useState(false);

  const setRoleMutation = trpc.auth.setRole.useMutation();

  const handleContinue = async () => {
    if (!selected) return;
    setLoading(true);
    try {
      // Persist on the server (users.appRole + create the profile row).
      // Local state is still updated on failure so the app works offline.
      await setRoleMutation.mutateAsync({ role: selected });
    } catch (err) {
      console.warn("[RoleSelect] Failed to save role to server:", err);
    }
    await setRole(selected);
    setLoading(false);
    if (selected === "passenger") {
      router.replace("/(passenger)/home");
    } else {
      // New drivers land on their profile with the vehicle editor open, so
      // they can enter vehicle details before taking requests.
      router.replace({ pathname: "/(driver)/profile", params: { setup: "1" } } as any);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.badge}>
            <View style={styles.badgeDot} />
            <Text style={styles.badgeText}>VERIFIED</Text>
          </View>
          <View style={styles.logoRow}>
            <View style={styles.logoIcon}>
              <Text style={styles.logoLetter}>R</Text>
            </View>
            <Text style={styles.logoText}>
              Ride<Text style={styles.logoX}>X</Text>
            </Text>
          </View>
          <Text style={styles.title}>How are you{"\n"}
            <Text style={styles.titleAccent}>riding today?</Text>
          </Text>
          <Text style={styles.subtitle}>Select your role to continue</Text>
        </View>

        {/* Role Cards */}
        <View style={styles.cards}>
          {/* Passenger Card */}
          <TouchableOpacity
            style={[
              styles.roleCard,
              selected === "passenger" && styles.roleCardSelected,
            ]}
            onPress={() => setSelected("passenger")}
          >
            <View style={styles.roleCardInner}>
              <View style={[styles.roleIcon, selected === "passenger" && styles.roleIconActive]}>
                <Text style={styles.roleIconText}>📍</Text>
              </View>
              <View style={styles.roleInfo}>
                <Text style={styles.roleName}>Passenger</Text>
                <Text style={styles.roleDesc}>Book a ride</Text>
              </View>
              {selected === "passenger" && (
                <View style={styles.checkBadge}>
                  <Text style={styles.checkText}>✓</Text>
                </View>
              )}
            </View>
            {/* Animated route preview */}
            <View style={styles.routePreview}>
              <View style={styles.routeDot} />
              <View style={styles.routeLine} />
              <View style={[styles.routeDot, styles.routeDotEnd]} />
            </View>
          </TouchableOpacity>

          {/* Driver Card */}
          <TouchableOpacity
            style={[
              styles.roleCard,
              selected === "driver" && styles.roleCardDriverSelected,
            ]}
            onPress={() => setSelected("driver")}
          >
            <View style={styles.roleCardInner}>
              <View style={[styles.roleIcon, selected === "driver" && styles.roleIconDriverActive]}>
                <Text style={styles.roleIconText}>🚗</Text>
              </View>
              <View style={styles.roleInfo}>
                <Text style={styles.roleName}>Driver</Text>
                <Text style={styles.roleDesc}>Start earning</Text>
              </View>
              {selected === "driver" && (
                <View style={[styles.checkBadge, styles.checkBadgeDriver]}>
                  <Text style={styles.checkText}>✓</Text>
                </View>
              )}
            </View>
            {/* Earnings preview */}
            <View style={styles.earningsPreview}>
              <Text style={styles.earningsAmount}>GH₵284</Text>
              <Text style={styles.earningsSub}>.50 today</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Continue Button */}
        <TouchableOpacity
          style={[
            styles.continueBtn,
            !selected && styles.continueBtnDisabled,
            selected === "driver" && styles.continueBtnDriver,
          ]}
          onPress={handleContinue}
          disabled={!selected || loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.continueBtnText}>
              Continue as {selected === "passenger" ? "Passenger" : selected === "driver" ? "Driver" : "..."}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 32,
    justifyContent: "space-between",
  },
  header: {
    alignItems: "flex-start",
    marginBottom: 24,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0, 232, 135, 0.12)",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: "rgba(0, 232, 135, 0.3)",
    marginBottom: 16,
    alignSelf: "flex-end",
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#00e887",
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#00e887",
    letterSpacing: 1,
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 20,
  },
  logoIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  logoLetter: {
    fontSize: 20,
    fontWeight: "800",
    color: "#fff",
  },
  logoText: {
    fontSize: 26,
    fontWeight: "800",
    color: COLORS.foreground,
  },
  logoX: {
    color: COLORS.primary,
  },
  title: {
    fontSize: 30,
    fontWeight: "700",
    color: COLORS.foreground,
    lineHeight: 38,
    marginBottom: 8,
  },
  titleAccent: {
    color: COLORS.primary,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.muted,
  },
  cards: {
    flex: 1,
    gap: 16,
    justifyContent: "center",
  },
  roleCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    overflow: "hidden",
  },
  roleCardSelected: {
    borderColor: COLORS.primary,
    backgroundColor: "rgba(0, 200, 255, 0.06)",
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 6,
  },
  roleCardDriverSelected: {
    borderColor: "#00e887",
    backgroundColor: "rgba(0, 232, 135, 0.06)",
    shadowColor: "#00e887",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 6,
  },
  roleCardInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  roleIcon: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: COLORS.surface2,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  roleIconActive: {
    backgroundColor: "rgba(0, 200, 255, 0.12)",
    borderColor: COLORS.primary,
  },
  roleIconDriverActive: {
    backgroundColor: "rgba(0, 232, 135, 0.12)",
    borderColor: "#00e887",
  },
  roleIconText: {
    fontSize: 24,
  },
  roleInfo: {
    flex: 1,
  },
  roleName: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.foreground,
    marginBottom: 2,
  },
  roleDesc: {
    fontSize: 13,
    color: COLORS.muted,
  },
  checkBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  checkBadgeDriver: {
    backgroundColor: "#00e887",
  },
  checkText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff",
  },
  routePreview: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 16,
    paddingHorizontal: 4,
    gap: 0,
  },
  routeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.primary,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 3,
  },
  routeDotEnd: {
    backgroundColor: "#00e887",
    shadowColor: "#00e887",
  },
  routeLine: {
    flex: 1,
    height: 2,
    backgroundColor: COLORS.primary,
    opacity: 0.4,
    marginHorizontal: 4,
    borderStyle: "dashed",
  },
  earningsPreview: {
    flexDirection: "row",
    alignItems: "baseline",
    marginTop: 12,
  },
  earningsAmount: {
    fontSize: 28,
    fontWeight: "800",
    color: "#00e887",
  },
  earningsSub: {
    fontSize: 14,
    color: COLORS.muted,
    marginLeft: 2,
  },
  continueBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 24,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
  },
  continueBtnDriver: {
    backgroundColor: "#00e887",
    shadowColor: "#00e887",
  },
  continueBtnDisabled: {
    backgroundColor: COLORS.surface2,
    shadowOpacity: 0,
    elevation: 0,
  },
  continueBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fff",
  },
});
