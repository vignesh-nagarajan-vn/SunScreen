import { useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { useTheme, useThemedStyles } from './ThemeContext';
import { DEFAULT_LIMITS, validLimits } from './routePreferences';

export default function RouteSettings({ limits, onApply, onClose }) {
  const [draft, setDraft] = useState({ ...limits });
  const styles = useThemedStyles(createStyles);
  const { night, colors } = useTheme();
  const maximum = night ? 'Most lit' : 'Max shade';
  const valid = validLimits(draft);
  return <Modal transparent animationType="fade" onRequestClose={onClose} accessibilityLabel="Route settings">
    <View style={styles.backdrop} onAccessibilityEscape={onClose}
      {...(Platform.OS === 'web' ? { onKeyDown: event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
      } } : {})}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close route settings" />
      <View style={styles.sheet} accessibilityViewIsModal>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.title} accessibilityRole="header">Route settings</Text>
          <Text style={styles.text}>Extra walking distance compared with Fastest. These are limits, not targets.</Text>
          {[[ 'recommended_pct', 'Recommended' ], [ 'max_detour_pct', maximum ]].map(([key, label]) => <View key={key} style={styles.field}>
            <Text style={styles.label}>{label}: up to +{draft[key]}%</Text>
            <Slider accessibilityLabel={`${label} extra distance`} minimumValue={0} maximumValue={100} step={5}
              accessibilityValue={{ min: 0, max: 100, now: draft[key], text: `${draft[key]}% extra distance` }}
              {...(Platform.OS === 'web' ? { tabIndex: 0, 'aria-valuemin': 0, 'aria-valuemax': 100,
                'aria-valuenow': draft[key], 'aria-valuetext': `${draft[key]}% extra distance`, onKeyDown: event => {
                const value = { ArrowRight: draft[key] + 5, ArrowUp: draft[key] + 5,
                  ArrowLeft: draft[key] - 5, ArrowDown: draft[key] - 5, Home: 0, End: 100 }[event.key];
                if (value === undefined) return;
                event.preventDefault();
                setDraft(previous => ({ ...previous, [key]: Math.max(0, Math.min(100, value)) }));
              } } : {})}
              value={draft[key]} onValueChange={value => setDraft(previous => ({ ...previous, [key]: value }))}
              minimumTrackTintColor={colors.MAROON} maximumTrackTintColor={colors.track} thumbTintColor={colors.MAROON} />
          </View>)}
          {!valid && <Text style={styles.error} accessibilityLiveRegion="polite">{maximum} must allow at least as much extra distance as Recommended.</Text>}
          <Text style={styles.example}>For a 1 km fastest route: Recommended up to {(1 + draft.recommended_pct / 100).toFixed(2)} km; {maximum} up to {(1 + draft.max_detour_pct / 100).toFixed(2)} km.</Text>
          <View style={styles.warning}>
            <Text style={styles.warningText}>Higher limits can mean longer walks without less total sun exposure or better lighting. Check the extra walking time before starting.</Text>
            <Text style={styles.warningText}>{night ? 'Lamp locations are estimates, not measured brightness, live outage status or a guarantee of safety.' : 'Recommended’s allowance shrinks when direct sunlight is low. Shade and building access are estimates; doors may be closed.'}</Text>
            {draft.max_detour_pct > 30 && <Text style={styles.warningText}>Long detour: up to {draft.max_detour_pct}% farther than Fastest. At 100%, the route could be twice as long.</Text>}
          </View>
          <Text style={styles.text}>Custom limits require a connection. Saved offline routes use the default 10% / 30% limits.</Text>
          <Pressable onPress={() => setDraft({ ...DEFAULT_LIMITS })} accessibilityRole="button" style={styles.reset}>
            <Text style={styles.link}>Reset to 10% / 30%</Text>
          </Pressable>
          <View style={styles.actions}>
            <Pressable onPress={onClose} accessibilityRole="button" style={styles.button}><Text style={styles.link}>Cancel</Text></Pressable>
            <Pressable onPress={() => valid && onApply(draft)} disabled={!valid} accessibilityRole="button" accessibilityState={{ disabled: !valid }}
              style={[styles.button, styles.primary, !valid && { opacity: 0.45 }]}><Text style={styles.primaryText}>Apply</Text></Pressable>
          </View>
        </ScrollView>
      </View>
    </View>
  </Modal>;
}

const createStyles = c => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  sheet: { width: '100%', maxWidth: 400, maxHeight: '90%', backgroundColor: c.surface, borderRadius: 18 },
  body: { padding: 18 }, title: { color: c.MAROON, fontSize: 21, fontWeight: '700', marginBottom: 8 },
  text: { color: c.MUTED, fontSize: 13, lineHeight: 18 },
  field: { marginTop: 14 }, label: { color: c.INK, fontSize: 14, fontWeight: '600' },
  example: { color: c.MUTED, fontSize: 12, lineHeight: 18, marginVertical: 10 },
  error: { color: c.error, fontSize: 13, marginVertical: 8 },
  warning: { backgroundColor: c.TINT, borderLeftWidth: 3, borderLeftColor: c.warning, padding: 10, gap: 8, marginBottom: 10 },
  warningText: { color: c.warning, fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 10 }, button: { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: c.MAROON, alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  primary: { backgroundColor: c.MAROON }, primaryText: { color: c.onAccent, fontWeight: '700' },
  link: { color: c.MAROON, fontWeight: '600', fontSize: 13 }, reset: { minHeight: 44, justifyContent: 'center', alignItems: 'center', marginVertical: 4 },
});
