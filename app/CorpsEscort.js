import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { open } from "./openInMaps";
import { useThemedStyles } from "./ThemeContext";

// Number and service hours: https://www.tamu.edu/campus-community/campus-safety.html
const PHONE = "979-845-6789";
const CALL_URL = "tel:+19798456789";

export default function CorpsEscort() {
  const styles = useThemedStyles(createStyles);
  const [error, setError] = useState(false);
  const call = () => {
    setError(false);
    open(CALL_URL).catch(() => setError(true));
  };
  return <View style={styles.section}>
    <Pressable style={styles.button} accessibilityRole="link"
      accessibilityLabel={`Call Texas A&M Corps escort at ${PHONE}`}
      accessibilityHint="Opens your phone app to request a campus walking escort"
      {...(Platform.OS === "web" ? { href: CALL_URL } : { onPress: call })}>
      <Text style={styles.title}>Call Corps escort</Text>
      <Text style={styles.number}>{PHONE}</Text>
    </Pressable>
    <Text style={styles.hours}>Weekdays 6 p.m.–7 a.m. · Weekends all day{"\n"}Fall and spring semesters</Text>
    {error && <Text style={styles.error} accessibilityLiveRegion="polite">Couldn’t open your phone app. Call {PHONE} directly.</Text>}
  </View>;
}

const createStyles = ({ MAROON, onAccent, MUTED, error }) => StyleSheet.create({
  section: { marginTop: 4, marginBottom: 12 },
  button: { backgroundColor: MAROON, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 48,
    flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 6 },
  title: { color: onAccent, fontSize: 15, fontWeight: "700" },
  number: { color: onAccent, fontSize: 14, fontWeight: "600" },
  hours: { color: MUTED, fontSize: 12, lineHeight: 18, marginTop: 6 },
  error: { color: error, fontSize: 13, marginTop: 6 },
});
