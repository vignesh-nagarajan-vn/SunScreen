import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Platform, Pressable, StatusBar, StyleSheet, Text, View } from "react-native";
import Slider from "@react-native-community/slider";
import RouteMap from "./RouteMap";
import PlacePicker from "./PlacePicker";
import { API_BASE } from "./config";
import { appleMapsUrl, googleMapsUrl, open } from "./openInMaps";
import { INK, LINE, MAROON, MUTED, ROUTES, TINT } from "./theme";
import fallback from "./fallback.json";
import area from "./places.json";

const FIRST = 7 * 60, LAST = 20 * 60;
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const clock = (min) => `${((Math.floor(min / 60) + 11) % 12) + 1}:${String(min % 60).padStart(2, "0")} ${min < 720 ? "AM" : "PM"}`;
const byId = Object.fromEntries(area.places.map((p) => [p.id, p]));
const param = (p) => p.id ?? `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
const inBounds = (p, b) => p.lat >= b.south && p.lat <= b.north && p.lon >= b.west && p.lon <= b.east;

// Start at the current time; on web, ?from=&to=&time=HH:MM&route= preselect a trip.
const params = Platform.OS === "web" ? new URLSearchParams(window.location.search) : new URLSearchParams();
const now = new Date();
const timeParam = params.get("time")?.split(":").map(Number);
const initialMin = Math.min(LAST, Math.max(FIRST, Math.round(
  (timeParam ? timeParam[0] * 60 + timeParam[1] : now.getHours() * 60 + now.getMinutes()) / 30) * 30));

function weatherText({ weather, sun }) {
  if (weather.source === "sun down") return "Sun is down";
  const up = `Sun ${Math.round(sun.altitude)}° up`;
  if (weather.cloud_cover_pct == null) return `${up} · weather unavailable, assuming clear sky`;
  const c = weather.cloud_cover_pct;
  const sky = c < 10 ? "Clear" : c < 40 ? "Mostly sunny" : c < 70 ? "Partly cloudy" : "Overcast";
  return `${up} · ${sky}, ${c}% clouds · sunlight ${weather.sun_strength_pct}%`;
}

export default function App() {
  const [from, setFrom] = useState(byId[params.get("from")] ?? byId[area.default[0]]);
  const [to, setTo] = useState(byId[params.get("to")] ?? byId[area.default[1]]);
  const [minutes, setMinutes] = useState(initialMin);
  const [preview, setPreview] = useState(initialMin);
  const [selected, setSelected] = useState(params.get("route") ?? "recommended");
  const [data, setData] = useState(null);
  const [status, setStatus] = useState({ loading: true });
  const [picker, setPicker] = useState(null); // "from" | "to" while choosing an endpoint
  const [picking, setPicking] = useState(null); // "from" | "to" while waiting for a map tap
  const [cardHeight, setCardHeight] = useState(360);

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
        if (r.ok) { setData(json); setStatus({}); } else setStatus({ error: json.detail }); // e.g. "outside the area"
      })
      .catch(() => {
        if (cancelled) return;
        // Server unreachable: the default trip has bundled routes, anything else can't be routed offline.
        if (from.id === area.default[0] && to.id === area.default[1]) {
          setData(fallback[hhmm(minutes)]);
          setStatus({ offline: true });
        } else setStatus({ error: "Can't reach the SunScreen server. Check your connection and try again." });
      })
      .finally(() => clearTimeout(timer));
    return () => { cancelled = true; clearTimeout(timer); ctrl.abort(); };
  }, [minutes, from, to]);

  const choose = (which, place) => {
    (which === "from" ? setFrom : setTo)(place);
    setPicker(null);
    setPicking(null);
  };
  const onMapPress = (p) => {
    if (!inBounds(p, area.bounds)) return;
    choose(picking, { ...p, id: null, name: "Dropped pin" });
  };
  const swap = () => { setFrom(to); setTo(from); };
  const showRoutes = data && !status.error;

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" backgroundColor={MAROON} />
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

      {/* The map ends where the card starts (minus its rounded corner), so fits and limits use what is visible. */}
      <View style={[styles.map, { marginBottom: picking ? 0 : cardHeight - 20 }]}>
        <RouteMap
          data={showRoutes ? data : null} selected={selected}
          bounds={area.bounds} picking={!!picking} onMapPress={onMapPress}
        />
        {picking && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>Tap the map to set your {picking === "from" ? "start" : "destination"}</Text>
            <Pressable onPress={() => setPicking(null)} hitSlop={8}><Text style={styles.bannerCancel}>Cancel</Text></Pressable>
          </View>
        )}
      </View>

      {!picking && (
        <View style={styles.card} onLayout={(e) => setCardHeight(e.nativeEvent.layout.height)}>
          <View style={styles.timeRow}>
            <Text style={styles.time}>{clock(preview)}</Text>
            {data && <Text style={styles.weather} numberOfLines={2}>{weatherText(data)}</Text>}
            {status.loading && <ActivityIndicator color={MAROON} />}
          </View>
          <Slider
            minimumValue={FIRST} maximumValue={LAST} step={30} value={minutes}
            onValueChange={setPreview} onSlidingComplete={setMinutes}
            minimumTrackTintColor={MAROON} maximumTrackTintColor="#d9cfcf" thumbTintColor={MAROON}
          />
          <View style={styles.ticks}>
            {["7 AM", "11 AM", "3 PM", "8 PM"].map((t) => <Text key={t} style={styles.tick}>{t}</Text>)}
          </View>

          {status.error && <Text style={styles.error}>{status.error}</Text>}
          {showRoutes && data.features.map(({ properties: p }) => (
            <RouteRow key={p.id} p={p} active={p.id === selected} onPress={() => setSelected(p.id)} />
          ))}
          {showRoutes && <Text style={styles.summary}>{data.summary}</Text>}
          {showRoutes && <Handoff data={data} selected={selected} />}
          {status.offline && <Text style={styles.offline}>Offline: showing saved routes for The Commons → Zachry</Text>}
        </View>
      )}

      {picker && (
        <PlacePicker
          title={picker === "from" ? "Start" : "Destination"} places={area.places} bounds={area.bounds}
          onSelect={(p) => choose(picker, p)} onClose={() => setPicker(null)}
          onPickOnMap={() => { setPicking(picker); setPicker(null); }}
        />
      )}
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
  const extra = p.extra_s <= 0 ? "" : p.extra_s < 60 ? ` · +${p.extra_s} s` : ` · +${(p.extra_s / 60).toFixed(1)} min`;
  return (
    <Pressable onPress={onPress} style={[styles.row, active && styles.rowActive]}>
      <View style={[styles.swatch, { backgroundColor: ROUTES[p.id].color }]} />
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
  endpoint: { flexDirection: "row", alignItems: "center", paddingVertical: 9, gap: 10 },
  endpointLabel: { width: 36, color: MUTED, fontSize: 12, fontWeight: "600" },
  endpointName: { flex: 1, color: INK, fontSize: 15, fontWeight: "600" },
  swap: { width: 44, alignSelf: "stretch", alignItems: "center", justifyContent: "center" },
  swapText: { color: MAROON, fontSize: 22, fontWeight: "700" },
  map: { flex: 1 },
  banner: { position: "absolute", top: 12, left: 12, right: 12, backgroundColor: MAROON, borderRadius: 12, padding: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  bannerText: { color: "white", fontWeight: "600", flex: 1 },
  bannerCancel: { color: "#f1dede", fontWeight: "600", marginLeft: 12 },
  card: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "white", borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingTop: 14, paddingBottom: Platform.OS === "ios" ? 30 : 16, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 12, elevation: 12 },
  timeRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  time: { fontSize: 26, fontWeight: "700", color: MAROON, minWidth: 108 },
  weather: { flex: 1, color: MUTED, fontSize: 13, lineHeight: 17 },
  ticks: { flexDirection: "row", justifyContent: "space-between", marginTop: -2, marginBottom: 8, paddingHorizontal: 4 },
  tick: { color: MUTED, fontSize: 11 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1.5, borderColor: LINE, marginBottom: 6 },
  rowActive: { borderColor: MAROON, backgroundColor: TINT },
  swatch: { width: 6, alignSelf: "stretch", borderRadius: 3 },
  rowTitle: { fontSize: 15, fontWeight: "600", color: INK },
  same: { fontSize: 12, fontWeight: "400", color: MUTED },
  rowMeta: { fontSize: 12, color: MUTED, marginTop: 1 },
  shade: { fontSize: 20, fontWeight: "700", color: INK },
  summary: { marginTop: 4, fontSize: 13, color: INK, textAlign: "center" },
  handoff: { flexDirection: "row", gap: 8, marginTop: 10 },
  mapsButton: { flex: 1, borderRadius: 12, borderWidth: 1.5, borderColor: MAROON, paddingVertical: 10, alignItems: "center" },
  mapsPrimary: { flex: 1.6, backgroundColor: MAROON },
  mapsPrimaryText: { color: "white", fontWeight: "700", fontSize: 14 },
  mapsText: { color: MAROON, fontWeight: "700", fontSize: 14 },
  error: { color: "#9a1b1b", fontSize: 14, marginVertical: 8, textAlign: "center" },
  offline: { marginTop: 4, fontSize: 12, color: "#9a5b00", textAlign: "center" },
});
