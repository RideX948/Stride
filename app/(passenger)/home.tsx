import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import * as Location from "expo-location";
import { trpc } from "@/lib/trpc";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRideX } from "@/lib/ridex-context";
import { fareConfig, RideType } from "@/lib/ride-store";
import { NotificationsBell } from "@/components/notifications-bell";
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
  warning: "#f59e0b",
};

const RIDE_TYPES: { type: RideType; emoji: string; label: string; desc: string; minFare: number; maxFare: number; eta: number }[] = [
  { type: "economy", emoji: "🚗", label: "Economy", desc: "Affordable everyday rides", minFare: 8, maxFare: 11, eta: 3 },
  { type: "comfort", emoji: "🚙", label: "Comfort", desc: "Newer cars, extra legroom", minFare: 14, maxFare: 18, eta: 5 },
  { type: "premium", emoji: "🏎️", label: "Premium", desc: "Luxury vehicles", minFare: 24, maxFare: 30, eta: 7 },
];

const POPULAR_PLACES = [
  { label: "Airport", address: "Kotoka International Airport, Accra", lat: 5.6052, lng: -0.1668 },
  { label: "Accra Mall", address: "Spintex Road, Accra", lat: 5.6037, lng: -0.1870 },
  { label: "University of Ghana", address: "Legon, Accra", lat: 5.6502, lng: -0.1870 },
  { label: "Osu Castle", address: "Osu, Accra", lat: 5.5502, lng: -0.1870 },
];


const mapStyles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#060c18",
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
  routeContainer: {
    position: "absolute",
    top: "20%",
    left: "20%",
    right: "20%",
    flexDirection: "row",
    alignItems: "center",
  },
  routeStart: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.primary,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 5,
  },
  routeLine: {
    flex: 1,
    height: 2,
    backgroundColor: COLORS.primary,
    opacity: 0.6,
  },
  routeEnd: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.success,
    shadowColor: COLORS.success,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 5,
  },
  driverDot: {
    position: "absolute",
    opacity: 0.7,
  },
});

