// Pure URL generation shared by the phone/web handoff and regression tests.
const ll = ([lon, lat]) => `${lat.toFixed(6)},${lon.toFixed(6)}`;

export function routeWaypoints(coords, count = 3) {
  if (!Array.isArray(coords) || coords.length < 2) return [];
  const segments = coords.slice(1).map((b, i) => {
    const a = coords[i], cos = Math.cos((a[1] + b[1]) * Math.PI / 360);
    return Math.hypot((b[0] - a[0]) * cos, b[1] - a[1]);
  });
  const total = segments.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(total) || total <= 0) return [];
  const result = [];
  let walked = 0, i = 0;
  for (let n = 1; n <= count; n++) {
    const target = total * n / (count + 1);
    while (i < segments.length - 1 && walked + segments[i] < target) walked += segments[i++];
    while (i < segments.length - 1 && segments[i] === 0) i++;
    const t = (target - walked) / segments[i];
    const a = coords[i], b = coords[i + 1];
    result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return result;
}

export function googleMapsUrl(feature, start, end) {
  const q = new URLSearchParams({ api: "1", origin: `${start.lat},${start.lon}`,
    destination: `${end.lat},${end.lon}`, travelmode: "walking" });
  const points = routeWaypoints(feature.geometry.coordinates);
  if (points.length) q.set('waypoints', points.map(ll).join('|'));
  return `https://www.google.com/maps/dir/?${q}`;
}

export function appleMapsUrl(start, end) {
  const q = new URLSearchParams({ saddr: `${start.lat},${start.lon}`, daddr: `${end.lat},${end.lon}`, dirflg: "w" });
  return `https://maps.apple.com/?${q}`;
}
