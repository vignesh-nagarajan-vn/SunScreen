import { createContext, createElement, useContext, useMemo } from "react";
import { INK, LINE, MAROON, MUTED, ROUTES, SUN, TINT } from "./theme";

const light = {
  INK, LINE, MAROON, MUTED, SUN, TINT,
  surface: "#ffffff", header: MAROON, onAccent: "#ffffff",
  track: "#d9cfcf", handle: "#d4cccc", skeleton: "#eeeaea",
  error: "#9a1b1b", warning: "#9a5b00", overlay: "rgba(255,255,255,0.92)",
};
const dark = {
  INK: "#f5f2ef", LINE: "#443d3b", MAROON: "#A00000", MUTED: "#c0b9b5",
  SUN: "#e0a21b", TINT: "#302020", surface: "#1b1b1e", header: "#291818",
  onAccent: "#ffffff", track: "#544744", handle: "#675955", skeleton: "#393433",
  error: "#f1a078", warning: "#f2c37c", overlay: "rgba(27,27,30,0.94)",
};
const ThemeContext = createContext({ night: false, colors: light, routes: ROUTES });

export function ThemeProvider({ night, children }) {
  const value = useMemo(() => ({
    night,
    colors: night ? dark : light,
    routes: night ? {
      fastest: { ...ROUTES.fastest, color: "#b9b9be" },
      recommended: { ...ROUTES.recommended, color: "#c64b32" },
      max_shade: { ...ROUTES.max_shade, color: "#da7943", outline: "#f1ad73" },
      max_lit: { ...ROUTES.max_lit, color: "#da7943", outline: "#f1ad73" },
    } : ROUTES,
  }), [night]);
  return createElement(ThemeContext.Provider, { value }, children);
}

export const useTheme = () => useContext(ThemeContext);
export function useThemedStyles(createStyles) {
  const { colors } = useTheme();
  return useMemo(() => createStyles(colors), [createStyles, colors]);
}
