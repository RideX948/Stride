import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import type { RideMapMarker } from "./ride-map";

/**
 * Web version of RideMap: Leaflet + OpenStreetMap tiles inside an iframe
 * (srcDoc), so we need no extra npm packages and no API key. The iframe is
 * regenerated when markers move — Leaflet re-inits in <100ms, fine at our
 * 5s polling cadence.
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
  // Recenter target; bump `nonce` to force a re-center on repeated taps.
  center?: { lat: number; lng: number; nonce: number } | null;
}) {
  const html = useMemo(() => {
    const markersJs = markers
      .map(
        (m) =>
          `L.marker([${m.lat}, ${m.lng}], {icon: L.divIcon({html: '<div style="font-size:26px; text-shadow: 0 1px 4px rgba(0,0,0,.8)">${m.emoji}</div>', className: '', iconSize: [30,30], iconAnchor: [15,15]})}).addTo(map);`
      )
      .join("\n");
    const lineJs =
      line && line.length > 1
        ? `L.polyline(${JSON.stringify(line.map((p) => [p.lat, p.lng]))}, {color: '#00c8ff', weight: 3, dashArray: '8 8'}).addTo(map);`
        : "";
    // An explicit recenter (🎯) wins over the auto-fit
    const fitJs = center
      ? `map.setView([${center.lat}, ${center.lng}], 15);`
      : markers.length > 1
        ? `map.fitBounds(${JSON.stringify(markers.map((m) => [m.lat, m.lng]))}, {padding: [50, 50]});`
        : markers.length === 1
        ? `map.setView([${markers[0].lat}, ${markers[0].lng}], 15);`
        : `map.setView([5.6037, -0.187], 12);`;

    return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html, body, #map { margin: 0; height: 100%; width: 100%; background: #0b1526; }
  .leaflet-tile { filter: brightness(0.6) invert(1) contrast(3) hue-rotate(200deg) saturate(0.4) brightness(0.8); }
  .leaflet-container { background: #0b1526; }
  .leaflet-control-attribution { background: rgba(6,12,24,0.7) !important; color: #8899aa !important; font-size: 9px !important; }
  .leaflet-control-attribution a { color: #8899aa !important; }
</style></head>
<body><div id="map"></div>
<script>
  var map = L.map('map', { zoomControl: false, attributionControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);
  ${fitJs}
  ${lineJs}
  ${markersJs}
</script></body></html>`;
  }, [markers, line, center?.nonce]);

  return (
    <View style={[StyleSheet.absoluteFillObject, style]}>
      <iframe
        srcDoc={html}
        style={{ border: "none", width: "100%", height: "100%", display: "block" }}
        // Scripts must run for Leaflet; keep it sandboxed otherwise
        sandbox="allow-scripts"
        title="map"
      />
    </View>
  );
}
