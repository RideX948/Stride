import React, { useEffect, useRef, useState } from "react";
import { router } from "expo-router";
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

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

const COUNTDOWN_SECONDS = 15;

function CountdownRing({ seconds, total }: { seconds: number; total: number }) {
  const size = 80;
  const strokeWidth = 5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = seconds / total;
  const strokeDashoffset = circumference * (1 - progress);

  const color = seconds > 8 ? COLORS.primary : seconds > 4 ? COLORS.warning : COLORS.error;

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {/* Background circle */}
      <View
        style={{
          position: "absolute",
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: strokeWidth,
          borderColor: COLORS.surface2,
        }}
      />
      {/* Progress indicator - simplified */}
      <View
        style={{
          position: "absolute",
          width: size - strokeWidth * 2,
          height: size - strokeWidth * 2,
          borderRadius: (size - strokeWidth * 2) / 2,
          borderWidth: strokeWidth,
          borderColor: color,
          borderTopColor: "transparent",
          transform: [{ rotate: `${(1 - progress) * 360}deg` }],
        }}
      />
      <Text style={{ fontSize: 24, fontWeight: "800", color: color }}>{seconds}</Text>
      <Text style={{ fontSize: 9, color: COLORS.muted, marginTop: -2 }}>sec</Text>
    </View>
  );
}

