export const MAROON = "#500000";
export const INK = "#1d1d1f";
export const MUTED = "#5c5c62"; // 6.4:1 on white
export const LINE = "#e6dddd";
export const TINT = "#f8eeee";
export const SUN = "#e0a21b"; // stretches of the selected route in direct sun

// Route styling, shared by the map and the route cards. `dash` applies when the route isn't selected;
// `tone` is the darker shade the route cards use for their dot and shade bar.
export const ROUTES = {
  fastest: { color: "#8c8c8c", tone: "#6b6b6b", label: "Fastest", dash: [6, 8] },
  recommended: { color: MAROON, tone: MAROON, label: "Recommended" },
  max_shade: { color: "#b0636b", tone: "#8e3f48", label: "Max shade", outline: "#6e2f35" },
  max_lit: { color: "#b0636b", tone: "#8e3f48", label: "Most lit", outline: "#6e2f35" },
};

// Blend from the route's own color (fully shaded) to SUN (fully in sun).
export function shadeColor(routeColor, shade) {
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [a, b] = [rgb(SUN), rgb(routeColor)];
  const t = Math.min(1, Math.max(0, shade));
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;
}

// Split a route into per-edge pieces with their shade, for coloring.
export function shadeRuns(feature) {
  const c = feature.geometry.coordinates;
  return (feature.properties.runs ?? [[0, c.length - 1, feature.properties.shaded_pct / 100]])
    .map(([a, b, shade]) => ({ coords: c.slice(a, b + 1), shade }));
}

// Lighter red/copper echoes the daytime maroon; gray distinguishes unknown coverage.
export const LIGHTING_COLORS = { mapped: "#da7943", estimated: "#c64b32", unknown: "#94a3b8", unlit: "#8f3026", conflict: "#8f3026" };

export function routeRuns(feature, routeColor) {
  if (feature.properties.mode === "lighting") {
    return feature.properties.lighting_runs.map((run) => ({ coords: run.coordinates, color: LIGHTING_COLORS[run.state] ?? LIGHTING_COLORS.unknown }));
  }
  return shadeRuns(feature).map((run) => ({ coords: run.coords, color: shadeColor(routeColor, run.shade) }));
}
