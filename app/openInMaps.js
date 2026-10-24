import { Linking } from "react-native";

// Hand a route off to Google Maps or Apple Maps for turn-by-turn walking directions.
// Google Maps follows the route through up to 3 waypoints (its mobile limit); Apple Maps
// URLs can't carry waypoints, so it gets the same start and destination and picks its own path.

const ll = ([lon, lat]) => `${lat.toFixed(6)},${lon.toFixed(6)}`;

// Points at 1/4, 1/2 and 3/4 of the way along the line, by distance.
function waypoints(coords, n = 3) {
  const seg = coords.slice(1).map((c, i) => Math.hypot(c[0] - coords[i][0], c[1] - coords[i][1]));
  const total = seg.reduce((a, b) => a + b, 0);
  const out = [];
  let walked = 0, i = 0;
  for (let k = 1; k <= n; k++) {
    const target = (total * k) / (n + 1);
    while (i < seg.length - 1 && walked + seg[i] < target) walked += seg[i++];
    out.push(coords[i + 1]);
  }
  return out;
}

export function googleMapsUrl(feature, start, end) {
  const q = new URLSearchParams({
    api: "1",
    origin: `${start.lat},${start.lon}`,
    destination: `${end.lat},${end.lon}`,
    travelmode: "walking",
    waypoints: waypoints(feature.geometry.coordinates).map(ll).join("|"),
  });
  return `https://www.google.com/maps/dir/?${q}`;
}

export function appleMapsUrl(start, end) {
  const q = new URLSearchParams({ saddr: `${start.lat},${start.lon}`, daddr: `${end.lat},${end.lon}`, dirflg: "w" });
  return `https://maps.apple.com/?${q}`;
}

export const open = (url) => Linking.openURL(url);
