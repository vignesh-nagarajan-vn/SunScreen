import { useEffect } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { PLACE_KINDS } from "./mapPlaces";
import { useThemedStyles } from "./ThemeContext";

export default function PlaceDetails({ place, from, to, onChoose, onClose }) {
  const styles = useThemedStyles(createStyles);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const escape = e => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose]);
  const isFrom = from.id === place.id, isTo = to.id === place.id;
  return <View accessibilityLabel="Place details" style={styles.details}>
    <View style={styles.header}>
      <View style={{ flex: 1 }}>
        <Text style={styles.meta}>{PLACE_KINDS[place.kind].symbol}  {place.kind === "cafe" ? "Café" : place.category}{place.building_code ? ` · ${place.building_code}` : ""}</Text>
        <Text accessibilityRole="header" style={styles.title}>{place.name}</Text>
      </View>
      <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close place details" style={styles.close}>
        <Text style={styles.closeText}>×</Text>
      </Pressable>
    </View>
    {!!place.detail && <Text style={styles.description}>{place.detail}</Text>}
    {(isFrom || isTo) && <Text style={styles.meta}>Your current {isFrom ? "start" : "destination"}</Text>}
    <View style={styles.actions}>
      <Pressable disabled={isTo} onPress={() => onChoose("from", place)} accessibilityRole="button"
        accessibilityLabel="Start here" accessibilityState={{ disabled: isTo }}
        style={[styles.button, isTo && styles.disabled]}>
        <Text style={styles.buttonText}>Start here</Text>
      </Pressable>
      <Pressable disabled={isFrom} onPress={() => onChoose("to", place)} accessibilityRole="button"
        accessibilityLabel="Directions" accessibilityState={{ disabled: isFrom }}
        style={[styles.button, styles.primary, isFrom && styles.disabled]}>
        <Text style={styles.primaryText}>Directions</Text>
      </Pressable>
    </View>
    <Pressable onPress={onClose} accessibilityRole="button" style={styles.back}>
      <Text style={styles.backText}>Back to routes</Text>
    </Pressable>
  </View>;
}

const createStyles = ({ INK, MUTED, MAROON, LINE, onAccent }) => StyleSheet.create({
  details: { paddingTop: 12, gap: 9 },
  header: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  title: { color: INK, fontSize: 19, fontWeight: "700", marginTop: 4 },
  meta: { color: MUTED, fontSize: 12 },
  description: { color: INK, fontSize: 13, lineHeight: 18 },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: LINE, borderRadius: 12 },
  closeText: { color: INK, fontSize: 25 },
  actions: { flexDirection: "row", gap: 10, marginTop: 3 },
  button: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 12, borderWidth: 1.5, borderColor: MAROON },
  primary: { backgroundColor: MAROON },
  buttonText: { color: MAROON, fontSize: 14, fontWeight: "700" },
  primaryText: { color: onAccent, fontSize: 14, fontWeight: "700" },
  disabled: { opacity: 0.45 },
  back: { minHeight: 36, justifyContent: "center", alignItems: "center" },
  backText: { color: MAROON, fontSize: 13, fontWeight: "600" },
});