export default function IncomingRequestScreen() {
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [accepted, setAccepted] = useState(false);
  const [declined, setDeclined] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Pulse animation
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.05, duration: 500, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      ])
    );
    pulse.start();

    // Countdown timer
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setDeclined(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearInterval(timer);
      pulse.stop();
    };
  }, []);

  const handleAccept = () => {
    setAccepted(true);
    setTimeout(() => router.replace("/(driver)/home"), 1500);
  };

  const handleDecline = () => {
    setDeclined(true);
    setTimeout(() => router.replace("/(driver)/home"), 1000);
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Map Background */}
      <View style={styles.mapBg}>
        {/* Grid lines */}
        {Array.from({ length: 8 }).map((_, i) => (
          <View key={`h${i}`} style={[styles.gridH, { top: `${i * 14}%` as any }]} />
        ))}
        {Array.from({ length: 6 }).map((_, i) => (
          <View key={`v${i}`} style={[styles.gridV, { left: `${i * 20}%` as any }]} />
        ))}
        {/* Driver location dot */}
        <View style={styles.driverDot}>
          <View style={styles.driverDotInner} />
        </View>
      </View>

      {/* Dim overlay */}
      <View style={styles.overlay} />

      {/* Stats bar at top */}
      <View style={styles.statsBar}>
        <View style={styles.statChip}>
          <Text style={styles.statChipLabel}>Today</Text>
          <Text style={styles.statChipValue}>GH₵142.80</Text>
        </View>
        <View style={styles.statChip}>
          <Text style={styles.statChipLabel}>Trips</Text>
          <Text style={styles.statChipValue}>8</Text>
        </View>
        <View style={styles.statChip}>
          <Text style={styles.statChipLabel}>Rating</Text>
          <Text style={styles.statChipValue}>4.97 ★</Text>
        </View>
      </View>

      {/* Request Card */}
      <View style={styles.requestCard}>
        {/* Card Header */}
        <View style={styles.cardHeader}>
          <View style={styles.newRequestBadge}>
            <View style={styles.newRequestDot} />
            <Text style={styles.newRequestText}>NEW RIDE REQUEST</Text>
          </View>
          <CountdownRing seconds={countdown} total={COUNTDOWN_SECONDS} />
        </View>

        <Text style={styles.incomingTitle}>Incoming Request</Text>

        {/* Fare & Trip Info */}
        <View style={styles.fareRow}>
          <View style={styles.fareBox}>
            <Text style={styles.fareLabel}>FARE</Text>
            <Text style={styles.fareAmount}>GH₵18.40</Text>
            <Text style={styles.fareType}>fixed price</Text>
          </View>
          <View style={styles.tripInfoGrid}>
            <View style={styles.tripInfoItem}>
              <Text style={styles.tripInfoIcon}>📏</Text>
              <Text style={styles.tripInfoValue}>3.4 km</Text>
              <Text style={styles.tripInfoLabel}>distance</Text>
            </View>
            <View style={styles.tripInfoItem}>
              <Text style={styles.tripInfoIcon}>⏱</Text>
              <Text style={styles.tripInfoValue}>~12 min</Text>
              <Text style={styles.tripInfoLabel}>est. trip</Text>
            </View>
            <View style={styles.tripInfoItem}>
              <Text style={styles.tripInfoIcon}>📈</Text>
              <Text style={styles.tripInfoValue}>1.4x</Text>
              <Text style={styles.tripInfoLabel}>surge</Text>
            </View>
          </View>
        </View>

        {/* Route */}
        <View style={styles.routeSection}>
          <View style={styles.routeItem}>
            <View style={styles.routeDotBlue} />
            <View style={styles.routeInfo}>
              <Text style={styles.routeMain}>King's Cross Station</Text>
              <Text style={styles.routeSub}>Euston Rd, London N1 9AL</Text>
            </View>
          </View>
          <View style={styles.routeLine} />
          <View style={styles.routeItem}>
            <View style={styles.routeDotGreen} />
            <View style={styles.routeInfo}>
              <Text style={styles.routeMain}>Soho House, Dean Street</Text>
              <Text style={styles.routeSub}>76 Dean St, London W1D 3SQ</Text>
            </View>
          </View>
        </View>

        {/* Passenger Info */}
        <View style={styles.passengerRow}>
          <View style={styles.passengerAvatar}>
            <Text style={styles.passengerAvatarText}>OH</Text>
          </View>
          <View style={styles.passengerInfo}>
            <Text style={styles.passengerName}>Olivia Hartwell</Text>
            <View style={styles.passengerMeta}>
              {[1, 2, 3, 4, 5].map((i) => (
                <Text key={i} style={[styles.passengerStar, i <= 4 ? styles.starFilled : styles.starEmpty]}>★</Text>
              ))}
              <Text style={styles.passengerRating}>4.92</Text>
              <Text style={styles.passengerTrips}>· 48 trips</Text>
            </View>
          </View>
          <View style={styles.passengerPax}>
            <Text style={styles.passengerPaxIcon}>👤</Text>
            <Text style={styles.passengerPaxCount}>1 pax</Text>
          </View>
        </View>

        {/* Action Buttons */}
        {!accepted && !declined ? (
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.declineBtn} onPress={handleDecline}>
              <Text style={styles.declineBtnIcon}>✕</Text>
              <Text style={styles.declineBtnText}>Decline</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.acceptBtn} onPress={handleAccept}>
              <Text style={styles.acceptBtnIcon}>✓</Text>
              <Text style={styles.acceptBtnText}>Accept</Text>
            </TouchableOpacity>
          </View>
        ) : accepted ? (
          <View style={styles.acceptedBanner}>
            <Text style={styles.acceptedIcon}>✓</Text>
            <Text style={styles.acceptedText}>Ride Accepted! Navigating to pickup...</Text>
          </View>
        ) : (
          <View style={styles.declinedBanner}>
            <Text style={styles.declinedText}>Request Declined</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  mapBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#080f1e",
    overflow: "hidden",
  },
  gridH: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  gridV: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  driverDot: {
    position: "absolute",
    top: "35%",
    left: "45%",
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "rgba(0, 200, 255, 0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  driverDotInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.cyan,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(6, 12, 24, 0.6)",
  },
  statsBar: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
    paddingTop: 16,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  statChip: {
    backgroundColor: "rgba(15, 26, 46, 0.9)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
    minWidth: 80,
  },
  statChipLabel: {
    fontSize: 10,
    color: COLORS.muted,
    marginBottom: 2,
  },
  statChipValue: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.foreground,
  },
  requestCard: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderBottomWidth: 0,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  newRequestBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  newRequestDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.error,
    shadowColor: COLORS.error,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 3,
  },
  newRequestText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.error,
    letterSpacing: 0.5,
  },
  incomingTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: COLORS.foreground,
    marginBottom: 14,
  },
  fareRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },
  fareBox: {
    backgroundColor: "rgba(0, 232, 135, 0.08)",
    borderRadius: 14,
    padding: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(0, 232, 135, 0.2)",
    minWidth: 110,
  },
  fareLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.muted,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  fareAmount: {
    fontSize: 28,
    fontWeight: "800",
    color: COLORS.primary,
  },
  fareType: {
    fontSize: 10,
    color: COLORS.muted,
    marginTop: 2,
  },
  tripInfoGrid: {
    flex: 1,
    gap: 8,
  },
  tripInfoItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface2,
    borderRadius: 10,
    padding: 8,
    gap: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  tripInfoIcon: {
    fontSize: 14,
  },
  tripInfoValue: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.foreground,
    flex: 1,
  },
  tripInfoLabel: {
    fontSize: 10,
    color: COLORS.muted,
  },
  routeSection: {
    backgroundColor: COLORS.surface2,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  routeItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  routeDotBlue: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.cyan,
    marginTop: 3,
    shadowColor: COLORS.cyan,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 3,
  },
  routeDotGreen: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.primary,
    marginTop: 3,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 3,
  },
  routeLine: {
    width: 1,
    height: 12,
    backgroundColor: COLORS.border,
    marginLeft: 5.5,
    marginVertical: 3,
  },
  routeInfo: {
    flex: 1,
  },
  routeMain: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.foreground,
    marginBottom: 2,
  },
  routeSub: {
    fontSize: 11,
    color: COLORS.muted,
  },
  passengerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },
  passengerAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.surface2,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  passengerAvatarText: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.foreground,
  },
  passengerInfo: {
    flex: 1,
  },
  passengerName: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.foreground,
    marginBottom: 3,
  },
  passengerMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  passengerStar: {
    fontSize: 12,
  },
  starFilled: {
    color: COLORS.warning,
  },
  starEmpty: {
    color: COLORS.border,
  },
  passengerRating: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.foreground,
    marginLeft: 4,
  },
  passengerTrips: {
    fontSize: 12,
    color: COLORS.muted,
  },
  passengerPax: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.surface2,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  passengerPaxIcon: {
    fontSize: 14,
  },
  passengerPaxCount: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.foreground,
  },
  actionRow: {
    flexDirection: "row",
    gap: 12,
  },
  declineBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "rgba(255, 68, 68, 0.1)",
    borderRadius: 16,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: "rgba(255, 68, 68, 0.3)",
  },
  declineBtnIcon: {
    fontSize: 18,
    color: COLORS.error,
    fontWeight: "800",
  },
  declineBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.error,
  },
  acceptBtn: {
    flex: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    paddingVertical: 16,
  },
  acceptBtnIcon: {
    fontSize: 18,
    color: "#000",
    fontWeight: "800",
  },
  acceptBtnText: {
    fontSize: 16,
    fontWeight: "800",
    color: "#000",
  },
  acceptedBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "rgba(0, 232, 135, 0.1)",
    borderRadius: 16,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: "rgba(0, 232, 135, 0.3)",
  },
  acceptedIcon: {
    fontSize: 20,
    color: COLORS.primary,
    fontWeight: "800",
  },
  acceptedText: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.primary,
  },
  declinedBanner: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 68, 68, 0.08)",
    borderRadius: 16,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: "rgba(255, 68, 68, 0.2)",
  },
  declinedText: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.error,
  },
});
