import React, { useEffect, useMemo, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";

export type RideMapMarker = {
  id: string;
  lat: number;
  lng: number;
  emoji: string;
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

/**
 * Real map (react-native-maps). Fits to the given markers when the marker SET
 * changes (not on every live position tick, so the user can pan freely while
 * a driver moves). `line` draws a dashed route hint between points.
 */
export function RideMap({
  markers,
  line,
  style,
  center,
}: {
  markers: RideMapMarker[];
  line?: { lat: number; lng: number }[];
  style?: object;
  // Recenter target; bump `nonce` to trigger a re-center even if coords are unchanged.
  center?: { lat: number; lng: number; nonce: number } | null;
}) {
  const mapRef = useRef<MapView | null>(null);

  // Refit only when which-markers-exist changes
  const idKey = useMemo(() => markers.map((m) => m.id).sort().join(","), [markers]);

  useEffect(() => {
    if (!mapRef.current || markers.length === 0) return;
    const coords = markers.map((m) => ({ latitude: m.lat, longitude: m.lng }));
    // slight delay so the map has laid out
    const t = setTimeout(() => {
      mapRef.current?.fitToCoordinates(coords, {
        edgePadding: { top: 60, right: 60, bottom: 60, left: 60 },
        animated: true,
      });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey]);

  // Recenter on demand (🎯 button)
  useEffect(() => {
    if (!center || !mapRef.current) return;
    mapRef.current.animateToRegion(
      {
        latitude: center.lat,
        longitude: center.lng,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      },
      500
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center?.nonce]);

  return (
    <MapView
      ref={mapRef}
      style={[StyleSheet.absoluteFillObject, style]}
      customMapStyle={DARK_STYLE}
      initialRegion={{
        ...(markers[0] ? { latitude: markers[0].lat, longitude: markers[0].lng } : ACCRA),
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      }}
    >
      {line && line.length > 1 && (
        <Polyline
          coordinates={line.map((p) => ({ latitude: p.lat, longitude: p.lng }))}
          strokeColor="#00c8ff"
          strokeWidth={3}
          lineDashPattern={[8, 8]}
        />
      )}
      {markers.map((m) => (
        <Marker
          key={m.id}
          coordinate={{ latitude: m.lat, longitude: m.lng }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
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