export default function PassengerHomeScreen() {
  const router = useRouter();
  const { user } = useRideX();
  const [destination, setDestination] = useState("");
  // Coordinates of the chosen destination (from popular place or geocoded search)
  const [destCoords, setDestCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedRide, setSelectedRide] = useState<RideType>("comfort");
  const [showDestSearch, setShowDestSearch] = useState(false);
  const [showRideOptions, setShowRideOptions] = useState(false);

  // Passenger's real position — used as the pickup point and to bias search
  // results toward places nearby (so someone in Kumasi sees Kumasi results).
  const [myPos, setMyPos] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const grab = async () => {
      try {
        if (Platform.OS === "web") {
          if (typeof navigator !== "undefined" && navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                if (!cancelled) setMyPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
              },
              (err) => console.warn("[Home] web geolocation failed:", err.message),
              { enableHighAccuracy: true, timeout: 8000 }
            );
          }
          return;
        }
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted" || cancelled) return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!cancelled) setMyPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      } catch (err) {
        console.warn("[Home] failed to get position:", err);
      }
    };
    grab();
    return () => {
      cancelled = true;
    };
  }, []);

  // Free-text destination search → Photon (OSM autocomplete) with location
  // bias so nearby places rank first; falls back to Nominatim if Photon fails.
  const [searchResults, setSearchResults] = useState<
    { label: string; address: string; lat: number; lng: number }[]
  >([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runGeocode = (query: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (query.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    // Debounce so we don't hammer the free APIs on every keystroke
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      const q = query.trim();
      try {
        // Photon: real autocomplete (partial words OK) + lat/lon bias
        const bias = myPos ? `&lat=${myPos.lat}&lon=${myPos.lng}` : "";
        const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=en${bias}`;
        const res = await fetch(url, { headers: { Accept: "application/json" } });
        const data = await res.json();
        const feats: any[] = data.features ?? [];
        const results = feats
          .filter((f) => f.geometry?.coordinates)
          .map((f) => {
            const p = f.properties ?? {};
            const parts = [p.name, p.street, p.district, p.city, p.state].filter(Boolean);
            return {
              label: p.name ?? parts[0] ?? q,
              address: [...new Set(parts)].join(", "),
              lat: f.geometry.coordinates[1],
              lng: f.geometry.coordinates[0],
            };
          });
        if (results.length > 0) {
          setSearchResults(results);
          return;
        }
        // Fallback: Nominatim full-text (needs more complete names)
        const nUrl =
          "https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=gh&q=" +
          encodeURIComponent(q);
        const nRes = await fetch(nUrl, { headers: { Accept: "application/json" } });
        const nData: { display_name: string; lat: string; lon: string }[] = await nRes.json();
        setSearchResults(
          nData.map((r) => ({
            label: r.display_name.split(",")[0],
            address: r.display_name,
            lat: parseFloat(r.lat),
            lng: parseFloat(r.lon),
          }))
        );
      } catch (err) {
        console.warn("[Home] geocode failed:", err);
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 500);
  };

  const selectDestination = (place: { address: string; lat: number; lng: number }) => {
    setDestination(place.address);
    setDestCoords({ lat: place.lat, lng: place.lng });
    setSearchResults([]);
    setShowDestSearch(false);
  };

  const selectedRideInfo = RIDE_TYPES.find((r) => r.type === selectedRide)!;

  // Safety net: if a ride is live (searching/accepted/arriving/in_progress),
  // surface a banner that jumps back to the tracking screen — navigating away
  // (e.g. via chat back button or tab switch) must never strand the ride.
  const passengerId = Number(user?.id);
  const activeRideQuery = trpc.rides.getActiveForPassenger.useQuery(
    { passengerId },
    { enabled: Number.isFinite(passengerId), refetchInterval: 10000 }
  );
  const activeRide = activeRideQuery.data;

  // Real online drivers near the passenger (count + map markers)
  const nearbyQuery = trpc.driver.nearby.useQuery(
    { lat: myPos?.lat ?? 0, lng: myPos?.lng ?? 0, radiusKm: 15 },
    { enabled: myPos != null, refetchInterval: 10000 }
  );
  const nearbyDrivers = nearbyQuery.data ?? [];
  const nearbyCount = nearbyDrivers.length;

  // Static POPULAR_PLACES are all Accra spots — only relevant if the user is
  // actually near Accra (~40 km). Everyone else searches instead.
  const nearAccra =
    myPos == null
      ? false
      : Math.abs(myPos.lat - 5.6037) < 0.35 && Math.abs(myPos.lng + 0.187) < 0.35;

  const handleBookRide = () => {
    if (!destination || !destCoords) {
      setShowDestSearch(true);
      return;
    }
    router.push({
      pathname: "/(passenger)/booking",
      params: {
        destination,
        destLat: String(destCoords.lat),
        destLng: String(destCoords.lng),
        // Pass the passenger's real position as pickup (booking re-checks GPS anyway)
        ...(myPos
          ? { pickupLat: String(myPos.lat), pickupLng: String(myPos.lng) }
          : {}),
      },
    } as any);
  };

  return (
    <View style={styles.container}>
      {/* Real Map */}
      <View style={{ ...StyleSheet.absoluteFillObject }}>
        <RideMap
          markers={[
            ...(myPos ? [{ id: "me", lat: myPos.lat, lng: myPos.lng, emoji: "🟢" }] : []),
            ...(destCoords ? [{ id: "dest", lat: destCoords.lat, lng: destCoords.lng, emoji: "🔴" }] : []),
            // Real online drivers around the passenger
            ...nearbyDrivers
              .filter((d) => d.currentLat != null && d.currentLng != null)
              .map((d) => ({
                id: `drv-${d.id}`,
                lat: d.currentLat!,
                lng: d.currentLng!,
                emoji: "🚗",
              })),
          ]}
          line={
            myPos && destCoords
              ? [
                  { lat: myPos.lat, lng: myPos.lng },
                  { lat: destCoords.lat, lng: destCoords.lng },
                ]
              : undefined
          }
        />
      </View>

      {/* Top Bar */}
      <SafeAreaView edges={["top"]} style={styles.topBar}>
        <TouchableOpacity style={styles.profileBtn}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {user?.name?.charAt(0) ?? "A"}
            </Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={styles.searchBar} onPress={() => setShowDestSearch(true)}>
          <Text style={styles.searchIcon}>🔍</Text>
          <Text style={styles.searchText}>Where to?</Text>
        </TouchableOpacity>
        <NotificationsBell
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(15, 26, 46, 0.95)" }}
        />
      </SafeAreaView>

      {/* Ride-in-progress banner — tap to return to live tracking */}
      {activeRide && (
        <TouchableOpacity
          style={styles.activeRideBanner}
          onPress={() => router.push("/(passenger)/tracking" as any)}
          activeOpacity={0.85}
        >
          <Text style={styles.activeRideIcon}>🚗</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.activeRideTitle}>
              {activeRide.status === "searching"
                ? "Finding your driver..."
                : activeRide.status === "in_progress"
                ? "Trip in progress"
                : "Driver on the way"}
            </Text>
            <Text style={styles.activeRideSub} numberOfLines={1}>
              To {activeRide.destinationAddress} · tap to track
            </Text>
          </View>
          <Text style={styles.activeRideChevron}>›</Text>
        </TouchableOpacity>
      )}

      {/* Map controls */}
      <View style={styles.mapControls}>
        <TouchableOpacity style={styles.mapBtn}>
          <Text style={styles.mapBtnIcon}>🎯</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.mapBtn}>
          <Text style={styles.mapBtnIcon}>🗺️</Text>
        </TouchableOpacity>
      </View>

      {/* Bottom Sheet */}
      <View style={styles.bottomSheet}>
        {/* Pickup = current location indicator */}
        <View style={styles.pickupRow}>
          <Text style={styles.pickupDot}>🟢</Text>
          <Text style={styles.pickupText}>
            {myPos ? "Pickup: your current location" : "Getting your location..."}
          </Text>
          {myPos && <Text style={styles.pickupLive}>● GPS</Text>}
        </View>

        {/* Destination Input */}
        <TouchableOpacity
          style={styles.destInput}
          onPress={() => setShowDestSearch(true)}
        >
          <Text style={styles.destIcon}>🔍</Text>
          <View style={styles.destTextWrap}>
            <Text style={styles.destLabel}>WHERE ARE YOU GOING?</Text>
            <Text style={destination ? styles.destValue : styles.destPlaceholder}>
              {destination || "Tap to set destination"}
            </Text>
          </View>
          <Text style={styles.destChevron}>›</Text>
        </TouchableOpacity>

        {/* Ride Type Selector — 3 equal cards, no scroll */}
        <View style={styles.rideTypeRow}>
          {RIDE_TYPES.map((rt) => (
            <TouchableOpacity
              key={rt.type}
              style={[
                styles.rideTypeChip,
                selectedRide === rt.type && styles.rideTypeChipActive,
              ]}
              onPress={() => setSelectedRide(rt.type)}
            >
              {rt.type === "comfort" && (
                <View style={styles.popularBadge}>
                  <Text style={styles.popularText}>POPULAR</Text>
                </View>
              )}
              <Text style={styles.rideTypeEmoji}>{rt.emoji}</Text>
              <Text
                style={[styles.rideTypeLabel, selectedRide === rt.type && styles.rideTypeLabelActive]}
                numberOfLines={1}
              >
                {rt.label}
              </Text>
              <Text style={styles.rideTypeFare} numberOfLines={1}>
                GH₵{rt.minFare}–{rt.maxFare}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Nearby count — real online drivers within 15 km */}
        <View style={styles.nearbyRow}>
          <Text style={styles.nearbyDot}>🚗</Text>
          <Text style={styles.nearbyText}>
            {myPos == null || nearbyQuery.isLoading
              ? "Checking for drivers..."
              : nearbyCount === 0
              ? "No drivers nearby right now"
              : `${nearbyCount} driver${nearbyCount > 1 ? "s" : ""} nearby`}
          </Text>
        </View>

        {/* Book Button */}
        <TouchableOpacity style={styles.bookBtn} onPress={handleBookRide}>
          <Text style={styles.bookBtnText}>Book Now</Text>
          <Text style={styles.bookBtnArrow}>→</Text>
        </TouchableOpacity>
      </View>

      {/* Destination Search Modal */}
      <Modal visible={showDestSearch} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.searchModal}>
            <View style={styles.searchModalHeader}>
              <Text style={styles.searchModalTitle}>Where to?</Text>
              <TouchableOpacity onPress={() => setShowDestSearch(false)}>
                <Text style={styles.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.searchInputBox}>
              <Text style={styles.searchInputIcon}>🔍</Text>
              <TextInput
                style={styles.searchInput}
                placeholder="Search destination..."
                placeholderTextColor={COLORS.muted}
                value={destination}
                onChangeText={(text) => {
                  setDestination(text);
                  setDestCoords(null); // typing invalidates the previous pick
                  runGeocode(text);
                }}
                autoFocus
              />
              {searching && <ActivityIndicator size="small" color={COLORS.primary} />}
            </View>

            {/* Geocoded search results */}
            {searchResults.length > 0 && (
              <>
                <Text style={styles.popularLabel}>Search Results</Text>
                {searchResults.map((place, i) => (
                  <TouchableOpacity
                    key={`${place.lat}-${i}`}
                    style={styles.placeRow}
                    onPress={() => selectDestination(place)}
                  >
                    <View style={styles.placeIcon}>
                      <Text style={styles.placeIconText}>🔎</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.placeName}>{place.label}</Text>
                      <Text style={styles.placeAddr} numberOfLines={1}>{place.address}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </>
            )}

            {/* Static suggestions are Accra spots — only show them near Accra */}
            {nearAccra && (
              <>
                <Text style={styles.popularLabel}>Popular Places</Text>
                {POPULAR_PLACES.map((place) => (
                  <TouchableOpacity
                    key={place.label}
                    style={styles.placeRow}
                    onPress={() => selectDestination(place)}
                  >
                    <View style={styles.placeIcon}>
                      <Text style={styles.placeIconText}>📍</Text>
                    </View>
                    <View>
                      <Text style={styles.placeName}>{place.label}</Text>
                      <Text style={styles.placeAddr}>{place.address}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </>
            )}
            {!nearAccra && searchResults.length === 0 && (
              <Text style={{ color: COLORS.muted, fontSize: 13, textAlign: "center", paddingVertical: 16 }}>
                Type a place name to search near you
              </Text>
            )}
          </View>
        </View>
      </Modal>
    </View>
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
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 10,
    zIndex: 10,
  },
  activeRideBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 16,
    marginTop: 4,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "rgba(0,200,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(0,200,255,0.45)",
    zIndex: 10,
  },
  activeRideIcon: { fontSize: 22 },
  activeRideTitle: { fontSize: 14, fontWeight: "800", color: COLORS.primary },
  activeRideSub: { fontSize: 11, color: COLORS.muted, marginTop: 1 },
  activeRideChevron: { fontSize: 22, color: COLORS.primary, fontWeight: "700" },
  profileBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: "hidden",
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fff",
  },
  searchBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(15, 26, 46, 0.95)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 8,
  },
  searchIcon: {
    fontSize: 14,
  },
  searchText: {
    fontSize: 14,
    color: COLORS.muted,
  },
  notifBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(15, 26, 46, 0.95)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  notifIcon: {
    fontSize: 18,
  },
  notifBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.error,
  },
  mapControls: {
    position: "absolute",
    right: 16,
    top: height * 0.2,
    gap: 10,
    zIndex: 5,
  },
  mapBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "rgba(15, 26, 46, 0.95)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  mapBtnIcon: {
    fontSize: 18,
  },
  bottomSheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderColor: COLORS.border,
  },
  pickupRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  pickupDot: {
    fontSize: 10,
  },
  pickupText: {
    flex: 1,
    fontSize: 12,
    color: COLORS.muted,
    fontWeight: "600",
  },
  pickupLive: {
    fontSize: 10,
    fontWeight: "800",
    color: COLORS.success,
  },
  destInput: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface2,
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 10,
  },
  destIcon: {
    fontSize: 16,
  },
  destTextWrap: {
    flex: 1,
  },
  destLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.muted,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  destValue: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.foreground,
  },
  destPlaceholder: {
    fontSize: 14,
    color: COLORS.muted,
  },
  destChevron: {
    fontSize: 20,
    color: COLORS.muted,
  },
  rideTypeRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
    marginTop: 6,
  },
  rideTypeChip: {
    flex: 1,
    backgroundColor: COLORS.surface2,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 4,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: COLORS.border,
    position: "relative",
  },
  rideTypeChipActive: {
    borderColor: COLORS.primary,
    backgroundColor: "rgba(0, 200, 255, 0.08)",
  },
  popularBadge: {
    position: "absolute",
    top: -8,
    backgroundColor: COLORS.primary,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  popularText: {
    fontSize: 8,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: 0.5,
  },
  rideTypeEmoji: {
    fontSize: 22,
    marginBottom: 3,
    marginTop: 6,
  },
  rideTypeLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.muted,
    marginBottom: 2,
  },
  rideTypeLabelActive: {
    color: COLORS.primary,
  },
  rideTypeFare: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.foreground,
    marginBottom: 4,
  },
  nearbyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 14,
  },
  nearbyDot: {
    fontSize: 14,
  },
  nearbyText: {
    fontSize: 13,
    color: COLORS.muted,
  },
  bookBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
  },
  bookBtnText: {
    fontSize: 17,
    fontWeight: "700",
    color: "#fff",
  },
  bookBtnArrow: {
    fontSize: 18,
    color: "#fff",
    fontWeight: "700",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "flex-end",
  },
  searchModal: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 40,
    maxHeight: height * 0.8,
  },
  searchModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  searchModalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.foreground,
  },
  closeBtn: {
    fontSize: 18,
    color: COLORS.muted,
    padding: 4,
  },
  searchInputBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface2,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 50,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 10,
  },
  searchInputIcon: {
    fontSize: 16,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: COLORS.foreground,
  },
  popularLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.muted,
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  placeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  placeIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: COLORS.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  placeIconText: {
    fontSize: 18,
  },
  placeName: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.foreground,
    marginBottom: 2,
  },
  placeAddr: {
    fontSize: 12,
    color: COLORS.muted,
  },
});
