import { useEffect, useState } from "react";
import { Image, Platform, Pressable, StatusBar, StyleSheet, Text, View } from "react-native";
import Slider from "@react-native-community/slider";
import RouteMap from "./RouteMap";
import { API_BASE } from "./config";
import { INK, LINE, MAROON, MUTED, ROUTES, TINT } from "./theme";
import fallback from "./fallback.json";

const FIRST = 7 * 60, LAST = 20 * 60;
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const clock = (min) => `${((Math.floor(min / 60) + 11) % 12) + 1}:${String(min % 60).padStart(2, "0")} ${min < 720 ? "AM" : "PM"}`;

// Start at the current time (or ?time=HH:MM&route=id on web), snapped to a 30-min slot.
const params = Platform.OS === "web" ? new URLSearchParams(window.location.search) : new URLSearchParams();
const now = new Date();
const fromParam = params.get("time")?.split(":").map(Number);
const initialMin = Math.min(LAST, Math.max(FIRST, Math.round(
  (fromParam ? fromParam[0] * 60 + fromParam[1] : now.getHours() * 60 + now.getMinutes()) / 30) * 30));

function weatherText({ weather, sun }) {
  if (weather.source === "sun down") return "Sun is down";
  const up = `Sun ${Math.round(sun.altitude)}° up`;
  if (weather.cloud_cover_pct == null) return `${up} · weather unavailable, assuming clear sky`;
  const c = weather.cloud_cover_pct;
  const sky = c < 10 ? "Clear" : c < 40 ? "Mostly sunny" : c < 70 ? "Partly cloudy" : "Overcast";
  return `${up} · ${sky}, ${c}% clouds · sunlight ${weather.sun_strength_pct}%`;
}

export default function App() {
  const [minutes, setMinutes] = useState(initialMin);
  const [preview, setPreview] = useState(initialMin);
  const [selected, setSelected] = useState(params.get("route") ?? "recommended");
  const [data, setData] = useState(fallback[hhmm(initialMin)]);
  const [offline, setOffline] = useState(false);
  const [cardHeight, setCardHeight] = useState(360);

  useEffect(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    fetch(`${API_BASE}/route?time=${hhmm(minutes)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((json) => { setData(json); setOffline(false); })
      .catch(() => { setData(fallback[hhmm(minutes)]); setOffline(true); })
      .finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [minutes]);

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" backgroundColor={MAROON} />
      <View style={styles.header}>
        <Image source={require("./assets/logo.png")} style={styles.logo} />
        <View>
          <Text style={styles.brand}>Howdy Shade</Text>
          <Text style={styles.trip}>The Commons → Zachry</Text>
        </View>
      </View>

      <View style={styles.map}>
        <RouteMap data={data} selected={selected} bottomInset={cardHeight} />
      </View>

      <View style={styles.card} onLayout={(e) => setCardHeight(e.nativeEvent.layout.height)}>
        <View style={styles.timeRow}>
          <Text style={styles.time}>{clock(preview)}</Text>
          <Text style={styles.weather} numberOfLines={2}>{weatherText(data)}</Text>
        </View>
        <Slider
          minimumValue={FIRST} maximumValue={LAST} step={30} value={minutes}
          onValueChange={setPreview} onSlidingComplete={setMinutes}
          minimumTrackTintColor={MAROON} maximumTrackTintColor="#d9cfcf" thumbTintColor={MAROON}
        />
        <View style={styles.ticks}>
          {["7 AM", "11 AM", "3 PM", "8 PM"].map((t) => <Text key={t} style={styles.tick}>{t}</Text>)}
        </View>

        {data.features.map(({ properties: p }) => (
          <RouteRow key={p.id} p={p} active={p.id === selected} onPress={() => setSelected(p.id)} />
        ))}

        <Text style={styles.summary}>{data.summary}</Text>
        {offline && <Text style={styles.offline}>Offline: showing saved routes for {data.date}</Text>}
      </View>
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
          {p.id !== "fastest" && p.same_as_fastest && <Text style={styles.same}>  same as fastest</Text>}
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
  header: { backgroundColor: MAROON, paddingTop: topInset, paddingBottom: 12, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 10 },
  logo: { width: 34, height: 34 },
  brand: { color: "white", fontSize: 20, fontWeight: "700", letterSpacing: 0.3 },
  trip: { color: "#f1dede", fontSize: 13 },
  map: { flex: 1 },
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
  offline: { marginTop: 4, fontSize: 12, color: "#9a5b00", textAlign: "center" },
});
