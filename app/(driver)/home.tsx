import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { trpc } from "@/lib/trpc";
import { useRideX } from "@/lib/ridex-context";
import { NotificationsBell } from "@/components/notifications-bell";
import { useDriverLocation } from "@/hooks/use-driver-location";
import { useRealtimeConnected, useRealtimeTopic } from "@/hooks/use-realtime";
import { useRoute } from "@/hooks/use-route";
import { RideMap, type RideMapMarker } from "@/components/ride-map";

const COLORS = {
  bg: "#060c18",
  surface: "#0f1a2e",
  surface2: "#162035",
  primary: "#00e887",
  cyan: "#00c8ff",
  foreground: "#ffffff",
  muted: "#8899aa",
  border: "#1e3050",
  error: "#ff4444",
  warning: "#f59e0b",
  orange: "#ff6b2b",
};


const REQUEST_COUNTDOWN = 15;

export default function DriverHomeScreen() {
  const router = useRouter();
  const { user } = useRideX();
  const userId = Number(user?.id);

  const [isOnline, setIsOnline] = useState(false);
  const [onlineSynced, setOnlineSynced] = useState(false);
  const [showSOS, setShowSOS] = useState(false);
  const [countdown, setCountdown] = useState(REQUEST_COUNTDOWN);
  const [dismissedRideIds, setDismissedRideIds] = useState<number[]>([]);
  const [showSosSuccess, setShowSosSuccess] = useState(false);
  const [showStandDownConfirm, setShowStandDownConfirm] = useState(false);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // When the push channel is live, fallback polls stretch out
  const live = useRealtimeConnected();

  // Driver profile (creates one on first call). profile.id is the driverId
  // that rides.driverId references.
  const profileQuery = trpc.driver.getProfile.useQuery(undefined, {
    enabled: Number.isFinite(userId),
  });
  const driverId = profileQuery.data?.id;

  // Reflect the server's online state once on load
  useEffect(() => {
    if (profileQuery.data && !onlineSynced) {
      setIsOnline(profileQuery.data.isOnline);
      setOnlineSynced(true);
    }
  }, [profileQuery.data, onlineSynced]);

  const toggleOnline = trpc.driver.toggleOnline.useMutation();
  const acceptRide = trpc.rides.accept.useMutation();
  const declineRide = trpc.rides.decline.useMutation();
  const updateStatus = trpc.rides.updateStatus.useMutation();

  // Current active ride for this driver (accepted/arriving/in_progress)
  const activeRideQuery = trpc.rides.getActiveForDriver.useQuery(undefined, {
    enabled: !!driverId,
    refetchInterval: live ? 20000 : 4000,
  });
  const activeRide = activeRideQuery.data;

  // Realtime: new/taken requests while waiting, lifecycle updates mid-ride
  useRealtimeTopic(isOnline && !!driverId && !activeRide ? "drivers:online" : null);
  useRealtimeTopic(activeRide ? `ride:${activeRide.id}` : null);

  // Stream real GPS to the server while online (or mid-ride even if toggled off)
  // livePos updates every GPS tick — use it directly for the driver's own map marker
  const livePos = useDriverLocation(driverId, isOnline || !!activeRide);

  // 📊 Demand: toggle live pickup points of currently-searching rides onto the map
  const [showDemand, setShowDemand] = useState(false);
  const demandQuery = trpc.rides.demand.useQuery(undefined, {
    enabled: showDemand,
    refetchInterval: showDemand ? (live ? 30000 : 10000) : false,
  });
  const demandPoints = demandQuery.data ?? [];

  // Map markers: driver's own live position + active ride pickup/destination
  // livePos (from the GPS hook) updates every tick without a server round-trip;
  // fall back to the stored profile position on first load before GPS arrives.
  const driverMapMarkers: RideMapMarker[] = [];
  const pLat = livePos?.lat ?? profileQuery.data?.currentLat;
  const pLng = livePos?.lng ?? profileQuery.data?.currentLng;
  if (pLat != null && pLng != null) {
    driverMapMarkers.push({ id: "me", lat: pLat, lng: pLng, emoji: "🚗", moving: true });
  }
  if (activeRide?.pickupLat != null && activeRide?.pickupLng != null) {
    driverMapMarkers.push({
      id: "pickup",
      lat: activeRide.pickupLat,
      lng: activeRide.pickupLng,
      emoji: "📍",
    });
  }
  if (activeRide?.destinationLat != null && activeRide?.destinationLng != null) {
    driverMapMarkers.push({
      id: "dest",
      lat: activeRide.destinationLat,
      lng: activeRide.destinationLng,
      emoji: "🔴",
    });
  }
  const driverMapLine =
    activeRide?.pickupLat != null && activeRide?.destinationLat != null
      ? [
          { lat: activeRide.pickupLat, lng: activeRide.pickupLng },
          { lat: activeRide.destinationLat, lng: activeRide.destinationLng },
        ]
      : undefined;

  // Road route for the active ride: my position → pickup until the trip
  // starts, then my position → destination (falls back to pickup→destination
  // until my GPS arrives).
  const headingToPickup = activeRide?.status === "accepted" || activeRide?.status === "arriving";
  const legTargetLat = headingToPickup ? activeRide?.pickupLat : activeRide?.destinationLat;
  const legTargetLng = headingToPickup ? activeRide?.pickupLng : activeRide?.destinationLng;
  const driverRoad = useRoute(
    pLat != null && pLng != null
      ? { lat: pLat, lng: pLng }
      : activeRide?.pickupLat != null && activeRide?.pickupLng != null
        ? { lat: activeRide.pickupLat, lng: activeRide.pickupLng }
        : null,
    legTargetLat != null && legTargetLng != null ? { lat: legTargetLat, lng: legTargetLng } : null,
    activeRide != null,
  );

  // Live demand pins (🔥) when the Demand layer is toggled on
  if (showDemand) {
    for (const d of demandPoints) {
      if (d.lat != null && d.lng != null) {
        driverMapMarkers.push({ id: `demand-${d.id}`, lat: d.lat, lng: d.lng, emoji: "🔥" });
      }
    }
  }

  // Pending requests: pushed instantly over WS (ride:new invalidates this
  // query); the poll is the slow fallback. The 15s countdown + local
  // dismissals below stay unchanged — they read from this query's data.
  const pendingQuery = trpc.rides.getPending.useQuery(
    {},
    { enabled: isOnline && !!driverId && !activeRide, refetchInterval: live ? 30000 : 4000 }
  );
  const incomingRide =
    isOnline && !activeRide
      ? pendingQuery.data?.find((r) => !dismissedRideIds.includes(r.id))
      : undefined;

  // Today's earnings
  const earningsQuery = trpc.driver.earningsSummary.useQuery(
    { period: "today" },
    { enabled: !!driverId, refetchInterval: 30000 }
  );

  const handleToggleOnline = async () => {
    if (!driverId) return;
    const newState = !isOnline;
    setIsOnline(newState);
    try {
      await toggleOnline.mutateAsync({ isOnline: newState });
    } catch (err) {
      // Revert on failure so UI matches the server
      console.warn("[DriverHome] toggleOnline failed:", err);
      setIsOnline(!newState);
    }
  };

  // Countdown while a request is showing; auto-dismiss at 0
  useEffect(() => {
    if (incomingRide) {
      setCountdown(REQUEST_COUNTDOWN);
      countdownRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            if (countdownRef.current) clearInterval(countdownRef.current);
            setDismissedRideIds((ids) => [...ids, incomingRide.id]);
            return REQUEST_COUNTDOWN;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingRide?.id]);

  const handleAccept = async () => {
    if (!incomingRide || !driverId) return;
    try {
      await acceptRide.mutateAsync({ rideId: incomingRide.id });
      await activeRideQuery.refetch();
    } catch (err) {
      console.warn("[DriverHome] accept failed:", err);
      // Someone else may have taken it — drop it from the list
      setDismissedRideIds((ids) => [...ids, incomingRide.id]);
      pendingQuery.refetch();
    }
  };

  const handleDecline = async () => {
    if (!incomingRide) return;
    setDismissedRideIds((ids) => [...ids, incomingRide.id]);
    // Server's decline keys acceptance-rate updates off the USER id
    // (getOrCreateDriverProfile/updateDriverProfile are userId-keyed).
    if (Number.isFinite(userId)) {
      declineRide.mutate({ rideId: incomingRide.id });
    }
  };

  // accepted -> arriving -> in_progress -> completed
  const nextStatusFor = (status: string) =>
    status === "accepted" ? "arriving" : status === "arriving" ? "in_progress" : "completed";

  const nextStatusLabel: Record<string, string> = {
    accepted: "Arrived at Pickup",
    arriving: "Start Trip",
    in_progress: "Complete Trip",
  };

  const handleAdvanceStatus = async () => {
    if (!activeRide) return;
    const next = nextStatusFor(activeRide.status) as "arriving" | "in_progress" | "completed";
    try {
      await updateStatus.mutateAsync({ rideId: activeRide.id, status: next });
      await activeRideQuery.refetch();
      if (next === "completed") {
        earningsQuery.refetch();
        profileQuery.refetch();
      }
    } catch (err) {
      console.warn("[DriverHome] status update failed:", err);
    }
  };

  const handleSOS = () => setShowSOS(true);

  // ── SOS ──
  const triggerSos = trpc.sos.trigger.useMutation();
  const resolveSos = trpc.sos.resolve.useMutation();
  const mySosQuery = trpc.sos.getActive.useQuery(undefined, {
    enabled: Number.isFinite(userId),
    refetchInterval: live ? 60000 : 10000,
  });
  const mySos = mySosQuery.data;
  // Alerts raised by the passenger on my current ride
  const rideSosQuery = trpc.sos.getActiveForRide.useQuery(
    { rideId: activeRide?.id ?? 0 },
    { enabled: !!activeRide, refetchInterval: live ? 30000 : 5000 }
  );
  const passengerSos = (rideSosQuery.data ?? []).find(
    (a) => a.triggeredBy === "passenger"
  );

  const dialEmergency = () => {
    Linking.openURL("tel:112").catch(() => {
      Alert.alert("Call 112", "Dial 112 for emergency services.");
    });
  };

  // Hand off to Google Maps for turn-by-turn to the current target:
  // heading to pickup while accepted/arriving, to destination once in progress.
  const navTarget = activeRide
    ? activeRide.status === "in_progress"
      ? {
          lat: activeRide.destinationLat,
          lng: activeRide.destinationLng,
          label: activeRide.destinationAddress,
        }
      : {
          lat: activeRide.pickupLat,
          lng: activeRide.pickupLng,
          label: activeRide.pickupAddress,
        }
    : null;

  const handleNavigate = () => {
    if (!navTarget || navTarget.lat == null || navTarget.lng == null) return;
    const dest = `${navTarget.lat},${navTarget.lng}`;
    // Universal URL works on Android, iOS and web; opens the Maps app when installed
    const url = `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`;
    if (Platform.OS === "android") {
      // Native intent → opens Google Maps straight into turn-by-turn driving mode
      Linking.openURL(`google.navigation:q=${dest}`).catch(() => {
        Linking.openURL(url).catch(() =>
          Alert.alert("Navigation", "Could not open a maps app on this device.")
        );
      });
      return;
    }
    Linking.openURL(url).catch(() =>
      Alert.alert("Navigation", "Could not open a maps app on this device.")
    );
  };

  // 🎯 Recenter map on the driver's live position (nonce bump = re-center each tap)
  const [recenter, setRecenter] = useState<{ lat: number; lng: number; nonce: number } | null>(null);
  const handleRecenter = () => {
    const p = profileQuery.data;
    if (p?.currentLat != null && p?.currentLng != null) {
      setRecenter({ lat: p.currentLat, lng: p.currentLng, nonce: Date.now() });
    } else {
      Alert.alert("Location unavailable", "We don't have your GPS position yet. Make sure location is on.");
    }
  };

  const handleConfirmSOS = async () => {
    setShowSOS(false);
    try {
      const p = profileQuery.data;
      await triggerSos.mutateAsync({
        triggeredBy: "driver",
        rideId: activeRide?.id,
        latitude: p?.currentLat ?? undefined,
        longitude: p?.currentLng ?? undefined,
        message: "Driver triggered SOS",
      });
      mySosQuery.refetch();
      setShowSosSuccess(true);
    } catch {
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
    if (!mySos) return;
    setShowStandDownConfirm(true);
  };

  const confirmStandDown = async () => {
    setShowStandDownConfirm(false);
    if (!mySos) return;
    try {
      await resolveSos.mutateAsync({ sosId: mySos.id, status: "resolved" });
      mySosQuery.refetch();
    } catch (err) {
      console.warn("[SOS] resolve failed:", err);
    }
  };

  const fmtFare = (v: string | null | undefined) =>
    `GH₵${parseFloat(v ?? "0").toFixed(2)}`;

  const activeStatusLabel: Record<string, string> = {
    accepted: "Head to pickup",
    arriving: "At pickup — waiting for passenger",
    in_progress: "Trip in progress",
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Top Bar */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.menuBtn}>
          <Text style={styles.menuIcon}>☰</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.onlineToggle, isOnline && styles.onlineToggleActive]}
          onPress={handleToggleOnline}
          disabled={!driverId || toggleOnline.isPending}
        >
          <View style={[styles.onlineDot, isOnline && styles.onlineDotActive]} />
          <Text style={[styles.onlineText, isOnline && styles.onlineTextActive]}>
            {!driverId ? "..." : isOnline ? "Online" : "Offline"}
          </Text>
          <Text style={styles.onlineChevron}>▾</Text>
        </TouchableOpacity>

        <NotificationsBell accent="#00e887" />
      </View>

      {/* Map Area */}
      <View style={styles.mapArea}>
        {/* Real Map — driver's live position + active pickup/destination + demand */}
        <RideMap
          markers={driverMapMarkers}
          line={driverMapLine}
          route={activeRide ? driverRoad.coords : undefined}
          follow={activeRide && pLat != null && pLng != null ? { lat: pLat, lng: pLng } : null}
          center={recenter}
        />

        {/* Waiting for requests banner */}
        {isOnline && !activeRide && (
          <View style={styles.demandAlert}>
            <Text style={styles.demandAlertIcon}>📡</Text>
            <View>
              <Text style={styles.demandAlertTitle}>
                {pendingQuery.data?.length
                  ? `${pendingQuery.data.length} request${pendingQuery.data.length > 1 ? "s" : ""} nearby`
                  : "Waiting for requests..."}
              </Text>
              <Text style={styles.demandAlertSub}>You're visible to passengers</Text>
            </View>
          </View>
        )}

        {/* Map Controls */}
        <View style={styles.mapControls}>
          <TouchableOpacity style={styles.mapControlBtn} onPress={handleRecenter}>
            <Text style={styles.mapControlIcon}>🎯</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.mapControlBtn, showDemand && styles.mapControlBtnActive]}
            onPress={() => setShowDemand((v) => !v)}
          >
            <Text style={styles.mapControlIcon}>📊</Text>
            <Text style={styles.mapControlLabel}>
              {showDemand ? `Demand (${demandPoints.length})` : "Demand"}
            </Text>
          </TouchableOpacity>
        </View>

        {/* SOS & Navigate */}
        <View style={styles.actionBtns}>
          <TouchableOpacity style={styles.sosBtn} onPress={handleSOS}>
            <Text style={styles.sosBtnIcon}>🛡️</Text>
            <Text style={styles.sosBtnText}>SOS</Text>
          </TouchableOpacity>
          {navTarget && (
            <TouchableOpacity style={styles.navigateBtn} onPress={handleNavigate}>
              <Text style={styles.navigateBtnIcon}>➤</Text>
              <Text style={styles.navigateBtnText}>
                {activeRide?.status === "in_progress" ? "To Dropoff" : "To Pickup"}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* SOS banners */}
      {mySos && (
        <TouchableOpacity style={styles.sosActiveBanner} onPress={handleStandDown}>
          <Text style={styles.sosActiveIcon}>🚨</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.sosActiveTitle}>Your SOS is active</Text>
            <Text style={styles.sosActiveSub}>Tap when you're safe to stand down</Text>
          </View>
          <TouchableOpacity style={styles.sosCallBtn} onPress={dialEmergency}>
            <Text style={styles.sosCallBtnText}>📞 112</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      )}
      {passengerSos && !mySos && (
        <View style={styles.sosActiveBanner}>
          <Text style={styles.sosActiveIcon}>⚠️</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.sosActiveTitle}>Passenger triggered SOS</Text>
            <Text style={styles.sosActiveSub}>
              Check on your passenger. Pull over safely if needed.
            </Text>
          </View>
          <TouchableOpacity style={styles.sosCallBtn} onPress={dialEmergency}>
            <Text style={styles.sosCallBtnText}>📞 112</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Active Ride Panel OR Earnings Card */}
      {activeRide ? (
        <View style={styles.earningsCard}>
          <View style={styles.activeRideHeader}>
            <View style={styles.newRequestBadgeRow}>
              <View style={[styles.requestNewDot, { backgroundColor: COLORS.primary }]} />
              <Text style={[styles.requestNewText, { color: COLORS.primary }]}>
                ACTIVE RIDE · {fmtFare(activeRide.estimatedFare)}
              </Text>
            </View>
            <Text style={styles.activeRideStatus}>
              {activeStatusLabel[activeRide.status] ?? activeRide.status}
            </Text>
          </View>

          <View style={styles.requestRoute}>
            <View style={styles.requestRouteItem}>
              <View style={styles.requestRouteDotBlue} />
              <View style={{ flex: 1 }}>
                <Text style={styles.requestRouteMain} numberOfLines={1}>
                  {activeRide.pickupAddress}
                </Text>
                <Text style={styles.requestRouteSub}>Pickup</Text>
              </View>
            </View>
            <View style={styles.requestRouteLine} />
            <View style={styles.requestRouteItem}>
              <View style={styles.requestRouteDotGreen} />
              <View style={{ flex: 1 }}>
                <Text style={styles.requestRouteMain} numberOfLines={1}>
                  {activeRide.destinationAddress}
                </Text>
                <Text style={styles.requestRouteSub}>
                  {activeRide.distanceKm} km · ~{activeRide.durationMin} min
                </Text>
              </View>
            </View>
          </View>

          <TouchableOpacity
            style={styles.advanceBtn}
            onPress={handleAdvanceStatus}
            disabled={updateStatus.isPending}
          >
            <Text style={styles.advanceBtnText}>
              {updateStatus.isPending
                ? "..."
                : nextStatusLabel[activeRide.status] ?? "Continue"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.messageBtn}
            onPress={() =>
              router.push({
                pathname: "/(driver)/chat",
                params: { rideId: String(activeRide.id) },
              } as any)
            }
          >
            <Text style={styles.messageBtnText}>💬 Message Passenger</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.earningsCard}>
          <View style={styles.earningsTop}>
            <View style={styles.earningsMain}>
              <Text style={styles.earningsLabel}>Today's Earnings</Text>
              <Text style={styles.earningsAmount}>
                GH₵{earningsQuery.data?.total ?? "0.00"}
              </Text>
            </View>
            <TouchableOpacity onPress={() => router.push("/(driver)/earnings" as any)}>
              <Text style={styles.viewDetailsText}>View Details ›</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.earningsDivider} />
          <View style={styles.earningsStats}>
            <View style={styles.earningsStat}>
              <Text style={styles.earningsStatIcon}>🚗</Text>
              <View>
                <Text style={styles.earningsStatLabel}>Trips Today</Text>
                <Text style={styles.earningsStatValue}>
                  {earningsQuery.data?.tripsCount ?? 0}
                </Text>
              </View>
            </View>
            <View style={styles.earningsStatDivider} />
            <View style={styles.earningsStat}>
              <Text style={styles.earningsStatIcon}>⭐</Text>
              <View>
                <Text style={styles.earningsStatLabel}>Rating</Text>
                <Text style={styles.earningsStatValue}>
                  {profileQuery.data?.rating ?? "5.00"}
                </Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* Incoming Request Modal — real pending ride */}
      <Modal visible={!!incomingRide} animationType="slide" transparent>
        <View style={styles.requestOverlay}>
          <View style={styles.requestCard}>
            {/* Header */}
            <View style={styles.requestHeader}>
              <View style={styles.requestNewBadge}>
                <View style={styles.requestNewDot} />
                <Text style={styles.requestNewText}>NEW RIDE REQUEST</Text>
              </View>
              <View style={styles.requestTitle}>
                <Text style={styles.requestTitleText}>Incoming Request</Text>
                <View style={styles.requestCountdown}>
                  <Text style={styles.requestCountdownText}>{countdown}</Text>
                  <Text style={styles.requestCountdownSub}>sec</Text>
                </View>
              </View>
            </View>

            {/* Fare Info */}
            <View style={styles.requestFareRow}>
              <View style={styles.requestFareCard}>
                <Text style={styles.requestFareLabel}>FARE</Text>
                <Text style={styles.requestFareAmount}>
                  {fmtFare(incomingRide?.estimatedFare)}
                </Text>
                <Text style={styles.requestFareSub}>estimated</Text>
              </View>
              <View style={styles.requestMetaGrid}>
                <View style={styles.requestMetaItem}>
                  <Text style={styles.requestMetaIcon}>📍</Text>
                  <Text style={styles.requestMetaValue}>
                    {incomingRide?.distanceKm ?? "-"} km
                  </Text>
                  <Text style={styles.requestMetaLabel}>distance</Text>
                </View>
                <View style={styles.requestMetaItem}>
                  <Text style={styles.requestMetaIcon}>⏱</Text>
                  <Text style={styles.requestMetaValue}>
                    ~{incomingRide?.durationMin ?? "-"} min
                  </Text>
                  <Text style={styles.requestMetaLabel}>est. trip</Text>
                </View>
                <View style={styles.requestMetaItem}>
                  <Text style={styles.requestMetaIcon}>🚗</Text>
                  <Text style={styles.requestMetaValue}>
                    {incomingRide?.rideType ?? "-"}
                  </Text>
                  <Text style={styles.requestMetaLabel}>ride type</Text>
                </View>
              </View>
            </View>

            {/* Route */}
            <View style={styles.requestRoute}>
              <View style={styles.requestRouteItem}>
                <View style={styles.requestRouteDotBlue} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.requestRouteMain} numberOfLines={1}>
                    {incomingRide?.pickupAddress}
                  </Text>
                  <Text style={styles.requestRouteSub}>Pickup</Text>
                </View>
              </View>
              <View style={styles.requestRouteLine} />
              <View style={styles.requestRouteItem}>
                <View style={styles.requestRouteDotGreen} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.requestRouteMain} numberOfLines={1}>
                    {incomingRide?.destinationAddress}
                  </Text>
                  <Text style={styles.requestRouteSub}>Destination</Text>
                </View>
              </View>
            </View>

            {/* Actions */}
            <View style={styles.requestActions}>
              <TouchableOpacity style={styles.declineBtn} onPress={handleDecline}>
                <Text style={styles.declineBtnIcon}>✕</Text>
                <Text style={styles.declineBtnText}>Decline</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.acceptBtn}
                onPress={handleAccept}
                disabled={acceptRide.isPending}
              >
                <Text style={styles.acceptBtnIcon}>✓</Text>
                <Text style={styles.acceptBtnText}>
                  {acceptRide.isPending ? "..." : "Accept"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* SOS Modal */}
      <Modal visible={showSOS} animationType="fade" transparent>
        <View style={styles.sosOverlay}>
          <View style={styles.sosModal}>
            <Text style={styles.sosModalIcon}>🛡️</Text>
            <Text style={styles.sosModalTitle}>Emergency SOS</Text>
            <Text style={styles.sosModalText}>
              This alerts RideX safety{activeRide ? " and your passenger" : ""}, logging your
              location. You can then call emergency services.
            </Text>
            <TouchableOpacity
              style={styles.sosConfirmBtn}
              onPress={handleConfirmSOS}
              disabled={triggerSos.isPending}
            >
              <Text style={styles.sosConfirmText}>
                {triggerSos.isPending ? "Sending..." : "Send SOS Alert"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sosDialBtn} onPress={dialEmergency}>
              <Text style={styles.sosDialText}>📞 Call 112 directly</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sosCancelBtn}
              onPress={() => setShowSOS(false)}
            >
              <Text style={styles.sosCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* SOS Success Modal */}
      <Modal visible={showSosSuccess} animationType="fade" transparent>
        <View style={styles.sosOverlay}>
          <View style={styles.sosModal}>
            <Text style={styles.sosModalIcon}>✓</Text>
            <Text style={styles.sosModalTitle}>SOS sent</Text>
            <Text style={styles.sosModalText}>
              {activeRide
                ? "Your alert is active and your passenger has been notified. Call emergency services?"
                : "Your alert is active. Call emergency services?"}
            </Text>
            <TouchableOpacity
              style={styles.sosConfirmBtn}
              onPress={() => {
                setShowSosSuccess(false);
                dialEmergency();
              }}
            >
              <Text style={styles.sosConfirmText}>Call 112</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sosCancelBtn}
              onPress={() => setShowSosSuccess(false)}
            >
              <Text style={styles.sosCancelText}>Not now</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Stand Down Confirmation Modal */}
      <Modal visible={showStandDownConfirm} animationType="fade" transparent>
        <View style={styles.sosOverlay}>
          <View style={styles.sosModal}>
            <Text style={styles.sosModalTitle}>Stand down?</Text>
            <Text style={styles.sosModalText}>
              Mark this emergency as resolved?
            </Text>
            <TouchableOpacity
              style={styles.sosConfirmBtn}
              onPress={confirmStandDown}
            >
              <Text style={styles.sosConfirmText}>I'm safe now</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sosCancelBtn}
              onPress={() => setShowStandDownConfirm(false)}
            >
              <Text style={styles.sosCancelText}>Keep active</Text>
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
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    zIndex: 10,
  },
  menuBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  menuIcon: {
    fontSize: 18,
    color: COLORS.foreground,
  },
  onlineToggle: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  onlineToggleActive: {
    borderColor: COLORS.primary,
    backgroundColor: "rgba(0, 232, 135, 0.08)",
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  onlineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.muted,
  },
  onlineDotActive: {
    backgroundColor: COLORS.primary,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 3,
  },
  onlineText: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.muted,
  },
  onlineTextActive: {
    color: COLORS.foreground,
  },
  onlineChevron: {
    fontSize: 12,
    color: COLORS.muted,
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
    position: "relative",
  },
  notifIcon: {
    fontSize: 18,
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
  mapArea: {
    flex: 1,
    position: "relative",
    overflow: "hidden",
  },
  mapGrid: {
    ...StyleSheet.absoluteFillObject,
  },
  gridLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  gridLineV: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  demandZone: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  demandOuter: {
    position: "absolute",
  },
  demandInner: {
    position: "absolute",
  },
  demandLabel: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 4,
    position: "absolute",
    top: -28,
  },
  demandLabelIcon: {
    fontSize: 10,
  },
  demandLabelText: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.foreground,
  },
  zoneLabel: {
    position: "absolute",
    fontSize: 9,
    fontWeight: "700",
    color: "rgba(255,255,255,0.3)",
    letterSpacing: 1,
  },
  driverLocation: {
    position: "absolute",
    left: "48%",
    top: "50%",
    marginLeft: -20,
    marginTop: -20,
    alignItems: "center",
    justifyContent: "center",
  },
  driverLocationOuter: {
    position: "absolute",
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0, 232, 135, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(0, 232, 135, 0.3)",
  },
  driverLocationInner: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
    elevation: 5,
  },
  driverLocationIcon: {
    fontSize: 12,
    color: "#000",
  },
  demandAlert: {
    position: "absolute",
    top: 12,
    left: 12,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(15, 26, 46, 0.92)",
    borderRadius: 14,
    padding: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    maxWidth: 220,
  },
  demandAlertIcon: {
    fontSize: 18,
  },
  demandAlertTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.foreground,
  },
  demandAlertSub: {
    fontSize: 11,
    color: COLORS.muted,
  },
  mapControls: {
    position: "absolute",
    right: 12,
    top: 12,
    gap: 8,
  },
  mapControlBtn: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: "rgba(15, 26, 46, 0.92)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 2,
  },
  mapControlBtnActive: {
    borderColor: COLORS.primary,
    backgroundColor: "rgba(0, 200, 255, 0.15)",
  },
  mapControlIcon: {
    fontSize: 18,
  },
  mapControlLabel: {
    fontSize: 8,
    color: COLORS.muted,
  },
  actionBtns: {
    position: "absolute",
    bottom: 16,
    right: 12,
    gap: 12,
    alignItems: "center",
  },
  sosBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#8b0000",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: COLORS.error,
    shadowColor: COLORS.error,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 5,
    gap: 2,
  },
  sosBtnIcon: {
    fontSize: 20,
  },
  sosBtnText: {
    fontSize: 10,
    fontWeight: "800",
    color: COLORS.foreground,
  },
  navigateBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 5,
    gap: 2,
  },
  navigateBtnIcon: {
    fontSize: 22,
    color: "#000",
  },
  navigateBtnText: {
    fontSize: 9,
    fontWeight: "800",
    color: "#000",
  },
  earningsCard: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    borderTopWidth: 1,
    borderColor: COLORS.border,
  },
  earningsTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  earningsMain: {
    gap: 2,
  },
  earningsLabel: {
    fontSize: 13,
    color: COLORS.muted,
  },
  earningsAmount: {
    fontSize: 32,
    fontWeight: "800",
    color: COLORS.foreground,
  },
  viewDetailsText: {
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: "600",
  },
  earningsDivider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginBottom: 16,
  },
  earningsStats: {
    flexDirection: "row",
    gap: 16,
  },
  earningsStat: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface2,
    borderRadius: 14,
    padding: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  earningsStatIcon: {
    fontSize: 22,
  },
  earningsStatLabel: {
    fontSize: 11,
    color: COLORS.muted,
    marginBottom: 2,
  },
  earningsStatValue: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.foreground,
    marginBottom: 1,
  },
  earningsStatDivider: {
    width: 1,
    backgroundColor: COLORS.border,
  },
  // Active ride panel
  activeRideHeader: {
    marginBottom: 12,
  },
  newRequestBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  },
  activeRideStatus: {
    fontSize: 20,
    fontWeight: "800",
    color: COLORS.foreground,
  },
  advanceBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 14,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 5,
  },
  advanceBtnText: {
    fontSize: 16,
    fontWeight: "800",
    color: "#000",
  },
  messageBtn: {
    backgroundColor: COLORS.surface2,
    borderRadius: 16,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  messageBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.foreground,
  },
  // Request Modal
  requestOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  requestCard: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    paddingBottom: 36,
    borderTopWidth: 1,
    borderColor: COLORS.border,
  },
  requestHeader: {
    marginBottom: 16,
  },
  requestNewBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  },
  requestNewDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.error,
  },
  requestNewText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.muted,
    letterSpacing: 1,
  },
  requestTitle: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  requestTitleText: {
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.foreground,
  },
  requestCountdown: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 3,
    borderColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  requestCountdownText: {
    fontSize: 20,
    fontWeight: "800",
    color: COLORS.primary,
  },
  requestCountdownSub: {
    fontSize: 9,
    color: COLORS.muted,
  },
  requestFareRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },
  requestFareCard: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    padding: 14,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 110,
  },
  requestFareLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "rgba(0,0,0,0.6)",
    letterSpacing: 1,
    marginBottom: 4,
  },
  requestFareAmount: {
    fontSize: 22,
    fontWeight: "800",
    color: "#000",
  },
  requestFareSub: {
    fontSize: 10,
    color: "rgba(0,0,0,0.5)",
    marginTop: 2,
  },
  requestMetaGrid: {
    flex: 1,
    gap: 8,
  },
  requestMetaItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface2,
    borderRadius: 10,
    padding: 8,
    gap: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  requestMetaIcon: {
    fontSize: 14,
  },
  requestMetaValue: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.foreground,
    flex: 1,
  },
  requestMetaLabel: {
    fontSize: 10,
    color: COLORS.muted,
  },
  requestRoute: {
    backgroundColor: COLORS.surface2,
    borderRadius: 14,
    padding: 14,
    gap: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  requestRouteItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  requestRouteDotBlue: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.cyan,
    marginTop: 4,
  },
  requestRouteDotGreen: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.primary,
    marginTop: 4,
  },
  requestRouteLine: {
    width: 1,
    height: 12,
    backgroundColor: COLORS.border,
    marginLeft: 4,
  },
  requestRouteMain: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.foreground,
    marginBottom: 2,
  },
  requestRouteSub: {
    fontSize: 12,
    color: COLORS.muted,
  },
  requestActions: {
    flexDirection: "row",
    gap: 12,
  },
  declineBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 56,
    borderRadius: 16,
    backgroundColor: "rgba(255, 68, 68, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(255, 68, 68, 0.3)",
    gap: 8,
  },
  declineBtnIcon: {
    fontSize: 16,
    color: COLORS.error,
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
    height: 56,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    gap: 8,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 5,
  },
  acceptBtnIcon: {
    fontSize: 18,
    color: "#000",
  },
  acceptBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#000",
  },
  // SOS Modal
  sosOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.8)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  sosModal: {
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    padding: 28,
    alignItems: "center",
    width: "100%",
    borderWidth: 1,
    borderColor: "rgba(255, 68, 68, 0.3)",
  },
  sosModalIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  sosModalTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.error,
    marginBottom: 8,
  },
  sosModalText: {
    fontSize: 14,
    color: COLORS.muted,
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 20,
  },
  sosConfirmBtn: {
    backgroundColor: COLORS.error,
    borderRadius: 14,
    height: 52,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  sosConfirmText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fff",
  },
  sosCancelBtn: {
    height: 48,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  sosCancelText: {
    fontSize: 15,
    color: COLORS.muted,
  },
  sosDialBtn: {
    height: 48,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255, 68, 68, 0.4)",
    marginBottom: 8,
  },
  sosDialText: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.error,
  },
  sosActiveBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(255,68,68,0.12)",
    borderRadius: 14,
    padding: 12,
    marginHorizontal: 16,
    marginBottom: 8,
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
});
