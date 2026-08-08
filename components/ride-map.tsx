import React, { useEffect, useMemo, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";

export type RideMapMarker = {
  id: string;
  lat: number;
  lng: number;
  emoji: string;
  /** Set true for markers that move (e.g. the driver car) so the native view re-renders */
  moving?: boolean;
};

// Dark map style (Android/Google) to match the app theme; iOS ignores it.
const DARK_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#0b1526" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8899aa" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#060c18" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1e3050" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#162035" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#04101f" }] },
  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#0f1a2e" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
];

const ACCRA = { latitude: 5.6037, longitude: -0.187 };
const PAN_SUSPEND_MS = 8000;

/** Pulsing blue "you are here" dot — rendered as a custom marker view. */
function UserDot() {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.8, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    ).start();
  }, [pulse]);
  return (
    <View style={dotStyles.wrap}>
      <Animated.View style={[dotStyles.ring, { transform: [{ scale: pulse }] }]} />
      <View style={dotStyles.dot} />
    </View>
  );
}

const dotStyles = StyleSheet.create({
  wrap: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  ring: {
    position: "absolute",
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(0, 122, 255, 0.25)",
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#007AFF",
    borderWidth: 2,
    borderColor: "#ffffff",
  },
});

/**
 * Real map (react-native-maps). `userLocation` renders a pulsing blue dot at
 * the passenger's own position. `route` draws the solid road-shaped polyline;
 * `line` is the dashed straight fallback. `follow` tracks a moving point
 * (driver) Bolt-style. `center` recenters on tap (nonce bump).
 */
export function RideMap({
  markers,
  line,
  route,
  follow,
  userLocation,
  style,
  center,
}: {
  markers: RideMapMarker[];
  line?: { lat: number; lng: number }[];
  route?: { lat: number; lng: number }[];
  follow?: { lat: number; lng: number } | null;
  userLocation?: { lat: number; lng: number } | null;
  style?: object;
  center?: { lat: number; lng: number; nonce: number } | null;
}) {
  const mapRef = useRef<MapView | null>(null);
  const lastPanAtRef = useRef(0);

  const idKey = useMemo(() => markers.map((m) => m.id).sort().join(","), [markers]);
  const following = follow != null;

  useEffect(() => {
    if (!mapRef.current || markers.length === 0 || following) return;
    // If only the user dot exists (no other markers), center on it
    const coords = markers.map((m) => ({ latitude: m.lat, longitude: m.lng }));
    const t = setTimeout(() => {
      mapRef.current?.fitToCoordinates(coords, {
        edgePadding: { top: 60, right: 60, bottom: 60, left: 60 },
        animated: true,
      });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey, following]);

  useEffect(() => {
    if (!follow || !mapRef.current) return;
    if (Date.now() - lastPanAtRef.current < PAN_SUSPEND_MS) return;
    mapRef.current.animateCamera(
      { center: { latitude: follow.lat, longitude: follow.lng }, zoom: 16 },
      { duration: 800 },
    );
  }, [follow?.lat, follow?.lng]);

  useEffect(() => {
    if (!center || !mapRef.current) return;
    mapRef.current.animateToRegion(
      { latitude: center.lat, longitude: center.lng, latitudeDelta: 0.02, longitudeDelta: 0.02 },
      500,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center?.nonce]);

  // On first load when there are no other markers, center on the user dot
  const initialCoord = userLocation
    ? { latitude: userLocation.lat, longitude: userLocation.lng }
    : markers[0]
    ? { latitude: markers[0].lat, longitude: markers[0].lng }
    : ACCRA;

  const routeToDraw = route && route.length > 1 ? route : undefined;

  return (
    <MapView
      ref={mapRef}
      style={[StyleSheet.absoluteFillObject, style]}
      customMapStyle={DARK_STYLE}
      onPanDrag={() => { lastPanAtRef.current = Date.now(); }}
      initialRegion={{ ...initialCoord, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
    >
      {routeToDraw ? (
        <Polyline
          coordinates={routeToDraw.map((p) => ({ latitude: p.lat, longitude: p.lng }))}
          strokeColor="#00c8ff"
          strokeWidth={4}
        />
      ) : (
        line && line.length > 1 && (
          <Polyline
            coordinates={line.map((p) => ({ latitude: p.lat, longitude: p.lng }))}
            strokeColor="#00c8ff"
            strokeWidth={3}
            lineDashPattern={[8, 8]}
          />
        )
      )}
      {/* Pulsing "you are here" dot — rendered before other markers so it sits beneath */}
      {userLocation && (
        <Marker
          coordinate={{ latitude: userLocation.lat, longitude: userLocation.lng }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
          zIndex={0}
        >
          <UserDot />
        </Marker>
      )}
      {markers.map((m) => (
        <Marker
          key={m.id}
          coordinate={{ latitude: m.lat, longitude: m.lng }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={m.moving ?? false}
          zIndex={1}
        >
          <View style={styles.markerWrap}>
            <Text style={styles.markerEmoji}>{m.emoji}</Text>
          </View>
        </Marker>
      ))}
    </MapView>
  );
}

const styles = StyleSheet.create({
  markerWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  markerEmoji: {
    fontSize: 26,
  },
});
