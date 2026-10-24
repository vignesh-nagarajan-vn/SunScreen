import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { INK, MAROON, MUTED, SUN, TINT } from "./theme";

const STEPS = [
  ["🏙️", "Measure campus in 3D", "65 million 2025 LiDAR points give the height of every building and tree on a 1 m grid."],
  ["☀️", "Cast real shadows", "For each half hour from 7 AM to 8 PM, the sun's exact position casts shadows across campus. Today's cloud forecast sets how strong the sun is."],
  ["🚶", "Pick the shady path", "Every footpath is scored for shade, then SunScreen finds the fastest route and the ones that trade a minute or two for much more shade."],
];

// "How it works" sheet: three steps and a tiny sun / building / shadow diagram.
export default function About({ onClose }) {
  return (
    <View style={styles.backdrop} accessibilityViewIsModal>
      <View style={styles.sheet}>
        <ScrollView contentContainerStyle={{ padding: 20 }}>
          <Text style={styles.title} accessibilityRole="header">How SunScreen works</Text>
          <ShadowDiagram />
          {STEPS.map(([icon, head, body], i) => (
            <View key={head} style={styles.step}>
              <Text style={styles.stepIcon}>{icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.stepHead}>{i + 1}. {head}</Text>
                <Text style={styles.stepBody}>{body}</Text>
              </View>
            </View>
          ))}
          <Text style={styles.credits}>Data: TxGIO StratMap LiDAR, OpenStreetMap, Open-Meteo. Built for Aggies at Howdy Hacks 2026.</Text>
          <Pressable style={styles.button} onPress={onClose} accessibilityRole="button">
            <Text style={styles.buttonText}>Find a shady route</Text>
          </Pressable>
        </ScrollView>
      </View>
    </View>
  );
}

function ShadowDiagram() {
  return (
    <View style={styles.diagram} accessibilityLabel="Diagram: the sun shines on a building, which casts a shadow over the path behind it">
      <View style={styles.sunDot} />
      <View style={styles.ray} />
      <View style={styles.shadow} />
      <View style={styles.building} />
      <View style={styles.ground} />
      <View style={[styles.walker, { left: 70 }]}><Text style={styles.walkerText}>🚶</Text></View>
      <Text style={[styles.label, { left: 44 }]}>shade</Text>
      <Text style={[styles.label, { left: 196 }]}>sun</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center", padding: 16, zIndex: 3000 },
  sheet: { backgroundColor: "white", borderRadius: 20, maxWidth: 440, width: "100%", maxHeight: "92%" },
  title: { fontSize: 22, fontWeight: "800", color: MAROON, marginBottom: 12 },
  diagram: { height: 120, backgroundColor: TINT, borderRadius: 14, marginBottom: 16, overflow: "hidden" },
  sunDot: { position: "absolute", right: 22, top: 12, width: 28, height: 28, borderRadius: 14, backgroundColor: SUN },
  ray: { position: "absolute", right: 40, top: 30, width: 140, height: 2, backgroundColor: SUN, opacity: 0.6, transform: [{ rotate: "-28deg" }], transformOrigin: "right" },
  building: { position: "absolute", left: 130, bottom: 22, width: 34, height: 64, backgroundColor: MAROON, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  shadow: { position: "absolute", left: 30, bottom: 22, width: 104, height: 10, backgroundColor: "#3a2a2a", opacity: 0.35 },
  ground: { position: "absolute", left: 0, right: 0, bottom: 18, height: 4, backgroundColor: "#c9bdbd" },
  walker: { position: "absolute", bottom: 26 },
  walkerText: { fontSize: 18 },
  label: { position: "absolute", bottom: 2, fontSize: 11, color: MUTED, fontWeight: "600" },
  step: { flexDirection: "row", gap: 12, marginBottom: 14 },
  stepIcon: { fontSize: 22, width: 30, textAlign: "center" },
  stepHead: { fontSize: 15, fontWeight: "700", color: INK, marginBottom: 2 },
  stepBody: { fontSize: 14, color: MUTED, lineHeight: 20 },
  credits: { fontSize: 12, color: MUTED, marginTop: 4, marginBottom: 14 },
  button: { backgroundColor: MAROON, borderRadius: 12, paddingVertical: 13, alignItems: "center", minHeight: 44 },
  buttonText: { color: "white", fontWeight: "700", fontSize: 15 },
});
