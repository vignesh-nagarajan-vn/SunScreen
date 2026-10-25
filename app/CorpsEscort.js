import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { open } from "./openInMaps";
import Icon from "./Icon";
import { useTheme, useThemedStyles } from "./ThemeContext";

// Number and service hours: https://www.tamu.edu/campus-community/campus-safety.html
const PHONE = "979-845-6789";
const CALL_URL = "tel:+19798456789";

export default function CorpsEscort() {
  const styles = useThemedStyles(createStyles);
  const { colors: { onAccent } } = useTheme();
  const [error, setError] = useState(false);
  const call = () => {
    setError(false);
    open(CALL_URL).catch(() => setError(true));
  };
  return <View>
    <Pressable style={styles.card} accessibilityRole="link"
      accessibilityLabel={`Call Texas A&M Corps escort at ${PHONE}`}
      accessibilityHint="Opens your phone app to request a campus walking escort"
      {...(Platform.OS === "web" ? { href: CALL_URL } : { onPress: call })}>
      <View style={styles.icon}><Icon name="phone" size={17} color={onAccent} /></View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Call Corps escort</Text>
          <Text style={styles.number}>{PHONE}</Text>
        </View>
        <Text style={styles.hours}>Weekdays 6 p.m.–7 a.m. · Weekends all day · Fall and spring semesters</Text>
      </View>
    </Pressable>
    {error && <Text style={styles.error} accessibilityLiveRegion="polite">Couldn’t open your phone app. Call {PHONE} directly.</Text>}
  </View>;
}

const createStyles = ({ INK, MAROON, MUTED, chip, error }) => StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 14, backgroundColor: chip, minHeight: 48 },
  icon: { width: 36, height: 36, borderRadius: 18, backgroundColor: MAROON, alignItems: "center", justifyContent: "center" },
  titleRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", columnGap: 8 },
  title: { color: INK, fontSize: 15, fontWeight: "700" },
  number: { color: MAROON, fontSize: 15, fontWeight: "700" },
  hours: { color: MUTED, fontSize: 12, lineHeight: 17 },
  error: { color: error, fontSize: 13, marginTop: 6 },
});
