import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  Alert,
  Dimensions,
  Linking,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { rideStore } from "@/lib/ride-store";
import { trpc } from "@/lib/trpc";
import { useRideX } from "@/lib/ridex-context";
import { distanceKm, etaMinutes } from "@/hooks/use-driver-location";
import { useRealtimeConnected, useRealtimeTopic } from "@/hooks/use-realtime";
import { RideMap, type RideMapMarker } from "@/components/ride-map";

const { width, height } = Dimensions.get("window");

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

type TripStatus = "searching" | "found" | "enroute" | "arrived" | "completed" | "cancelled";

// Server ride_status -> UI status
const STATUS_MAP: Record<string, TripStatus> = {
  searching: "searching",
  accepted: "found",
  arriving: "found",
  in_progress: "enroute",
  completed: "completed",
  cancelled: "cancelled",
  no_driver_found: "cancelled",
};

// Rough visual progress per phase (no live GPS yet)
const PROGRESS_MAP: Record<TripStatus, number> = {
  searching: 0.05,
  found: 0.25,
  enroute: 0.6,
  arrived: 0.95,
  completed: 1,
  cancelled: 0,
};

export default function TrackingScreen() {
  const router = useRouter();
  const { user } = useRideX();
  const passengerId = Number(user?.id);
  const [rideId, setRideId] = useState<number | null>(null);
  const [showSosConfirm, setShowSosConfirm] = useState(false);
  const [showSosSuccess, setShowSosSuccess] = useState(false);
  const [showStandDownConfirm, setShowStandDownConfirm] = useState(false);
  // When the push channel is live, fallback polls stretch out
  const live = useRealtimeConnected();

  // Ride id comes from the booking flow (saved in rideStore); the active-ride
  // query below recovers it after an app reload.
  useEffect(() => {
    rideStore.getActiveRide().then((ride) => {
      const id = ride ? Number(ride.id) : NaN;
      if (Number.isFinite(id)) setRideId(id);
    });
  }, []);

  const activeRideQuery = trpc.rides.getActiveForPassenger.useQuery(
    { passengerId },
    { enabled: Number.isFinite(passengerId) && rideId === null, refetchInterval: live ? 20000 : 4000 }
  );
  useEffect(() => {
    if (rideId === null && activeRideQuery.data?.id) {
      setRideId(activeRideQuery.data.id);
    }
  }, [activeRideQuery.data, rideId]);

  const rideQuery = trpc.rides.getById.useQuery(
    { rideId: rideId ?? 0 },
    { enabled: rideId !== null, refetchInterval: live ? 15000 : 3000 }
  );
  const ride = rideQuery.data;

  // Realtime: ride status pushed over WS; the polls above become slow fallbacks
  useRealtimeTopic(rideId !== null ? `ride:${rideId}` : null);
  useRealtimeTopic(ride?.driverId ? `driver:${ride.driverId}` : null);

  const driverQuery = trpc.driver.getPublic.useQuery(
    { driverId: ride?.driverId ?? 0 },
    // GPS arrives via the driver:<id> topic when the socket is live;
    // poll while it's down so the position still streams in
    { enabled: !!ride?.driverId, refetchInterval: live ? 30000 : 5000 }
  );

  const cancelRide = trpc.rides.cancel.useMutation();

  // ── SOS ──
  const triggerSos = trpc.sos.trigger.useMutation();
  const resolveSos = trpc.sos.resolve.useMutation();
  const activeSosQuery = trpc.sos.getActive.useQuery(undefined, {
    enabled: Number.isFinite(passengerId),
    refetchInterval: live ? 60000 : 10000,
  });
  const activeSos = activeSosQuery.data;

  // Best-effort current position (web geolocation); falls back to ride pickup
  const getCurrentPosition = (): Promise<{ lat?: number; lng?: number }> =>
    new Promise((resolve) => {
      const fallback = { lat: ride?.pickupLat, lng: ride?.pickupLng };
      if (typeof navigator !== "undefined" && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          () => resolve(fallback),
          { timeout: 3000 }
        );
      } else {
        resolve(fallback);
      }
    });

  const dialEmergency = () => {
    // Ghana national emergency number
    Linking.openURL("tel:112").catch(() => {
      Alert.alert("Call 112", "Dial 112 for emergency services.");
    });
  };

  const handleSOS = () => {
    console.log("[SOS] Button clicked, showing confirmation modal");
    setShowSosConfirm(true);
  };

  const confirmSOS = async () => {
    console.log("[SOS] User confirmed, triggering alert...");
    setShowSosConfirm(false);
    try {
      const pos = await getCurrentPosition();
      console.log("[SOS] Got position:", pos);
      await triggerSos.mutateAsync({
        triggeredBy: "passenger",
        rideId: rideId ?? undefined,
        latitude: pos.lat,
        longitude: pos.lng,
        message: "Passenger triggered SOS during ride",
      });
      console.log("[SOS] Alert sent successfully");
      activeSosQuery.refetch();
      setShowSosSuccess(true);
    } catch (err) {
      console.error("[SOS] Failed to send alert:", err);
      // Even if the server call fails, never block the real escalation path
      Alert.alert(
        "Couldn't reach RideX",
        "The alert didn't reach our servers. Call emergency services directly?",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Call 112", style: "destructive", onPress: dialEmergency },
        ]
      );
    }
  };

  const handleStandDown = () => {
    if (!activeSos) return;
    setShowStandDownConfirm(true);
  };

  const confirmStandDown = async () => {
    setShowStandDownConfirm(false);
    if (!activeSos) return;
    try {
      await resolveSos.mutateAsync({ sosId: activeSos.id, status: "resolved" });
      activeSosQuery.refetch();
    } catch (err) {
      console.warn("[SOS] resolve failed:", err);
    }
  };

  const tripStatus: TripStatus = ride ? STATUS_MAP[ride.status] ?? "searching" : "searching";

  const d = driverQuery.data;

  // ── Live position math ──
  // While the driver heads to pickup, measure driver→pickup; once the trip
  // starts, measure driver→destination. Falls back to the booking estimate
  // when the driver hasn't sent GPS yet.
  const driverLat = d?.currentLat;
  const driverLng = d?.currentLng;
  const hasLiveGps = driverLat != null && driverLng != null;

  const targetLat = tripStatus === "enroute" ? ride?.destinationLat : ride?.pickupLat;
  const targetLng = tripStatus === "enroute" ? ride?.destinationLng : ride?.pickupLng;

  const liveKm =
    hasLiveGps && targetLat != null && targetLng != null
      ? distanceKm(driverLat!, driverLng!, targetLat, targetLng)
      : null;

  const isOver = tripStatus === "completed" || tripStatus === "arrived" || tripStatus === "cancelled";
  const remainingKm = isOver ? 0 : liveKm ?? parseFloat(ride?.distanceKm ?? "0");
  const remainingMin = isOver ? 0 : liveKm != null ? etaMinutes(liveKm) : ride?.durationMin ?? 0;

  // Progress: with GPS, how much of the leg is covered; else the phase default
  const totalLegKm = parseFloat(ride?.distanceKm ?? "0");
  const progress = isOver
    ? PROGRESS_MAP[tripStatus]
    : liveKm != null && totalLegKm > 0
    ? Math.min(0.97, Math.max(0.03, 1 - liveKm / totalLegKm))
    : PROGRESS_MAP[tripStatus];

  const driverCard = {
    name: d?.name ?? "Your driver",
    initial: (d?.name ?? "D").charAt(0).toUpperCase(),
    rating: d?.rating ? parseFloat(d.rating) : 5,
    trips: d?.totalTrips ?? 0,
    vehicle: d?.vehicleModel ?? "Vehicle pending",
    plate: d?.vehiclePlate ?? "—",
    color: d?.vehicleColor ?? "",
    isVerified: d?.isVerified ?? false,
  };

  const statusLabel: Record<TripStatus, string> = {
    searching: "Finding your driver...",
    found:
      ride?.status === "arriving"
        ? "Driver is arriving"
        : liveKm != null
        ? `Driver is ${liveKm < 0.15 ? "here" : `${liveKm.toFixed(1)} km away`}`
        : "Driver is on the way",
    enroute: "On the way to destination",
    arrived: "You have arrived!",
    completed: "Trip Completed!",
    cancelled: ride?.status === "no_driver_found" ? "No driver found" : "Trip Cancelled",
  };

  const statusColor: Record<TripStatus, string> = {
    searching: COLORS.primary,
    found: COLORS.primary,
    enroute: COLORS.primary,
    arrived: COLORS.success,
    completed: COLORS.success,
    cancelled: COLORS.error,
  };

  const destination = ride?.destinationAddress ?? "Destination";
  const pickup = ride?.pickupAddress ?? "Pickup";
  const fare = ride ? parseFloat(ride.actualFare ?? ride.estimatedFare ?? "0") : 0;

  const handleCancelRide = () => {
    if (rideId === null) return;
    Alert.alert("Cancel ride?", "Your driver will be notified.", [
      { text: "Keep riding", style: "cancel" },
      {
        text: "Cancel ride",
        style: "destructive",
        onPress: async () => {
          try {
            await cancelRide.mutateAsync({
              rideId,
              cancelledBy: "passenger",
              reason: "Cancelled by passenger",
            });
          } catch (err) {
            console.warn("[Tracking] cancel failed:", err);
          }
          await rideStore.clearActiveRide();
          router.replace("/(passenger)/home" as any);
        },
      },
    ]);
  };

  const handleCompleteRide = async () => {
    await rideStore.clearActiveRide();
    router.replace({
      pathname: "/(passenger)/rating",
      params: {
        rideId: String(rideId ?? ""),
        driverUserId: d?.userId ? String(d.userId) : "",
      },
    } as any);
  };

  const handleBackHome = async () => {
    await rideStore.clearActiveRide();
    router.replace("/(passenger)/home" as any);
  };

  // Build map markers from live data
  const mapMarkers: RideMapMarker[] = [];
  if (ride?.pickupLat != null && ride?.pickupLng != null) {
    mapMarkers.push({ id: "pickup", lat: ride.pickupLat, lng: ride.pickupLng, emoji: "📍" });
  }
  if (ride?.destinationLat != null && ride?.destinationLng != null) {
    mapMarkers.push({ id: "dest", lat: ride.destinationLat, lng: ride.destinationLng, emoji: "🔴" });
  }
  if (driverLat != null && driverLng != null) {
    mapMarkers.push({ id: "driver", lat: driverLat, lng: driverLng, emoji: "🚗" });
  }
  const mapLine =
    ride?.pickupLat != null && ride?.destinationLat != null
      ? [
          { lat: ride.pickupLat, lng: ride.pickupLng },
          { lat: ride.destinationLat, lng: ride.destinationLng },
        ]
      : undefined;

  return (
    <View style={styles.container}>
      {/* Real Map */}
      <View style={styles.mapArea}>
        <RideMap markers={mapMarkers} line={mapLine} />

        {/* Progress bar at top */}
        <SafeAreaView edges={["top"]} style={styles.progressBarWrap}>
          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                { width: `${progress * 100}%` as any, backgroundColor: statusColor[tripStatus] },
              ]}
            />
          </View>
        </SafeAreaView>
      </View>

      {/* Bottom Panel */}
      <View style={styles.bottomPanel}>
        {/* Trip Status */}
        <View style={styles.tripStatusRow}>
          <View>
            <Text style={styles.tripStatusLabel}>TRIP STATUS</Text>
            <Text style={[styles.tripStatusValue, { color: statusColor[tripStatus] }]}>
              {statusLabel[tripStatus]}
            </Text>
          </View>
          {fare > 0 && (
            <View style={styles.fareTag}>
              <Text style={styles.fareTagLabel}>FARE</Text>
              <Text style={styles.fareTagValue}>GH₵{fare.toFixed(2)}</Text>
            </View>
          )}
        </View>

        {/* Progress Bar */}
        <View style={styles.tripProgress}>
          <View style={styles.tripProgressTrack}>
            <View
              style={[
                styles.tripProgressFill,
                { width: `${progress * 100}%` as any, backgroundColor: statusColor[tripStatus] },
              ]}
            />
          </View>
        </View>

        {/* ETA & Distance */}
        {tripStatus !== "searching" && remainingMin > 0 && (
          <View style={styles.etaRow}>
            <Text style={styles.etaIcon}>⏱</Text>
            <Text style={styles.etaInfo}>{Math.ceil(remainingMin)} min remaining</Text>
            <Text style={styles.etaDot}>·</Text>
            <Text style={styles.etaInfo}>{remainingKm.toFixed(1)} km</Text>
            {hasLiveGps && (
              <>
                <Text style={styles.etaDot}>·</Text>
                <Text style={styles.liveTag}>● LIVE</Text>
              </>
            )}
          </View>
        )}

        {/* Driver Card */}
        {tripStatus !== "searching" && tripStatus !== "cancelled" && ride?.driverId != null && (
          <View style={styles.driverCard}>
            <View style={styles.driverAvatar}>
              <Text style={styles.driverAvatarText}>{driverCard.initial}</Text>
            </View>
            <View style={styles.driverInfo}>
              <View style={styles.driverNameRow}>
                <Text style={styles.driverName}>{driverCard.name}</Text>
                {driverCard.isVerified && (
                  <View style={styles.verifiedBadge}>
                    <Text style={styles.verifiedText}>✓ VERIFIED</Text>
                  </View>
                )}
              </View>
              <Text style={styles.driverRating}>
                ★ {driverCard.rating.toFixed(2)} · {driverCard.trips.toLocaleString()} trips
              </Text>
              <Text style={styles.driverVehicle}>
                {[driverCard.vehicle, driverCard.color, driverCard.plate].filter(Boolean).join(" · ")}
              </Text>
            </View>
          </View>
        )}

        {/* Searching animation */}
        {tripStatus === "searching" && (
          <View style={styles.searchingRow}>
            <Text style={styles.searchingText}>🔍 Searching for nearby drivers...</Text>
          </View>
        )}

        {/* Cancelled banner */}
        {tripStatus === "cancelled" && (
          <View style={styles.searchingRow}>
            <Text style={[styles.searchingText, { color: COLORS.error }]}>
              {statusLabel.cancelled}
            </Text>
          </View>
        )}

        {/* Active SOS banner */}
        {activeSos && (
          <TouchableOpacity style={styles.sosActiveBanner} onPress={handleStandDown}>
            <Text style={styles.sosActiveIcon}>🚨</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.sosActiveTitle}>SOS active</Text>
              <Text style={styles.sosActiveSub}>
                Your driver has been alerted · tap when you're safe
              </Text>
            </View>
            <TouchableOpacity style={styles.sosCallBtn} onPress={dialEmergency}>
              <Text style={styles.sosCallBtnText}>📞 112</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        )}

        {/* Action Buttons */}
        {tripStatus !== "completed" && tripStatus !== "cancelled" && (
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.actionBtn}
              disabled={!d?.phone}
              onPress={() => {
                if (d?.phone) {
                  Linking.openURL(`tel:${d.phone}`).catch(() => {
                    Alert.alert("Call driver", `Dial ${d.phone} to reach your driver.`);
                  });
                }
              }}
            >
              <Text style={styles.actionBtnIcon}>📞</Text>
              <Text style={styles.actionBtnText}>Call</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionBtn}
              disabled={ride?.driverId == null}
              onPress={() => {
                if (rideId !== null && ride?.driverId != null) {
                  router.push({
                    pathname: "/(passenger)/chat",
                    params: { rideId: String(rideId) },
                  } as any);
                }
              }}
            >
              <Text style={styles.actionBtnIcon}>💬</Text>
              <Text style={styles.actionBtnText}>Message</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, styles.sosBtnStyle]}
              onPress={handleSOS}
              disabled={triggerSos.isPending}
            >
              <Text style={styles.actionBtnIcon}>🚨</Text>
              <Text style={[styles.actionBtnText, { color: COLORS.error }]}>
                {triggerSos.isPending ? "..." : "SOS"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={handleCancelRide}
            >
              <Text style={styles.actionBtnIcon}>✕</Text>
              <Text style={styles.actionBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Complete Trip Button (when completed) */}
        {tripStatus === "completed" && (
          <TouchableOpacity style={styles.completeBtn} onPress={handleCompleteRide}>
            <Text style={styles.completeBtnText}>Rate Your Ride ★</Text>
          </TouchableOpacity>
        )}

        {/* Back home (when cancelled) */}
        {tripStatus === "cancelled" && (
          <TouchableOpacity
            style={[styles.completeBtn, { backgroundColor: COLORS.surface2 }]}
            onPress={handleBackHome}
          >
            <Text style={[styles.completeBtnText, { color: COLORS.foreground }]}>Back to Home</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* SOS Confirmation Modal */}
      <Modal visible={showSosConfirm} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Emergency SOS</Text>
            <Text style={styles.modalBody}>
              This alerts your driver and logs your location with RideX safety. Use it if you feel unsafe.
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnCancel]}
                onPress={() => setShowSosConfirm(false)}
              >
                <Text style={styles.modalBtnCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnConfirm]}
                onPress={confirmSOS}
              >
                <Text style={styles.modalBtnConfirmText}>Send SOS</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* SOS Success Modal */}
      <Modal visible={showSosSuccess} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>SOS sent</Text>
            <Text style={styles.modalBody}>
              Your alert is active and your driver has been notified. Call emergency services?
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnCancel]}
                onPress={() => setShowSosSuccess(false)}
              >
                <Text style={styles.modalBtnCancelText}>Not now</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnConfirm]}
                onPress={() => {
                  setShowSosSuccess(false);
                  dialEmergency();
                }}
              >
                <Text style={styles.modalBtnConfirmText}>Call 112</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Stand Down Confirmation Modal */}
      <Modal visible={showStandDownConfirm} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Stand down?</Text>
            <Text style={styles.modalBody}>
              Mark this emergency as resolved?
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnCancel]}
                onPress={() => setShowStandDownConfirm(false)}
              >
                <Text style={styles.modalBtnCancelText}>Keep active</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnConfirm]}
                onPress={confirmStandDown}
              >
                <Text style={styles.modalBtnConfirmText}>I'm safe now</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  mapArea: {
    height: height * 0.52,
    backgroundColor: COLORS.bg,
    position: "relative",
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
  routeWrap: {
    position: "absolute",
    left: "50%",
    top: "10%",
    bottom: "10%",
    width: 4,
    marginLeft: -2,
    alignItems: "center",
  },
  routeVertical: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: COLORS.primary,
    opacity: 0.4,
  },
  driverDot: {
    position: "absolute",
    alignItems: "center",
  },
  driverEmoji: { fontSize: 24 },
  driverSpeed: {
    fontSize: 10,
    color: COLORS.primary,
    fontWeight: "700",
    backgroundColor: "rgba(0,200,255,0.15)",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    marginTop: 2,
  },
  destLabel: {
    position: "absolute",
    top: 16,
    right: 16,
    backgroundColor: "rgba(0,232,135,0.12)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "rgba(0,232,135,0.3)",
  },
  destLabelText: { fontSize: 10, fontWeight: "700", color: COLORS.success },
  pickupLabel: {
    position: "absolute",
    bottom: 16,
    left: 16,
    backgroundColor: "rgba(0,200,255,0.12)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "rgba(0,200,255,0.3)",
  },
  pickupLabelText: { fontSize: 10, fontWeight: "700", color: COLORS.primary },
  mapControls: {
    position: "absolute",
    right: 12,
    bottom: 40,
    gap: 8,
  },
  mapBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: "rgba(15,26,46,0.95)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  mapBtnIcon: { fontSize: 16 },
  progressBarWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  progressBar: {
    height: 3,
    backgroundColor: COLORS.border,
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 2,
  },
  bottomPanel: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  tripStatusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  tripStatusLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.muted,
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  tripStatusValue: {
    fontSize: 16,
    fontWeight: "700",
  },
  fareTag: {
    backgroundColor: COLORS.surface2,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  fareTagLabel: { fontSize: 9, fontWeight: "700", color: COLORS.muted, letterSpacing: 0.5 },
  fareTagValue: { fontSize: 16, fontWeight: "800", color: COLORS.primary },
  tripProgress: { marginBottom: 12 },
  tripProgressTrack: {
    height: 4,
    backgroundColor: COLORS.border,
    borderRadius: 2,
    overflow: "hidden",
  },
  tripProgressFill: {
    height: "100%",
    borderRadius: 2,
  },
  etaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 12,
  },
  etaIcon: { fontSize: 14 },
  etaInfo: { fontSize: 13, color: COLORS.muted },
  etaDot: { fontSize: 13, color: COLORS.border },
  liveTag: { fontSize: 11, fontWeight: "800", color: COLORS.success },
  driverCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface2,
    borderRadius: 14,
    padding: 12,
    gap: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  driverAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  driverAvatarText: { fontSize: 18, fontWeight: "700", color: "#fff" },
  driverInfo: { flex: 1 },
  driverNameRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 },
  driverName: { fontSize: 15, fontWeight: "700", color: COLORS.foreground },
  verifiedBadge: {
    backgroundColor: "rgba(0,232,135,0.12)",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: "rgba(0,232,135,0.3)",
  },
  verifiedText: { fontSize: 9, fontWeight: "700", color: COLORS.success, letterSpacing: 0.5 },
  driverRating: { fontSize: 12, color: COLORS.muted, marginBottom: 2 },
  driverVehicle: { fontSize: 11, color: COLORS.muted },
  searchingRow: {
    backgroundColor: COLORS.surface2,
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  searchingText: { fontSize: 14, color: COLORS.muted },
  actionRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 8,
  },
  actionBtn: {
    flex: 1,
    backgroundColor: COLORS.surface2,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  sosBtnStyle: {
    borderColor: "rgba(255,68,68,0.3)",
    backgroundColor: "rgba(255,68,68,0.06)",
  },
  sosActiveBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(255,68,68,0.1)",
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(255,68,68,0.4)",
  },
  sosActiveIcon: { fontSize: 22 },
  sosActiveTitle: { fontSize: 14, fontWeight: "800", color: COLORS.error },
  sosActiveSub: { fontSize: 11, color: COLORS.muted },
  sosCallBtn: {
    backgroundColor: COLORS.error,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  sosCallBtnText: { fontSize: 13, fontWeight: "800", color: "#fff" },
  actionBtnIcon: { fontSize: 18 },
  actionBtnText: { fontSize: 11, fontWeight: "600", color: COLORS.muted },
  completeBtn: {
    backgroundColor: COLORS.success,
    borderRadius: 16,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: COLORS.success,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
  },
  completeBtnText: { fontSize: 16, fontWeight: "700", color: "#000" },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  modalBox: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 24,
    width: "85%",
    maxWidth: 400,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: COLORS.foreground,
    marginBottom: 12,
  },
  modalBody: {
    fontSize: 14,
    color: COLORS.muted,
    lineHeight: 20,
    marginBottom: 20,
  },
  modalActions: {
    flexDirection: "row",
    gap: 12,
  },
  modalBtn: {
    flex: 1,
    borderRadius: 12,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  modalBtnCancel: {
    backgroundColor: COLORS.surface2,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  modalBtnCancelText: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.muted,
  },
  modalBtnConfirm: {
    backgroundColor: COLORS.error,
  },
  modalBtnConfirmText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#fff",
  },
});
