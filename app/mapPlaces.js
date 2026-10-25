// Shared by Leaflet and the native map. Highlight metadata never changes routing endpoints.
export const PLACE_KINDS = {
  dining: { symbol: "●", color: "#9b5100" },
  cafe: { symbol: "☕", color: "#9b5100" },
  library: { symbol: "▤", color: "#326b56" },
  residence: { symbol: "⌂", color: "#635094" },
  building: { symbol: "▥", color: "#3e637f" },
};

export function mapPlaces(places, highlights = {}) {
  const seen = new Set();
  return places.filter(p => {
    if (!p?.id || seen.has(p.id) || !p.name || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return false;
    seen.add(p.id);
    return true;
  }).map(p => {
    const curated = highlights[p.id] ?? {};
    const kind = curated.kind ?? ({ Dining: "dining", Libraries: "library", "Residence halls": "residence" }[p.category] ?? "building");
    const priority = { Dining: 65, Libraries: 60, "Residence halls": 45, "Student life": 50,
      Landmarks: 50, Athletics: 35, Academic: 30 }[p.category] ?? 10;
    return { ...p, kind: PLACE_KINDS[kind] ? kind : "building", priority: curated.priority ?? priority,
      label: curated.label ?? (p.building_code || p.name.replace(/ Residence Hall$/, " Hall")), detail: curated.detail ?? "" };
  });
}

export const markerWidth = p => Math.min(164, Math.max(82, p.label.length * 6.5 + 32));
const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

export function visibleMapPlaces(places, { project, zoom, width, height, excludedIds = [], reserved = [], selectedId }) {
  if (!Number.isFinite(zoom) || width < 80 || height < 60) return [];
  const excluded = new Set(excludedIds.filter(Boolean));
  const occupied = [...reserved];
  const limit = Math.min(width < 600 ? 16 : 28, zoom < 16 ? 8 : 28);
  const ordered = places.filter(p => !excluded.has(p.id) &&
    (p.id === selectedId || (zoom >= 16 || p.priority >= 85) && (zoom >= 18 || p.category !== "Campus facilities")))
    .sort((a, b) => Number(b.id === selectedId) - Number(a.id === selectedId) || b.priority - a.priority || a.id.localeCompare(b.id));
  const result = [];
  for (const p of ordered) {
    const point = project(p);
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const rect = { left: point.x - 14, right: point.x + markerWidth(p) - 6, top: point.y - 24, bottom: point.y + 24 };
    if (rect.left < 4 || rect.right > width - 4 || rect.top < 4 || rect.bottom > height - 4 || occupied.some(r => overlaps(rect, r))) continue;
    occupied.push(rect);
    result.push(p);
    if (result.length >= limit) break;
  }
  return result;
}

// Mercator projection gives native labels the same spacing policy as Leaflet labels.
export function projectRegion(p, region, size) {
  const mercator = lat => Math.log(Math.tan(Math.PI / 4 + Math.max(-85, Math.min(85, lat)) * Math.PI / 360));
  const top = mercator(region.latitude + region.latitudeDelta / 2);
  const bottom = mercator(region.latitude - region.latitudeDelta / 2);
  return { x: ((p.lon - region.longitude) / region.longitudeDelta + 0.5) * size.width,
    y: (top - mercator(p.lat)) / (top - bottom) * size.height };
}

export function endpointReservations(points, project) {
  return points.map(p => {
    const { x, y } = project(p);
    return { left: x - Math.min(110, p.name.length * 3.5 + 14), right: x + Math.min(110, p.name.length * 3.5 + 14), top: y - 48, bottom: y + 22 };
  });
}
