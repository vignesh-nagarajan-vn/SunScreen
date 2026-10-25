import { createContext, createElement, useContext, useMemo } from "react";
import { INK, LINE, MAROON, MUTED, ROUTES, SUN, TINT } from "./theme";

// `card` is a raised surface over the map, `chip` a quiet button fill, `sun*` the time-of-day timeline.
const light = {
  INK, LINE, MAROON, MUTED, SUN, TINT,
  surface: "#ffffff", card: "#ffffff", chip: "#f5f0f0", divider: "#eee6e6", onAccent: "#ffffff",
  track: "#d9cfcf", handle: "#ddd3d3", skeleton: "#eeeaea", shadow: "#280a0a",
  sunBar: "#efc66e", sunNone: "#ddd6d3", sunTint: "#fdf3dc", sunInk: "#9a6a00", unlitBar: "#c9ced6",
  error: "#9a1b1b", warning: "#9a5b00", overlay: "rgba(255,255,255,0.92)",
};
// Night swaps maroon for a copper accent that reads on the dark map; dark text sits on copper fills.
const dark = {
  INK: "#f3eeee", LINE: "#3a3537", MAROON: "#e59a72", MUTED: "#b3abad",
  SUN: "#e0a21b", TINT: "#2e2421", surface: "#1b1a1c", card: "#242123", chip: "#33292a", divider: "#3a3537",
  onAccent: "#1b1a1c", track: "#544744", handle: "#3a3537", skeleton: "#393433", shadow: "#000000",
  sunBar: "#8a6a2e", sunNone: "#3a3537", sunTint: "#3a2a22", sunInk: "#e59a72", unlitBar: "#4a5160",
  error: "#f1a078", warning: "#f2c37c", overlay: "rgba(27,26,28,0.92)",
};
const ThemeContext = createContext({ night: false, colors: light, routes: ROUTES });

export function ThemeProvider({ night, children }) {
  const value = useMemo(() => ({
    night,
    colors: night ? dark : light,
    routes: night ? {
      fastest: { ...ROUTES.fastest, color: "#b9b9be", tone: "#8e929b" },
      recommended: { ...ROUTES.recommended, color: "#c64b32", tone: "#e59a72" },
      max_shade: { ...ROUTES.max_shade, color: "#da7943", tone: "#b07a66", outline: "#f1ad73" },
      max_lit: { ...ROUTES.max_lit, color: "#da7943", tone: "#b07a66", outline: "#f1ad73" },
    } : ROUTES,
  }), [night]);
  return createElement(ThemeContext.Provider, { value }, children);
}

export const useTheme = () => useContext(ThemeContext);
export function useThemedStyles(createStyles) {
  const { colors } = useTheme();
  return useMemo(() => createStyles(colors), [createStyles, colors]);
}
