import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, SectionList, StyleSheet, Text, TextInput, View } from "react-native";
import { API_BASE } from "./config";
import Icon from "./Icon";
import { currentPosition } from "./location";
import { useTheme, useThemedStyles } from "./ThemeContext";
import { exactPlace, isRoomQuery, searchPlaces } from "./placeSearch";

const CATEGORIES = ["Academic", "Rooms", "Residence halls", "Dining", "Libraries", "Health & services", "Student life", "Athletics", "Landmarks", "Parks & neighborhoods", "Campus facilities"];
const ICONS = {
  Recent: "clock", Academic: "cap", Libraries: "book", Dining: "dining", "Student life": "star", Athletics: "stadium",
  Landmarks: "landmark", "Parks & neighborhoods": "tree", Search: "pin",
  "Residence halls": "home", "Health & services": "health", "Campus facilities": "building",
  Rooms: "building",
};
const inBounds = (p, b) => p.lat >= b.south && p.lat <= b.north && p.lon >= b.west && p.lon <= b.east;
function distance(a, b) {
  const m = Math.hypot((b.lon - a.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180), (b.lat - a.lat) * 110_540);
  return m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}

// Full-screen chooser for a route endpoint: grouped campus places, recents, address search, GPS, or a map tap.
export default function PlacePicker({ title, current, places, bounds, recents, here, onLocated, onSelect, onPickOnMap, onClose }) {
  const styles = useThemedStyles(createStyles);
  const { colors: { INK, MAROON, MUTED, onAccent } } = useTheme();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState(null); // null shows every group
  const request = useRef({ sequence: 0, controller: null });
  useEffect(() => () => { request.current.sequence++; request.current.controller?.abort(); }, []);

  const q = query.trim().toLowerCase();
  const campusMatches = useMemo(() => searchPlaces(places, q), [places, q]);
  const sections = q
    ? [
        { title: "Campus places", data: campusMatches },
        { title: "Search", data: (results ?? []).filter(p => !campusMatches.some(local => local.id && local.id === p.id))
          .map((p) => ({ ...p, id: p.id ?? null, category: p.category ?? "Search" })) },
      ]
    : [
        ...(category ? [] : [{ title: "Recent", data: recents }]),
        ...CATEGORIES.filter((c) => !category || c === category)
          .map((c) => ({ title: c, data: places.filter((p) => p.category === c).sort((a, b) => a.name.localeCompare(b.name)) })),
      ];

  const searchAddresses = () => {
    const sequence = ++request.current.sequence;
    request.current.controller?.abort();
    const controller = new AbortController();
    request.current.controller = controller;
    const timer = setTimeout(() => controller.abort(), 8000);
    setStatus("Searching…");
    fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal })
      .then((r) => r.json().then((json) => (r.ok ? json : Promise.reject(new Error(json.detail)))))
      .then(({ results }) => {
        if (sequence !== request.current.sequence) return;
        if (!Array.isArray(results)) throw new Error("Search is unavailable right now.");
        const bounded = results.filter(p => typeof p.name === "string" && p.name.trim()
          && Number.isFinite(p.lat) && Number.isFinite(p.lon) && inBounds(p, bounds));
        setResults(bounded); setStatus(bounded.length ? "" : "No matches inside the campus area.");
      })
      .catch((e) => {
        if (sequence === request.current.sequence) setStatus(e.name === "AbortError" ? "Address search timed out. Try again." : e.message || "Search is unavailable right now.");
      })
      .finally(() => clearTimeout(timer));
  };

  const changeQuery = value => {
    request.current.sequence++;
    request.current.controller?.abort();
    setQuery(value); setResults(null); setStatus("");
  };
  const submit = () => {
    if (q.length < 2) return;
    const exact = exactPlace(places, q);
    if (exact || campusMatches.length === 1) onSelect(exact ?? campusMatches[0]);
    else if (campusMatches.length) setStatus("Choose a campus place below.");
    else if (isRoomQuery(q)) setStatus("Indoor directions aren't mapped for this room yet. Search the building name for an outdoor route.");
    else searchAddresses();
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
        <Pressable onPress={onClose} hitSlop={8} style={styles.closeButton} accessibilityRole="button" accessibilityLabel="Close">
          <Icon name="close" size={18} color={INK} strokeWidth={2.4} />
        </Pressable>
      </View>
      <View style={styles.search}>
        <Icon name="search" size={18} color={MUTED} strokeWidth={2.2} />
        <TextInput
          style={styles.input} value={query} autoFocus placeholder="Building, room (Zach 596) or address"
          placeholderTextColor={MUTED} returnKeyType="search" accessibilityLabel="Search buildings or addresses"
          onChangeText={changeQuery}
          onSubmitEditing={submit}
        />
      </View>
      <View style={styles.actions}>
        <Action icon="locate" label="My location" onPress={useMyLocation} />
        <Action icon="pin" label="Pick on map" onPress={onPickOnMap} />
      </View>
      {q.length >= 2 && !campusMatches.length && !isRoomQuery(q) && results === null &&
        <Action icon="search" label={`Search addresses for "${query.trim()}"`} onPress={searchAddresses} />}
      {!q && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chips}>
          {[null, ...CATEGORIES].map((c) => {
            const active = c === category;
            return (
              <Pressable key={c ?? "All"} onPress={() => setCategory(c)} style={[styles.chip, active && styles.chipActive]}
                accessibilityRole="button" accessibilityState={{ selected: active }}>
                <Text style={[styles.chipText, active && { color: onAccent }]}>{c ?? "All"}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
      {!!status && <Text style={styles.status} accessibilityLiveRegion="polite">{status}</Text>}
      <SectionList
        sections={sections.filter((s) => s.data.length)}
        keyExtractor={(p, i) => `${p.id ?? p.name}-${i}`}
        keyboardShouldPersistTaps="handled"
        stickySectionHeadersEnabled={false}
        ListEmptyComponent={q && !status && results === null ? <Text style={styles.status}>No saved campus matches. Search addresses or pick on the map.</Text> : null}
        renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title}</Text>}
        renderItem={({ item, section }) => {
          const recent = section.title === "Recent";
          const chosen = !recent && current?.name === item.name;
          const code = item.building_code || (item.building_number && `Building ${item.building_number}`);
          const meta = [code, item.floor && `Level ${item.floor}`, item.category !== "Search" && item.category].filter(Boolean).join(" · ");
          return (
            <Pressable style={[styles.row, chosen && styles.rowChosen]} onPress={() => onSelect(item)} accessibilityRole="button"
              accessibilityState={{ selected: chosen }}
              accessibilityLabel={`${item.name}${item.building_code ? ` (${item.building_code})` : item.building_number ? ` (Building ${item.building_number})` : ""}`}>
              <View style={[styles.tile, recent && styles.tileRecent, chosen && { backgroundColor: MAROON }]}>
                <Icon name={ICONS[recent ? "Recent" : item.category] ?? "pin"} size={18}
                  color={chosen ? onAccent : recent ? MUTED : MAROON} strokeWidth={2.1} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.rowText} numberOfLines={1}>{item.name}</Text>
                {!!meta && <Text style={styles.meta} numberOfLines={1}>{meta}</Text>}
              </View>
              {here && <Text style={styles.distance}>{distance(here, item)}</Text>}
              {chosen && <Icon name="check" size={20} color={MAROON} strokeWidth={2.6} />}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

function Action({ icon, label, onPress }) {
  const styles = useThemedStyles(createStyles);
  const { colors: { MAROON } } = useTheme();
  return (
    <Pressable onPress={onPress} style={styles.action} accessibilityRole="button">
      <Icon name={icon} size={17} color={MAROON} strokeWidth={2.2} />
      <Text style={styles.actionText} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const createStyles = ({ INK, LINE, MAROON, MUTED, TINT, surface, chip, divider }) => StyleSheet.create({
  sheet: { ...StyleSheet.absoluteFillObject, backgroundColor: surface, paddingHorizontal: 20, paddingTop: 16, zIndex: 2000 },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  title: { fontSize: 22, fontWeight: "800", color: INK, letterSpacing: -0.3 },
  closeButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: chip, alignItems: "center", justifyContent: "center" },
  search: { flexDirection: "row", alignItems: "center", gap: 10, height: 50, paddingHorizontal: 14, borderWidth: 1.5, borderColor: MAROON, borderRadius: 14 },
  input: { flex: 1, minWidth: 0, alignSelf: "stretch", fontSize: 15, fontWeight: "500", color: INK, outlineStyle: "none" },
  actions: { flexDirection: "row", gap: 8, marginTop: 12, marginBottom: 8 },
  action: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 44, paddingHorizontal: 12,
    borderWidth: 1.5, borderColor: LINE, borderRadius: 12 },
  actionText: { flexShrink: 1, color: MAROON, fontWeight: "700", fontSize: 14 },
  chipScroll: { flexGrow: 0, flexShrink: 0, marginHorizontal: -20, marginTop: 4 },
  chips: { gap: 8, paddingHorizontal: 20 },
  chip: { height: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1.5, borderColor: LINE, justifyContent: "center" },
  chipActive: { backgroundColor: MAROON, borderColor: MAROON },
  chipText: { color: INK, fontSize: 13, fontWeight: "600" },
  status: { color: MUTED, marginTop: 8 },
  section: { fontSize: 12, fontWeight: "700", color: MUTED, textTransform: "uppercase", letterSpacing: 0.8, marginTop: 16, marginBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 64, borderBottomWidth: 1, borderBottomColor: divider },
  rowChosen: { backgroundColor: TINT, borderRadius: 14, borderBottomWidth: 0, marginHorizontal: -10, paddingHorizontal: 10 },
  tile: { width: 40, height: 40, borderRadius: 12, backgroundColor: TINT, alignItems: "center", justifyContent: "center" },
  tileRecent: { backgroundColor: chip },
  rowText: { fontSize: 15, fontWeight: "700", color: INK },
  meta: { fontSize: 12, fontWeight: "500", color: MUTED },
  distance: { fontSize: 13, color: MUTED },
});
