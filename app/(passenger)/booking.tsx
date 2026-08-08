import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import * as Location from "expo-location";
import { RideMap } from "@/components/ride-map";
import { useRoute } from "@/hooks/use-route";
import { SafeAreaView } from "react-native-safe-area-context";
import { trpc } from "@/lib/trpc";
import { useRideX } from "@/lib/ridex-context";
import { rideStore } from "@/lib/ride-store";

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
  error: "#ff4444",
  purple: "#8844ff",
  warning: "#f59e0b",
};

type RideType = "economy" | "comfort" | "premium";

const RIDE_OPTIONS = [
  {
    type: "economy" as RideType,
    emoji: "🚗",
    label: "Economy",
    desc: "Affordable everyday rides",
    fare: 8.40,
    eta: 3,
    distance: 1.2,
    trips: "12K+",
    rating: 4.7,
    seats: 4,
    color: COLORS.muted,
  },
  {
    type: "comfort" as RideType,
    emoji: "🚙",
    label: "Comfort",
    desc: "Newer cars, extra legroom",
    fare: 14.90,
    eta: 5,
    distance: 1.2,
    trips: "8K+",
    rating: 4.9,
    seats: 4,
    color: COLORS.success,
    bestValue: true,
    features: ["Insured ride", "Free cancellation", "Top driver"],
  },
  {
    type: "premium" as RideType,
    emoji: "🏎️",
    label: "Premium",
    desc: "Luxury vehicles & top-rated drivers",
    fare: 26.50,
    eta: 7,
    distance: 1.2,
    trips: "4K+",
    rating: 5.0,
    seats: 4,
    color: COLORS.purple,
  },
];

