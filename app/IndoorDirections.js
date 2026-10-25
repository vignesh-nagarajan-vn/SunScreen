import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Icon from "./Icon";
import { open } from "./openInMaps";
import { useTheme, useThemedStyles } from "./ThemeContext";

export default function IndoorDirections({ from, to }) {
  const styles = useThemedStyles(createStyles);
  const { colors: { MAROON } } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const entries = [['from', from], ['to', to]].filter(([which, p]) => p?.indoor && (which === 'to' || from.id !== to.id));
  if (!entries.length) return null;
  return <View style={styles.card}>
    <Pressable style={styles.toggle} onPress={() => setExpanded(v => !v)} accessibilityRole="button"
      accessibilityLabel="Indoor directions" accessibilityState={{ expanded }}
      {...(Platform.OS === 'web' ? { 'aria-expanded': expanded } : {})}>
      <Icon name="building" size={18} color={MAROON} />
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{entries.map(([, p]) => `${p.indoor.building_name ?? p.name} · Room ${p.indoor.room} · Level ${p.indoor.floor}`).join(' → ')}</Text>
        <Text style={styles.meta}>{expanded ? 'Hide indoor directions · Outdoor ETA' : 'Outdoor ETA · Tap for indoor directions'}</Text>
      </View>
      <Text style={styles.arrow}>{expanded ? '−' : '+'}</Text>
    </Pressable>
    {expanded && entries.map(([which, p]) => <View key={`${which}-${p.id}`} style={styles.steps}>
      <Text style={styles.title}>{which === 'from' ? `Leaving ${p.name}` : `Inside ${p.name}`}</Text>
      {(which === 'from' ? p.indoor.departure_steps : p.indoor.arrival_steps).map((step, i) =>
        <Text key={step} style={styles.step}>{i + 1}. {step}</Text>)}
      <Text style={styles.meta}>{p.indoor.guidance_note}</Text>
      <Pressable onPress={() => open(`${p.indoor.sources[0].url}#page=${p.indoor.plan_page}`)} accessibilityRole="link" style={styles.link}>
        <Text style={styles.linkText}>Official floor plan · Level {p.indoor.floor} on page {p.indoor.plan_page}</Text>
      </Pressable>
    </View>)}
  </View>;
}

const createStyles = ({ INK, MUTED, MAROON, LINE, TINT }) => StyleSheet.create({
  card: { borderWidth: 1, borderColor: LINE, borderRadius: 12, backgroundColor: TINT },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, padding: 12 },
  title: { color: INK, fontSize: 13, fontWeight: '700' },
  meta: { color: MUTED, fontSize: 12, lineHeight: 17 },
  arrow: { color: MAROON, fontSize: 20 },
  steps: { padding: 12, paddingTop: 0, gap: 8 },
  step: { color: INK, fontSize: 13, lineHeight: 19 },
  link: { minHeight: 36, justifyContent: 'center' },
  linkText: { color: MAROON, fontSize: 12, fontWeight: '600' },
});
