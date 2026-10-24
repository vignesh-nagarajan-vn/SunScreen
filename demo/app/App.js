import { useEffect, useState } from "react";
import { SafeAreaView, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import Slider from "@react-native-community/slider";
import { API_BASE } from "./config";
import fallback from "./fallback.json";

const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const toLatLng = (f) => f.geometry.coordinates.map(([longitude, latitude]) => ({ latitude, longitude }));

export default function App() {
  const [minutes, setMinutes] = useState(14 * 60);
  const [alpha, setAlpha] = useState(1);
  const [data, setData] = useState(fallback["14:00"]);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    fetch(`${API_BASE}/route?time=${hhmm(minutes)}&alpha=${alpha}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((json) => { setData(json); setOffline(false); })
      .catch(() => { setData(fallback[hhmm(minutes)] ?? fallback["14:00"]); setOffline(true); })
      .finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [minutes, alpha]);

  const [fastest, shadiest] = data.features;
  const { start, end } = data;

  return (
    <View style={styles.container}>
      <MapView
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: (start.lat + end.lat) / 2,
          longitude: (start.lon + end.lon) / 2,
          latitudeDelta: Math.abs(start.lat - end.lat) * 2.5 + 0.002,
          longitudeDelta: Math.abs(start.lon - end.lon) * 2.5 + 0.002,
        }}
      >
        <Polyline coordinates={toLatLng(fastest)} strokeColor="#808080" strokeWidth={6} />
        <Polyline coordinates={toLatLng(shadiest)} strokeColor="#1e9e4a" strokeWidth={4} />
        <Marker coordinate={{ latitude: start.lat, longitude: start.lon }} title="The Commons" pinColor="#500000" />
        <Marker coordinate={{ latitude: end.lat, longitude: end.lon }} title="Zachry" pinColor="#1e9e4a" />
      </MapView>

      <SafeAreaView style={styles.card}>
        <Text style={styles.title}>{data.time} · {data.summary}</Text>
        {offline && <Text style={styles.offline}>API unreachable: showing bundled fallback (shade priority 1)</Text>}
        <Stat color="#808080" label="Fastest" p={fastest.properties} />
        <Stat color="#1e9e4a" label="Shadiest" p={shadiest.properties} />

        <Text style={styles.label}>Time {hhmm(minutes)}</Text>
        <Slider minimumValue={7 * 60} maximumValue={20 * 60} step={30} value={minutes} onSlidingComplete={setMinutes} />
        <Text style={styles.label}>Shade priority {alpha.toFixed(1)}</Text>
        <Slider minimumValue={0} maximumValue={1} step={0.1} value={alpha} onSlidingComplete={(v) => setAlpha(Math.round(v * 10) / 10)} />
      </SafeAreaView>
    </View>
  );
}

function Stat({ color, label, p }) {
  return (
    <View style={styles.row}>
      <View style={[styles.swatch, { backgroundColor: color }]} />
      <Text style={styles.stat}>
        {label}: {p.time_min} min · {p.distance_m} m · {p.shaded_pct}% shaded
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  card: { position: "absolute", left: 12, right: 12, bottom: 24, backgroundColor: "white", borderRadius: 12, padding: 14, elevation: 4, shadowOpacity: 0.2, shadowRadius: 6 },
  title: { fontSize: 16, fontWeight: "600", marginBottom: 6 },
  offline: { color: "#b35c00", marginBottom: 6 },
  row: { flexDirection: "row", alignItems: "center", marginVertical: 2 },
  swatch: { width: 14, height: 4, borderRadius: 2, marginRight: 8 },
  stat: { fontSize: 14 },
  label: { marginTop: 8, color: "#444" },
});
