import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import type { RideMapMarker } from "./ride-map";

/**
 * Web version of RideMap: Leaflet + OpenStreetMap tiles inside an iframe
 * (srcDoc), so we need no extra npm packages and no API key. The iframe is
 * regenerated when markers move — Leaflet re-inits in <100ms, fine at our
 * 5s polling cadence. `route` draws the solid road polyline (`line` is the
 * dashed straight fallback); `follow` centers each regeneration on the
 * driver, which on this stateless iframe amounts to camera-follow.
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
  const html = useMemo(() => {
    const markersJs = markers
      .map(
        (m) =>
          `L.marker([${m.lat}, ${m.lng}], {icon: L.divIcon({html: '<div style="font-size:26px; text-shadow: 0 1px 4px rgba(0,0,0,.8)">${m.emoji}</div>', className: '', iconSize: [30,30], iconAnchor: [15,15]})}).addTo(map);`
      )
      .join("\n");

    // Pulsing blue "you are here" dot
    const userDotJs = userLocation
      ? `L.marker([${userLocation.lat}, ${userLocation.lng}], {icon: L.divIcon({html: '<div style="width:20px;height:20px;position:relative;display:flex;align-items:center;justify-content:center"><div style="position:absolute;width:20px;height:20px;border-radius:50%;background:rgba(0,122,255,0.25);animation:pulse 1.8s ease-in-out infinite"></div><div style="width:12px;height:12px;border-radius:50%;background:#007AFF;border:2px solid #fff;position:relative"></div></div>', className: '', iconSize: [20,20], iconAnchor: [10,10]})}).addTo(map);`
      : "";

    const routePts = route && route.length > 1 ? route : null;
    const lineJs = routePts
      ? `L.polyline(${JSON.stringify(routePts.map((p) => [p.lat, p.lng]))}, {color: '#00c8ff', weight: 4}).addTo(map);`
      : line && line.length > 1
        ? `L.polyline(${JSON.stringify(line.map((p) => [p.lat, p.lng]))}, {color: '#00c8ff', weight: 3, dashArray: '8 8'}).addTo(map);`
        : "";

    // Priority: explicit recenter > follow > fit markers > user dot > Accra
    const fitJs = center
      ? `map.setView([${center.lat}, ${center.lng}], 15);`
      : follow
        ? `map.setView([${follow.lat}, ${follow.lng}], 16);`
        : markers.length > 1
          ? `map.fitBounds(${JSON.stringify(markers.map((m) => [m.lat, m.lng]))}, {padding: [50, 50]});`
          : markers.length === 1
          ? `map.setView([${markers[0].lat}, ${markers[0].lng}], 15);`
          : userLocation
          ? `map.setView([${userLocation.lat}, ${userLocation.lng}], 15);`
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
  @keyframes pulse { 0%,100%{transform:scale(1);opacity:0.6} 50%{transform:scale(1.8);opacity:0.2} }
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
  ${userDotJs}
  ${markersJs}
</script></body></html>`;
  }, [markers, line, route, userLocation?.lat, userLocation?.lng, follow?.lat, follow?.lng, center?.nonce]);

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
