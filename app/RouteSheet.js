import { useEffect, useRef, useState } from "react";
import { PanResponder, Platform, ScrollView, StyleSheet, View } from "react-native";
import { useThemedStyles } from "./ThemeContext";
import { clampSheetHeight } from "./viewGeometry";

export default function RouteSheet({ children, style, limits, onHeightChange }) {
  const styles = useThemedStyles(createStyles);
  const [height, setHeight] = useState(limits.initial);
  const current = useRef(null);
  const startHeight = useRef(height);
  const resize = value => {
    const next = clampSheetHeight(value, current.current.limits);
    setHeight(next);
    current.current.onHeightChange(next);
  };
  current.current = { height, limits, onHeightChange, resize };
  useEffect(() => {
    current.current.resize(current.current.height);
  }, [limits.min, limits.max]);
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { startHeight.current = current.current.height; },
    onPanResponderMove: (_, gesture) => current.current.resize(startHeight.current - gesture.dy),
    onPanResponderTerminationRequest: () => false,
  })).current;
  const step = by => resize(height + by);
  return <View style={[style, { height }]}>
    <View {...responder.panHandlers} style={styles.grip}
      accessibilityRole="adjustable" accessibilityLabel="Resize route panel"
      accessibilityHint="Drag up for more controls or down for more map"
      accessibilityValue={{ min: limits.min, max: limits.max, now: height }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={event => step(event.nativeEvent.actionName === "increment" ? 48 : -48)}
      {...(Platform.OS === "web" ? { focusable: true, "aria-valuemin": limits.min, "aria-valuemax": limits.max, "aria-valuenow": height,
        onMouseDown: event => event.preventDefault(), onKeyDown: event => {
        const by = { ArrowUp: 48, ArrowDown: -48 }[event.key];
        if (by === undefined) return;
        event.preventDefault();
        step(by);
      } } : {})}>
      <View pointerEvents="none" style={styles.handle} />
    </View>
    <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
  </View>;
}

const createStyles = ({ handle }) => StyleSheet.create({
  grip: { height: 36, flexShrink: 0, alignItems: "center", justifyContent: "center", cursor: "ns-resize", touchAction: "none" },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: handle },
});
