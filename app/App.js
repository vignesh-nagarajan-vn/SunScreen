import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Image, PanResponder, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, useWindowDimensions, View,
} from "react-native";
import Slider from "@react-native-community/slider";
import RouteMap from "./RouteMap";
import PlacePicker from "./PlacePicker";
import { API_BASE } from "./config";
import { appleMapsUrl, googleMapsUrl, open } from "./openInMaps";
import { INK, LINE, MAROON, MUTED, ROUTES, SUN, TINT } from "./theme";
import fallback from "./fallback.json";
import area from "./places.json";

const FIRST = 7 * 60, LAST = 20 * 60;
const WIDE = 900; // side-panel layout at and above this width
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const clock = (min) => `${((Math.floor(min / 60) + 11) % 12) + 1}:${String(min % 60).padStart(2, "0")} ${min < 720 ? "AM" : "PM"}`;
const snap = (min) => Math.min(LAST, Math.max(FIRST, Math.round(min / 30) * 30));
const nowMin = () => { const d = new Date(); return snap(d.getHours() * 60 + d.getMinutes()); };
const byId = Object.fromEntries(area.places.map((p) => [p.id, p]));
const param = (p) => p.id ?? `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
const inBounds = (p, b) => p.lat >= b.south && p.lat <= b.north && p.lon >= b.west && p.lon <= b.east;
const extraText = (s) => (s < 60 ? `+${s} s` : `+${(s / 60).toFixed(1)} min`);

// Start at the current time; on web, ?from=&to=&time=HH:MM&route= preselect a trip.
const params = Platform.OS === "web" ? new URLSearchParams(window.location.search) : new URLSearchParams();
const timeParam = params.get("time")?.split(":").map(Number);
const initialMin = timeParam ? snap(timeParam[0] * 60 + timeParam[1]) : nowMin();

function weatherPills({ weather, sun }) {
  if (weather.source === "sun down") return ["☾ Sun down"];
  const up = `☀ ${Math.round(sun.altitude)}° up`;
  const c = weather.cloud_cover_pct;
  if (c == null) return [up, "Weather unavailable"];
  const sky = c < 10 ? "Clear" : c < 40 ? "Mostly sunny" : c < 70 ? "☁ Partly cloudy" : "☁ Overcast";
  return [up, sky, `${weather.sun_strength_pct}% sunlight`];
}

// One line on what the recommended route buys you.
function headline(data) {
  const [f, r] = data.features.map((x) => x.properties);
  if (data.weather.sun_strength_pct === 0 || data.weather.sun_strength_pct < 25 || r.same_as_fastest) return data.summary;
  const saved = f.sun_min - r.sun_min;
  const savedText = saved >= 1 ? `${Math.round(saved)} fewer min` : `${Math.round(saved * 60)} fewer s`;
  return `Recommended: ${extraText(r.extra_s)} walk, ${savedText} in direct sun`;
}

export default function App() {
  const wide = useWindowDimensions().width >= WIDE;
  const [from, setFrom] = useState(byId[params.get("from")] ?? byId[area.default[0]]);
  const [to, setTo] = useState(byId[params.get("to")] ?? byId[area.default[1]]);
  const [minutes, setMinutes] = useState(initialMin);
  const [preview, setPreview] = useState(initialMin);
  const [selected, setSelected] = useState(params.get("route") ?? "recommended");
  const [data, setData] = useState(null);
  const [status, setStatus] = useState({ loading: true });
  const [picker, setPicker] = useState(null); // "from" | "to" while choosing an endpoint
  const [picking, setPicking] = useState(null); // "from" | "to" while waiting for a map tap
  const [expanded, setExpanded] = useState(false); // phone card: all three routes vs. just the selected one
  const [playing, setPlaying] = useState(false);
  const [cardHeight, setCardHeight] = useState(300);

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const q = new URLSearchParams({ time: hhmm(minutes), from: param(from), to: param(to), from_name: from.name, to_name: to.name });
    setStatus({ loading: true });
    fetch(`${API_BASE}/api/route?${q}`, { signal: ctrl.signal })
      .then(async (r) => {
        const json = await r.json();
        if (cancelled) return;
        if (r.ok) { setData(json); setStatus({}); } else { setStatus({ error: json.detail }); setPlaying(false); } // e.g. "outside the area"
      })
      .catch(() => {
        if (cancelled) return;
        // Server unreachable: the default trip has bundled routes, anything else can't be routed offline.
        if (from.id === area.default[0] && to.id === area.default[1]) {
          setData(fallback[hhmm(minutes)]);
          setStatus({ offline: true });
        } else {
          setStatus({ error: "Can't reach the SunScreen server. Check your connection and try again." });
          setPlaying(false);
        }
      })
      .finally(() => clearTimeout(timer));
    return () => { cancelled = true; clearTimeout(timer); ctrl.abort(); };
  }, [minutes, from, to]);

  // Play: step through the day, waiting for each slot's routes before moving on.
  useEffect(() => {
    if (!playing || status.loading) return;
    if (minutes >= LAST) return setPlaying(false);
    const t = setTimeout(() => { setMinutes(minutes + 30); setPreview(minutes + 30); }, 700);
    return () => clearTimeout(t);
  }, [playing, status.loading, minutes]);

  const setTime = (m) => { setPlaying(false); setMinutes(m); setPreview(m); };
  const togglePlay = () => {
    if (!playing && minutes >= LAST) setTime(FIRST);
    setPlaying(!playing);
  };
  const choose = (which, place) => {
    (which === "from" ? setFrom : setTo)(place);
    setPicker(null);
    setPicking(null);
  };
  const onMapPress = (p) => {
    if (!inBounds(p, area.bounds)) return;
    choose(picking, { ...p, id: null, name: "Dropped pin" });
  };
  const showRoutes = data && !status.error;

  const controls = (
    <Controls
      data={showRoutes ? data : null} status={status} selected={selected} setSelected={setSelected}
      preview={preview} minutes={minutes} setPreview={setPreview} setTime={setTime}
      playing={playing} togglePlay={togglePlay} expanded={wide || expanded} setExpanded={wide ? null : setExpanded}
    />
  );
  const mapPane = (
    <>
      <RouteMap data={showRoutes ? data : null} selected={selected} bounds={area.bounds} picking={!!picking} onMapPress={onMapPress} />
      {showRoutes && !picking && <Legend />}
      {picking && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Tap the map to set your {picking === "from" ? "start" : "destination"}</Text>
          <Pressable onPress={() => setPicking(null)} hitSlop={8}><Text style={styles.bannerCancel}>Cancel</Text></Pressable>
        </View>
      )}
    </>
  );
  const pickerSheet = picker && (
    <PlacePicker
      title={picker === "from" ? "Start" : "Destination"} places={area.places} bounds={area.bounds}
      onSelect={(p) => choose(picker, p)} onClose={() => setPicker(null)}
      onPickOnMap={() => { setPicking(picker); setPicker(null); }}
    />
  );
  const header = <Header from={from} to={to} setPicker={setPicker} swap={() => { setFrom(to); setTo(from); }} />;

  if (wide) {
    return (
      <View style={[styles.screen, { flexDirection: "row" }]}>
        <View style={styles.panel}>
          {header}
          <ScrollView contentContainerStyle={styles.panelBody}>{controls}</ScrollView>
          {pickerSheet}
        </View>
        <View style={styles.map}>{mapPane}</View>
      </View>
    );
  }
  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" backgroundColor={MAROON} />
      {header}
      {/* The map ends where the card starts (minus its rounded corner), so fits and limits use what is visible. */}
      <View style={[styles.map, { marginBottom: picking ? 0 : cardHeight - 20 }]}>{mapPane}</View>
      {!picking && (
        <View style={styles.card} onLayout={(e) => setCardHeight(e.nativeEvent.layout.height)}>{controls}</View>
      )}
      {pickerSheet}
    </View>
  );
}

function Header({ from, to, setPicker, swap }) {
  return (
    <View style={styles.header}>
      <View style={styles.brandRow}>
        <Image source={require("./assets/logo.png")} style={styles.logo} />
        <Text style={styles.brand}>SunScreen</Text>
      </View>
      <View style={styles.trip}>
        <View style={{ flex: 1 }}>
          <Endpoint label="From" place={from} onPress={() => setPicker("from")} />
          <View style={styles.tripDivider} />
          <Endpoint label="To" place={to} onPress={() => setPicker("to")} />
        </View>
        <Pressable onPress={swap} style={styles.swap} hitSlop={8} accessibilityLabel="Swap start and destination">
          <Text style={styles.swapText}>⇅</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Controls({ data, status, selected, setSelected, preview, minutes, setPreview, setTime, playing, togglePlay, expanded, setExpanded }) {
  // Swipe the handle up/down (or tap it) to show all routes or just the selected one.
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 8,
    onPanResponderRelease: (_, g) => { if (g.dy < -20) setExpanded?.(true); else if (g.dy > 20) setExpanded?.(false); },
  })).current;
  const routes = data ? (expanded ? data.features : data.features.filter((f) => f.properties.id === selected)) : [];

  return (
    <View>
      {setExpanded && (
        <Pressable {...pan.panHandlers} onPress={() => setExpanded(!expanded)} style={styles.handleArea}
          accessibilityLabel={expanded ? "Show fewer routes" : "Compare all routes"}>
          <View style={styles.handle} />
        </Pressable>
      )}
      <View style={styles.timeRow}>
        <Text style={styles.time}>{clock(preview)}</Text>
        <View style={styles.timeButtons}>
          <SmallButton label={playing ? "❚❚ Pause" : "▶ Play day"} onPress={togglePlay} active={playing} />
          <SmallButton label="Now" onPress={() => setTime(nowMin())} />
        </View>
      </View>
      {data && (
        <View style={styles.pills}>
          {weatherPills(data).map((t) => <Text key={t} style={styles.pill}>{t}</Text>)}
          {status.loading && <ActivityIndicator size="small" color={MAROON} />}
        </View>
      )}
      <Slider
        minimumValue={FIRST} maximumValue={LAST} step={30} value={minutes}
        onValueChange={setPreview} onSlidingComplete={setTime}
        minimumTrackTintColor={MAROON} maximumTrackTintColor="#d9cfcf" thumbTintColor={MAROON}
      />
      <View style={styles.ticks}>
        {["7 AM", "11 AM", "3 PM", "8 PM"].map((t) => <Text key={t} style={styles.tick}>{t}</Text>)}
      </View>

      {status.error && <Text style={styles.error}>{status.error}</Text>}
      {data && <Text style={styles.headline}>{headline(data)}</Text>}
      {routes.map(({ properties: p }) => (
        <RouteRow key={p.id} p={p} active={p.id === selected} onPress={() => setSelected(p.id)} />
      ))}
      {data && setExpanded && (
        <Pressable onPress={() => setExpanded(!expanded)} hitSlop={6}>
          <Text style={styles.compare}>{expanded ? "Show less ▾" : "Compare all 3 routes ▴"}</Text>
        </Pressable>
      )}
      {data && <Handoff data={data} selected={selected} />}
      {status.offline && <Text style={styles.offline}>Offline: showing saved routes for The Commons → Zachry</Text>}
    </View>
  );
}

function SmallButton({ label, onPress, active }) {
  return (
    <Pressable onPress={onPress} style={[styles.small, active && styles.smallActive]} accessibilityRole="button">
      <Text style={[styles.smallText, active && { color: "white" }]}>{label}</Text>
    </Pressable>
  );
}

function Legend() {
  return (
    <View style={styles.legend} pointerEvents="none">
      <View style={[styles.legendSwatch, { backgroundColor: MAROON }]} /><Text style={styles.legendText}>Shade</Text>
      <View style={[styles.legendSwatch, { backgroundColor: SUN }]} /><Text style={styles.legendText}>Sun</Text>
    </View>
  );
}

function Endpoint({ label, place, onPress }) {
  return (
    <Pressable onPress={onPress} style={styles.endpoint}>
      <Text style={styles.endpointLabel}>{label}</Text>
      <Text style={styles.endpointName} numberOfLines={1}>{place.name}</Text>
    </Pressable>
  );
}

// Hand the selected route to a maps app for turn-by-turn directions.
function Handoff({ data, selected }) {
  const feature = data.features.find((f) => f.properties.id === selected) ?? data.features[0];
  return (
    <View style={styles.handoff}>
      <Pressable style={[styles.mapsButton, styles.mapsPrimary]} onPress={() => open(googleMapsUrl(feature, data.start, data.end))}>
        <Text style={styles.mapsPrimaryText}>Open in Google Maps</Text>
      </Pressable>
      <Pressable style={styles.mapsButton} onPress={() => open(appleMapsUrl(data.start, data.end))}>
        <Text style={styles.mapsText}>Apple Maps</Text>
      </Pressable>
    </View>
  );
}

function RouteRow({ p, active, onPress }) {
  const extra = p.extra_s > 0 ? ` · ${extraText(p.extra_s)}` : "";
  const style = ROUTES[p.id];
  return (
    <Pressable onPress={onPress} style={[styles.row, active && styles.rowActive]}>
      <View style={[styles.swatch, { backgroundColor: style.color }, style.dash && styles.swatchDashed]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>
          {p.label}
          {p.id !== "fastest" && p.same_as_fastest && <Text style={styles.same}>  same route</Text>}
          {!p.same_as_fastest && p.same_as_recommended && <Text style={styles.same}>  same route</Text>}
        </Text>
        <Text style={styles.rowMeta}>{p.time_min} min · {p.distance_m} m{extra}</Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={[styles.shade, active && { color: MAROON }]}>{p.shaded_pct}%</Text>
        <Text style={styles.rowMeta}>shaded · {p.sun_min} min sun</Text>
      </View>
    </Pressable>
  );
}

const topInset = Platform.select({ ios: 50, android: (StatusBar.currentHeight ?? 24) + 6, default: 12 });

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "white" },
  header: { backgroundColor: MAROON, paddingTop: topInset, paddingBottom: 12, paddingHorizontal: 16, gap: 10 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  logo: { width: 28, height: 28 },
  brand: { color: "white", fontSize: 20, fontWeight: "700", letterSpacing: 0.3 },
  trip: { flexDirection: "row", alignItems: "center", backgroundColor: "white", borderRadius: 12, paddingLeft: 12 },
  tripDivider: { height: 1, backgroundColor: LINE },
  endpoint: { flexDirection: "row", alignItems: "center", paddingVertical: 10, gap: 10 },
  endpointLabel: { width: 36, color: MUTED, fontSize: 12, fontWeight: "600" },
  endpointName: { flex: 1, color: INK, fontSize: 15, fontWeight: "600" },
  swap: { width: 48, alignSelf: "stretch", alignItems: "center", justifyContent: "center" },
  swapText: { color: MAROON, fontSize: 22, fontWeight: "700" },
  map: { flex: 1 },
  panel: { width: 400, borderRightWidth: 1, borderRightColor: LINE, backgroundColor: "white" },
  panelBody: { padding: 16 },
  banner: { position: "absolute", zIndex: 1000, top: 12, left: 12, right: 12, backgroundColor: MAROON, borderRadius: 12, padding: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  bannerText: { color: "white", fontWeight: "600", flex: 1 },
  bannerCancel: { color: "#f1dede", fontWeight: "600", marginLeft: 12 },
  legend: { position: "absolute", zIndex: 1000, top: 10, left: 10, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.92)", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  legendSwatch: { width: 16, height: 5, borderRadius: 3 },
  legendText: { fontSize: 12, color: INK, marginRight: 6 },
  card: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "white", borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingBottom: Platform.OS === "ios" ? 30 : 14, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 12, elevation: 12 },
  handleArea: { alignItems: "center", paddingTop: 8, paddingBottom: 6 },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: "#d4cccc" },
  timeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  time: { fontSize: 26, fontWeight: "700", color: MAROON },
  timeButtons: { flexDirection: "row", gap: 6 },
  small: { borderWidth: 1.5, borderColor: MAROON, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, minHeight: 34, justifyContent: "center" },
  smallActive: { backgroundColor: MAROON },
  smallText: { color: MAROON, fontWeight: "700", fontSize: 13 },
  pills: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 6 },
  pill: { backgroundColor: TINT, color: INK, fontSize: 12, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 10, overflow: "hidden" },
  ticks: { flexDirection: "row", justifyContent: "space-between", marginTop: -2, marginBottom: 6, paddingHorizontal: 4 },
  tick: { color: MUTED, fontSize: 12 },
  headline: { fontSize: 14, fontWeight: "600", color: INK, marginBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1.5, borderColor: LINE, marginBottom: 6, minHeight: 56 },
  rowActive: { borderColor: MAROON, backgroundColor: TINT },
  swatch: { width: 6, alignSelf: "stretch", borderRadius: 3 },
  swatchDashed: { opacity: 0.7 },
  rowTitle: { fontSize: 15, fontWeight: "600", color: INK },
  same: { fontSize: 12, fontWeight: "400", color: MUTED },
  rowMeta: { fontSize: 12, color: MUTED, marginTop: 1 },
  shade: { fontSize: 20, fontWeight: "700", color: INK },
  compare: { color: MAROON, fontWeight: "600", fontSize: 13, textAlign: "center", paddingVertical: 4 },
  handoff: { flexDirection: "row", gap: 8, marginTop: 8 },
  mapsButton: { flex: 1, borderRadius: 12, borderWidth: 1.5, borderColor: MAROON, paddingVertical: 11, alignItems: "center", minHeight: 44, justifyContent: "center" },
  mapsPrimary: { flex: 1.6, backgroundColor: MAROON },
  mapsPrimaryText: { color: "white", fontWeight: "700", fontSize: 14 },
  mapsText: { color: MAROON, fontWeight: "700", fontSize: 14 },
  error: { color: "#9a1b1b", fontSize: 14, marginVertical: 8, textAlign: "center" },
  offline: { marginTop: 6, fontSize: 12, color: "#9a5b00", textAlign: "center" },
});
