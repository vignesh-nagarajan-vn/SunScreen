import { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { API_BASE } from "./config";
import { currentPosition } from "./location";
import { INK, LINE, MAROON, MUTED, TINT } from "./theme";

const inBounds = (p, b) => p.lat >= b.south && p.lat <= b.north && p.lon >= b.west && p.lon <= b.east;

// Full-screen chooser for a route endpoint: campus places, address search, GPS, or a map tap.
export default function PlacePicker({ title, places, bounds, onSelect, onPickOnMap, onClose }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [status, setStatus] = useState("");

  const q = query.trim().toLowerCase();
  const matches = places.filter((p) => p.name.toLowerCase().includes(q));

  const searchAddresses = () => {
    setStatus("Searching…");
    fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query.trim())}`)
      .then((r) => r.json().then((json) => (r.ok ? json : Promise.reject(new Error(json.detail)))))
      .then(({ results }) => { setResults(results); setStatus(results.length ? "" : "No matches inside the campus area."); })
      .catch((e) => setStatus(e.message || "Search is unavailable right now."));
  };

  const useMyLocation = () => {
    setStatus("Finding you…");
    currentPosition()
      .then((p) => (inBounds(p, bounds) ? onSelect({ ...p, id: null, name: "My location" })
        : setStatus("You're outside the Texas A&M area SunScreen covers.")))
      .catch((e) => setStatus(e.message));
  };

  const rows = [
    ...matches.map((p) => ({ key: p.id, label: p.name, place: p })),
    ...(results ?? []).map((p, i) => ({ key: `s${i}`, label: p.name, hint: "Address search", place: { ...p, id: null } })),
  ];

  return (
    <View style={styles.sheet}>
      <View style={styles.top}>
        <Text style={styles.title}>{title}</Text>
        <Pressable onPress={onClose} hitSlop={12}><Text style={styles.close}>Cancel</Text></Pressable>
      </View>
      <TextInput
        style={styles.input} value={query} autoFocus placeholder="Search buildings or addresses"
        placeholderTextColor={MUTED} returnKeyType="search"
        onChangeText={(t) => { setQuery(t); setResults(null); setStatus(""); }}
        onSubmitEditing={() => q.length >= 2 && searchAddresses()}
      />
      <View style={styles.actions}>
        <Action label="My location" onPress={useMyLocation} />
        <Action label="Pick on map" onPress={onPickOnMap} />
        {q.length >= 2 && results === null && <Action label={`Search "${query.trim()}"`} onPress={searchAddresses} />}
      </View>
      {!!status && <Text style={styles.status}>{status}</Text>}
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => onSelect(item.place)}>
            <Text style={styles.rowText}>{item.label}</Text>
            {item.hint && <Text style={styles.hint}>{item.hint}</Text>}
          </Pressable>
        )}
      />
    </View>
  );
}

function Action({ label, onPress }) {
  return (
    <Pressable onPress={onPress} style={styles.action}>
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sheet: { ...StyleSheet.absoluteFillObject, backgroundColor: "white", paddingHorizontal: 16, paddingTop: 16, zIndex: 20 },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  title: { fontSize: 20, fontWeight: "700", color: MAROON },
  close: { fontSize: 15, color: MAROON },
  input: { borderWidth: 1.5, borderColor: LINE, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: INK },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 10 },
  action: { backgroundColor: TINT, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7 },
  actionText: { color: MAROON, fontWeight: "600", fontSize: 13 },
  status: { color: MUTED, marginBottom: 6 },
  row: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: LINE },
  rowText: { fontSize: 16, color: INK },
  hint: { fontSize: 12, color: MUTED, marginTop: 2 },
});
