import { createContext, createElement, useContext, useMemo } from "react";
import { INK, LINE, MAROON, MUTED, ROUTES, SUN, TINT } from "./theme";

const light = {
  INK, LINE, MAROON, MUTED, SUN, TINT,
  surface: "#ffffff", header: MAROON, onAccent: "#ffffff",
  track: "#d9cfcf", handle: "#d4cccc", skeleton: "#eeeaea",
  error: "#9a1b1b", warning: "#9a5b00", overlay: "rgba(255,255,255,0.92)",
};
const dark = {
  INK: "#f5edef", LINE: "#44383e", MAROON: "#f0a5b1", MUTED: "#c0b2b9",
  SUN: "#e0a21b", TINT: "#35252e", surface: "#1b181e", header: "#291820",
  onAccent: "#29121b", track: "#54434d", handle: "#67545f", skeleton: "#393039",
  error: "#ffaaa8", warning: "#f2c37c", overlay: "rgba(27,24,30,0.94)",
};
const ThemeContext = createContext({ night: false, colors: light, routes: ROUTES });

export function ThemeProvider({ night, children }) {
  const value = useMemo(() => ({
    night,
    colors: night ? dark : light,
    routes: night ? {
      fastest: { ...ROUTES.fastest, color: "#b9b0b8" },
      recommended: { ...ROUTES.recommended, color: dark.MAROON },
      max_shade: { ...ROUTES.max_shade, color: "#cc849c", outline: "#edbbcc" },
      max_lit: { ...ROUTES.max_lit, color: "#cc849c", outline: "#edbbcc" },
    } : ROUTES,
  }), [night]);
  return createElement(ThemeContext.Provider, { value }, children);
}

export const useTheme = () => useContext(ThemeContext);
export function useThemedStyles(createStyles) {
  const { colors } = useTheme();
  return useMemo(() => createStyles(colors), [createStyles, colors]);
}
