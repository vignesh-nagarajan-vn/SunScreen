import { useState } from "react";
import { Pressable, SectionList, StyleSheet, Text, TextInput, View } from "react-native";
import { API_BASE } from "./config";
import { currentPosition } from "./location";
import { useTheme, useThemedStyles } from "./ThemeContext";

const CATEGORIES = ["Academic", "Libraries", "Dining", "Student life", "Athletics", "Landmarks", "Parks & neighborhoods"];
const ICONS = {
  Recent: "🕘", Academic: "🎓", Libraries: "📚", Dining: "🍽️", "Student life": "⭐", Athletics: "🏟️",
  Landmarks: "📍", "Parks & neighborhoods": "🌳", Search: "🔎",
};
const inBounds = (p, b) => p.lat >= b.south && p.lat <= b.north && p.lon >= b.west && p.lon <= b.east;
function distance(a, b) {
  const m = Math.hypot((b.lon - a.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180), (b.lat - a.lat) * 110_540);
  return m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}

// Full-screen chooser for a route endpoint: grouped campus places, recents, address search, GPS, or a map tap.
export default function PlacePicker({ title, places, bounds, recents, here, onLocated, onSelect, onPickOnMap, onClose }) {
  const styles = useThemedStyles(createStyles);
  const { colors: { MUTED } } = useTheme();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [status, setStatus] = useState("");

  const q = query.trim().toLowerCase();
  const sections = q
    ? [
        { title: "Campus places", data: places.filter((p) => p.name.toLowerCase().includes(q)) },
        { title: "Search", data: (results ?? []).map((p) => ({ ...p, id: null, category: "Search" })) },
      ]
    : [
        { title: "Recent", data: recents },
        ...CATEGORIES.map((c) => ({ title: c, data: places.filter((p) => p.category === c) })),
      ];

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
      .then((p) => {
        onLocated(p);
        if (inBounds(p, bounds)) onSelect({ ...p, id: null, name: "My location" });
        else setStatus("You're outside the Texas A&M area SunScreen covers.");
      })
      .catch((e) => setStatus(e.message));
  };

  return (
    <View style={styles.sheet} accessibilityViewIsModal>
      <View style={styles.top}>
        <Text style={styles.title} accessibilityRole="header">{title}</Text>
        <Pressable onPress={onClose} hitSlop={12} style={styles.closeButton} accessibilityRole="button">
          <Text style={styles.close}>Cancel</Text>
        </Pressable>
      </View>
      <TextInput
        style={styles.input} value={query} autoFocus placeholder="Search buildings or addresses"
        placeholderTextColor={MUTED} returnKeyType="search" accessibilityLabel="Search buildings or addresses"
        onChangeText={(t) => { setQuery(t); setResults(null); setStatus(""); }}
        onSubmitEditing={() => q.length >= 2 && searchAddresses()}
      />
      <View style={styles.actions}>
        <Action label="📍 My location" onPress={useMyLocation} />
        <Action label="🗺️ Pick on map" onPress={onPickOnMap} />
        {q.length >= 2 && results === null && <Action label={`🔎 Search "${query.trim()}"`} onPress={searchAddresses} />}
      </View>
      {!!status && <Text style={styles.status} accessibilityLiveRegion="polite">{status}</Text>}
      <SectionList
        sections={sections.filter((s) => s.data.length)}
        keyExtractor={(p, i) => `${p.id ?? p.name}-${i}`}
        keyboardShouldPersistTaps="handled"
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title}</Text>}
        renderItem={({ item, section }) => (
          <Pressable style={styles.row} onPress={() => onSelect(item)} accessibilityRole="button">
            <Text style={styles.icon}>{ICONS[section.title === "Recent" ? "Recent" : item.category] ?? "📍"}</Text>
            <Text style={styles.rowText} numberOfLines={1}>{item.name}</Text>
            {here && <Text style={styles.distance}>{distance(here, item)}</Text>}
          </Pressable>
        )}
      />
    </View>
  );
}

function Action({ label, onPress }) {
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable onPress={onPress} style={styles.action} accessibilityRole="button">
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

const createStyles = ({ INK, LINE, MAROON, MUTED, SUN, TINT, surface, header, onAccent, track, handle, skeleton, error, warning, overlay }) => StyleSheet.create({
  sheet: { ...StyleSheet.absoluteFillObject, backgroundColor: surface, paddingHorizontal: 16, paddingTop: 16, zIndex: 2000 },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  title: { fontSize: 20, fontWeight: "700", color: MAROON },
  closeButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 4 },
  close: { fontSize: 15, color: MAROON, fontWeight: "600" },
  input: { borderWidth: 1.5, borderColor: LINE, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, fontSize: 16, color: INK },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 10 },
  action: { backgroundColor: TINT, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8, minHeight: 36, justifyContent: "center" },
  actionText: { color: MAROON, fontWeight: "600", fontSize: 13 },
  status: { color: MUTED, marginBottom: 6 },
  section: { fontSize: 12, fontWeight: "700", color: MUTED, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 14, marginBottom: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48, borderBottomWidth: 1, borderBottomColor: LINE },
  icon: { fontSize: 18, width: 26, textAlign: "center" },
  rowText: { flex: 1, fontSize: 16, color: INK },
  distance: { fontSize: 13, color: MUTED },
});