export default function BookingScreen() {
  const router = useRouter();
  const { user } = useRideX();
  const params = useLocalSearchParams<{
    destination?: string;
    destLat?: string;
    destLng?: string;
    pickupAddress?: string;
    pickupLat?: string;
    pickupLng?: string;
  }>();

  const [selectedType, setSelectedType] = useState<RideType>("comfort");
  // Real payment choice: wallet (debited at trip end if balance covers) or cash
  const [payMethod, setPayMethod] = useState<"wallet" | "cash">("wallet");
  const [promoCode] = useState("RIDEX10");
  const [isBooking, setIsBooking] = useState(false);

  const walletQuery = trpc.passenger.getWallet.useQuery(
    { userId: Number(user?.id) },
    { enabled: Number.isFinite(Number(user?.id)) }
  );
  const walletBalance = parseFloat(walletQuery.data?.balance ?? "0");

  const selectedOption = RIDE_OPTIONS.find((r) => r.type === selectedType)!;

  const requestRide = trpc.rides.request.useMutation();

  const destination = params.destination ?? "No destination selected";
  const destLat = parseFloat(params.destLat ?? "5.5502");
  const destLng = parseFloat(params.destLng ?? "-0.1870");
  const pickupAddress = params.pickupAddress ?? "Current Location";

  // Pickup: prefer explicit params; otherwise use the device's real GPS so
  // driver→pickup distances on the tracking screen are genuine.
  const paramPickupLat = params.pickupLat ? parseFloat(params.pickupLat) : null;
  const paramPickupLng = params.pickupLng ? parseFloat(params.pickupLng) : null;
  const [gpsPickup, setGpsPickup] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (paramPickupLat != null && paramPickupLng != null) return; // params win
    let cancelled = false;
    const grab = async () => {
      try {
        if (Platform.OS === "web") {
          if (typeof navigator !== "undefined" && navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                if (!cancelled) setGpsPickup({ lat: pos.coords.latitude, lng: pos.coords.longitude });
              },
              (err) => console.warn("[Booking] web geolocation failed:", err.message),
              { enableHighAccuracy: true, timeout: 8000 }
            );
          }
          return;
        }
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted" || cancelled) return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!cancelled) setGpsPickup({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      } catch (err) {
        console.warn("[Booking] failed to get GPS pickup:", err);
      }
    };
    grab();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickupLat = paramPickupLat ?? gpsPickup?.lat ?? 5.6037;
  const pickupLng = paramPickupLng ?? gpsPickup?.lng ?? -0.187;
  const pickupIsReal = paramPickupLat != null || gpsPickup != null;

  // Road-shaped preview line for the mini map
  const roadPreview = useRoute(
    { lat: pickupLat, lng: pickupLng },
    { lat: destLat, lng: destLng },
  );

  // Reverse-geocode the pickup coords into a human-readable place name so the
  // DRIVER sees a real address ("Adum Road, Kumasi"), not "Current Location".
  const [resolvedPickup, setResolvedPickup] = useState<string | null>(null);
  useEffect(() => {
    if (!pickupIsReal) return;
    if (params.pickupAddress && params.pickupAddress !== "Current Location") return;
    let cancelled = false;
    const reverse = async () => {
      try {
        const url = `https://photon.komoot.io/reverse?lat=${pickupLat}&lon=${pickupLng}&lang=en`;
        const res = await fetch(url, { headers: { Accept: "application/json" } });
        const data = await res.json();
        const p = data.features?.[0]?.properties;
        if (p && !cancelled) {
          const parts = [p.name ?? p.street, p.district, p.city].filter(Boolean);
          if (parts.length > 0) {
            setResolvedPickup([...new Set(parts)].join(", "));
            return;
          }
        }
        // Fallback: Nominatim reverse
        const nUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${pickupLat}&lon=${pickupLng}&zoom=16`;
        const nRes = await fetch(nUrl, { headers: { Accept: "application/json" } });
        const nData = await nRes.json();
        if (nData.display_name && !cancelled) {
          setResolvedPickup(nData.display_name.split(",").slice(0, 3).join(",").trim());
        }
      } catch (err) {
        console.warn("[Booking] reverse geocode failed:", err);
      }
    };
    reverse();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickupIsReal, pickupLat, pickupLng]);

  // What actually gets stored on the ride (and shown to the driver)
  const effectivePickupAddress =
    params.pickupAddress && params.pickupAddress !== "Current Location"
      ? params.pickupAddress
      : resolvedPickup ?? pickupAddress;

  // Real fare/distance/ETA from the server for the actual route
  const estimateQuery = trpc.rides.estimateFare.useQuery(
    {
      rideType: selectedType,
      pickupLat,
      pickupLng,
      destinationLat: destLat,
      destinationLng: destLng,
    },
    { enabled: !!params.destination }
  );
  const est = estimateQuery.data;
  const realDistanceKm = est?.distanceKm ?? selectedOption.distance;
  const realDurationMin = est?.durationMin ?? selectedOption.eta;

  // Server rate table (mirror of server/db.ts calculateFare) so every card
  // shows a real price for this route, not a canned number.
  const RATES: Record<RideType, { base: number; perKm: number; perMin: number }> = {
    economy: { base: 5.0, perKm: 1.5, perMin: 0.2 },
    comfort: { base: 8.0, perKm: 2.2, perMin: 0.3 },
    premium: { base: 15.0, perKm: 3.5, perMin: 0.45 },
  };
  const surge = est ? parseFloat(est.surgeMultiplier) : 1;
  const fareFor = (type: RideType) => {
    if (!est) return null;
    const r = RATES[type];
    return (r.base + r.perKm * est.distanceKm + r.perMin * est.durationMin) * surge;
  };

  const handleBook = async () => {
    setIsBooking(true);
    try {
      const passengerId = Number(user?.id);
      if (!Number.isFinite(passengerId)) {
        throw new Error("Not logged in");
      }
      if (!params.destination) {
        throw new Error("Please choose a destination first");
      }

      const result = await requestRide.mutateAsync({
        passengerId,
        rideType: selectedType,
        pickupAddress: effectivePickupAddress,
        pickupLat,
        pickupLng,
        destinationAddress: destination,
        destinationLat: destLat,
        destinationLng: destLng,
        paymentMethod: payMethod,
        promoCode: promoCode || undefined,
      });

      // Save active ride locally with the server-calculated fare/distance
      await rideStore.setActiveRide({
        id: String(result.rideId),
        rideType: selectedType,
        pickup: { address: effectivePickupAddress, lat: pickupLat, lng: pickupLng },
        destination: { address: destination, lat: destLat, lng: destLng },
        fare: parseFloat(result.estimatedFare) - parseFloat(result.discount || "0"),
        distanceKm: result.distanceKm,
        durationMin: result.durationMin,
        status: "searching",
      });

      router.push("/(passenger)/tracking" as any);
    } catch (err) {
      console.error("[Booking] Failed to request ride:", err);
      Alert.alert(
        "Booking failed",
        err instanceof Error ? err.message : "Could not reach the server. Please try again."
      );
    } finally {
      setIsBooking(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerRoute}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {effectivePickupAddress.split(",")[0]} → {destination.split(",")[0]}
          </Text>
          <Text style={styles.headerSub}>{realDistanceKm} km · {realDurationMin} min</Text>
        </View>
        <TouchableOpacity style={styles.closeBtn} onPress={() => router.back()}>
          <Text style={styles.closeIcon}>✕</Text>
        </TouchableOpacity>
      </View>

      {/* Mini Map */}
      <View style={styles.miniMap}>
        <RideMap
          markers={[
            { id: "pickup", lat: pickupLat, lng: pickupLng, emoji: "📍" },
            { id: "dest", lat: destLat, lng: destLng, emoji: "🔴" },
          ]}
          line={[
            { lat: pickupLat, lng: pickupLng },
            { lat: destLat, lng: destLng },
          ]}
          route={roadPreview.coords}
        />
        <View style={styles.miniMapInfo} pointerEvents="none">
          <Text style={styles.miniMapInfoText}>{realDistanceKm} km · {realDurationMin} min</Text>
        </View>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Ride Options */}
        <Text style={styles.sectionLabel}>SELECT RIDE TYPE</Text>
        {RIDE_OPTIONS.map((option) => (
          <TouchableOpacity
            key={option.type}
            style={[
              styles.rideCard,
              selectedType === option.type && styles.rideCardSelected,
              selectedType === option.type && { borderColor: option.color },
            ]}
            onPress={() => setSelectedType(option.type)}
          >
            {option.bestValue && (
              <View style={styles.bestValueBadge}>
                <Text style={styles.bestValueText}>BEST VALUE</Text>
              </View>
            )}
            <View style={styles.rideCardTop}>
              <Text style={styles.rideEmoji}>{option.emoji}</Text>
              <View style={styles.rideInfo}>
                <Text style={styles.rideName}>{option.label}</Text>
                <Text style={styles.rideDesc}>{option.desc}</Text>
                {option.features && (
                  <View style={styles.featureRow}>
                    {option.features.map((f) => (
                      <View key={f} style={styles.featureChip}>
                        <Text style={styles.featureText}>{f}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
              <View style={styles.ridePriceCol}>
                <Text style={[styles.rideFare, { color: option.color }]}>
                  {fareFor(option.type) != null
                    ? `GH₵${fareFor(option.type)!.toFixed(2)}`
                    : `GH₵${option.fare.toFixed(2)}`}
                </Text>
                <Text style={styles.rideEta}>⏱ {option.eta} min</Text>
              </View>
            </View>
            <View style={styles.rideCardBottom}>
              <Text style={styles.rideMetaText}>⭐ {option.rating}</Text>
              <Text style={styles.rideMetaDot}>·</Text>
              <Text style={styles.rideMetaText}>{option.trips} trips</Text>
              <Text style={styles.rideMetaDot}>·</Text>
              <Text style={styles.rideMetaText}>👤 {option.seats} seats</Text>
            </View>
          </TouchableOpacity>
        ))}

        {/* Fare Breakdown */}
        <View style={styles.fareBreakdown}>
          <Text style={styles.sectionLabel}>FARE BREAKDOWN</Text>
          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Base fare</Text>
            <Text style={styles.fareValue}>
              GH₵{RATES[selectedType].base.toFixed(2)}
            </Text>
          </View>
          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Distance ({realDistanceKm} km)</Text>
            <Text style={styles.fareValue}>
              GH₵{est ? (RATES[selectedType].perKm * est.distanceKm).toFixed(2) : "—"}
            </Text>
          </View>
          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Time (~{realDurationMin} min)</Text>
            <Text style={styles.fareValue}>
              GH₵{est ? (RATES[selectedType].perMin * est.durationMin).toFixed(2) : "—"}
            </Text>
          </View>
          {surge > 1 && (
            <View style={styles.fareRow}>
              <Text style={[styles.fareLabel, { color: COLORS.warning }]}>
                ⚡ Surge ({surge.toFixed(1)}x — high demand)
              </Text>
              <Text style={[styles.fareValue, { color: COLORS.warning }]}>
                ×{surge.toFixed(1)}
              </Text>
            </View>
          )}
          <View style={[styles.fareRow, styles.fareTotalRow]}>
            <Text style={styles.fareTotalLabel}>Total (estimated)</Text>
            <Text style={styles.fareTotalValue}>
              {fareFor(selectedType) != null ? `GH₵${fareFor(selectedType)!.toFixed(2)}` : "—"}
            </Text>
          </View>
          <Text style={styles.fareDisclaimer}>
            Final fare adjusts to your actual trip time.
          </Text>
        </View>

        {/* Payment Method */}
        <View style={styles.paymentRow}>
          <Text style={styles.paymentIcon}>💳</Text>
          <View style={styles.paymentInfo}>
            <Text style={styles.paymentLabel}>PAYMENT METHOD</Text>
            <View style={styles.payPills}>
              <TouchableOpacity
                style={[styles.payPill, payMethod === "wallet" && styles.payPillActive]}
                onPress={() => setPayMethod("wallet")}
              >
                <Text style={[styles.payPillText, payMethod === "wallet" && styles.payPillTextActive]}>
                  👛 Wallet · GH₵{walletBalance.toFixed(2)}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.payPill, payMethod === "cash" && styles.payPillActive]}
                onPress={() => setPayMethod("cash")}
              >
                <Text style={[styles.payPillText, payMethod === "cash" && styles.payPillTextActive]}>
                  💵 Cash
                </Text>
              </TouchableOpacity>
            </View>
            {payMethod === "wallet" &&
              fareFor(selectedType) != null &&
              walletBalance < fareFor(selectedType)! && (
                <Text style={styles.payWarn}>
                  Low balance — this ride will charge as cash instead.
                </Text>
              )}
          </View>
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Book Button */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.bookBtn, isBooking && styles.bookBtnDisabled]}
          onPress={handleBook}
          disabled={isBooking}
        >
          {isBooking ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Text style={styles.bookBtnText}>Book {selectedOption.label}</Text>
              <Text style={styles.bookBtnFare}>
                {fareFor(selectedType) != null
                  ? `GH₵${fareFor(selectedType)!.toFixed(2)}`
                  : ""}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: COLORS.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  backIcon: { fontSize: 18, color: COLORS.foreground },
  headerRoute: { flex: 1 },
  headerTitle: { fontSize: 14, fontWeight: "700", color: COLORS.foreground },
  headerSub: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: COLORS.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  closeIcon: { fontSize: 14, color: COLORS.muted },
  miniMap: {
    height: 120,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    overflow: "hidden",
    position: "relative",
  },
  miniMapGrid: { ...StyleSheet.absoluteFillObject },
  gridLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  miniRoute: {
    position: "absolute",
    top: "40%",
    left: "15%",
    right: "15%",
    flexDirection: "row",
    alignItems: "center",
  },
  miniRouteStart: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.primary,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 6,
    elevation: 4,
  },
  miniRouteLine: { flex: 1, height: 2, backgroundColor: COLORS.primary, opacity: 0.5 },
  miniRouteEnd: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.success,
    shadowColor: COLORS.success,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 6,
    elevation: 4,
  },
  miniMapLabel: {
    position: "absolute",
    right: 12,
    top: 12,
    backgroundColor: "rgba(0,200,255,0.12)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "rgba(0,200,255,0.3)",
  },
  miniMapLabelText: { fontSize: 10, fontWeight: "700", color: COLORS.primary },
  miniMapInfo: {
    position: "absolute",
    bottom: 10,
    left: 12,
    backgroundColor: "rgba(6,12,24,0.8)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  miniMapInfoText: { fontSize: 11, color: COLORS.muted },
  content: { flex: 1, paddingHorizontal: 16, paddingTop: 16 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.muted,
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  rideCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    overflow: "hidden",
  },
  rideCardSelected: {
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 4,
  },
  bestValueBadge: {
    position: "absolute",
    top: 0,
    right: 0,
    backgroundColor: COLORS.success,
    borderBottomLeftRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  bestValueText: { fontSize: 9, fontWeight: "800", color: "#000", letterSpacing: 0.5 },
  rideCardTop: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  rideEmoji: { fontSize: 28, marginTop: 2 },
  rideInfo: { flex: 1 },
  rideName: { fontSize: 16, fontWeight: "700", color: COLORS.foreground, marginBottom: 2 },
  rideDesc: { fontSize: 12, color: COLORS.muted, marginBottom: 6 },
  featureRow: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  featureChip: {
    backgroundColor: "rgba(0,232,135,0.1)",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: "rgba(0,232,135,0.25)",
  },
  featureText: { fontSize: 10, color: COLORS.success, fontWeight: "600" },
  ridePriceCol: { alignItems: "flex-end" },
  rideFare: { fontSize: 18, fontWeight: "800", marginBottom: 2 },
  rideEta: { fontSize: 12, color: COLORS.muted },
  rideCardBottom: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    gap: 6,
  },
  rideMetaText: { fontSize: 12, color: COLORS.muted },
  rideMetaDot: { fontSize: 12, color: COLORS.border },
  fareBreakdown: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginTop: 8,
  },
  fareRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  fareLabel: { fontSize: 13, color: COLORS.muted },
  fareValue: { fontSize: 13, color: COLORS.foreground, fontWeight: "600" },
  fareTotalRow: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 10,
    marginBottom: 0,
    marginTop: 4,
  },
  fareTotalLabel: { fontSize: 15, fontWeight: "700", color: COLORS.foreground },
  fareTotalValue: { fontSize: 18, fontWeight: "800", color: COLORS.primary },
  fareDisclaimer: {
    fontSize: 11,
    color: COLORS.muted,
    marginTop: 8,
    fontStyle: "italic",
  },
  paymentRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 16,
  },
  paymentIcon: { fontSize: 22 },
  paymentInfo: { flex: 1 },
  paymentLabel: { fontSize: 10, fontWeight: "700", color: COLORS.muted, letterSpacing: 0.5, marginBottom: 2 },
  paymentValue: { fontSize: 14, fontWeight: "600", color: COLORS.foreground },
  payPills: { flexDirection: "row", gap: 8, marginTop: 4 },
  payPill: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: COLORS.surface2,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  payPillActive: {
    backgroundColor: "rgba(0,200,255,0.1)",
    borderColor: COLORS.primary,
  },
  payPillText: { fontSize: 12, fontWeight: "700", color: COLORS.muted },
  payPillTextActive: { color: COLORS.primary },
  payWarn: { fontSize: 11, color: COLORS.warning, marginTop: 6 },
  changeBtn: {
    backgroundColor: "rgba(0,200,255,0.1)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "rgba(0,200,255,0.25)",
  },
  changeBtnText: { fontSize: 12, fontWeight: "600", color: COLORS.primary },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    paddingBottom: 32,
    backgroundColor: COLORS.bg,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  bookBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
  },
  bookBtnDisabled: { opacity: 0.7 },
  bookBtnText: { fontSize: 17, fontWeight: "700", color: "#fff" },
  bookBtnFare: { fontSize: 15, fontWeight: "600", color: "rgba(255,255,255,0.8)" },
});
