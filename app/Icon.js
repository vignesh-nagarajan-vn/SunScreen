import Svg, { Circle, Path, Rect } from "react-native-svg";

// Stroke icons on a 24-unit grid. Shapes marked `fill` are solid in the icon's color.
const ICONS = {
  swap: [["path", { d: "M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4" }]],
  moon: [["path", { d: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" }]],
  moonFilled: [["path", { d: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z", fill: true }]],
  sliders: [["path", { d: "M4 7h10M18 7h2M4 17h4M12 17h8" }], ["circle", { cx: 16, cy: 7, r: 2 }], ["circle", { cx: 10, cy: 17, r: 2 }]],
  info: [["circle", { cx: 12, cy: 12, r: 9 }], ["path", { d: "M12 11v5M12 7.5v.01" }]],
  sun: [["circle", { cx: 12, cy: 12, r: 4 }], ["path", { d: "M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" }]],
  sunOff: [["circle", { cx: 12, cy: 12, r: 4 }], ["path", { d: "M12 2v2M12 20v2M2 12h2M20 12h2M4 4l16 16" }]],
  play: [["path", { d: "M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z", fill: true }]],
  pause: [["rect", { x: 5, y: 4, width: 5, height: 16, rx: 1.5, fill: true }], ["rect", { x: 14, y: 4, width: 5, height: 16, rx: 1.5, fill: true }]],
  navigate: [["path", { d: "M12 2.5l7.5 18.2a.6.6 0 0 1-.85.74L12 18l-6.65 3.44a.6.6 0 0 1-.85-.74z", fill: true }]],
  close: [["path", { d: "M6 6l12 12M18 6L6 18" }]],
  search: [["circle", { cx: 11, cy: 11, r: 7 }], ["path", { d: "M20 20l-4-4" }]],
  locate: [["circle", { cx: 12, cy: 12, r: 7 }], ["circle", { cx: 12, cy: 12, r: 2.5, fill: true }], ["path", { d: "M12 2v3M12 19v3M2 12h3M19 12h3" }]],
  pin: [["path", { d: "M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z" }], ["circle", { cx: 12, cy: 10, r: 2.3 }]],
  clock: [["circle", { cx: 12, cy: 12, r: 8.5 }], ["path", { d: "M12 7.5V12l3 2" }]],
  cap: [["path", { d: "M2 9l10-5 10 5-10 5z" }], ["path", { d: "M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5" }]],
  book: [["path", { d: "M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5zM20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z" }]],
  dining: [["path", { d: "M7 3v8M4.5 3v5a2.5 2.5 0 0 0 5 0V3M7 11v10M17 21V3c-2 1.5-3 4-3 7h3" }]],
  star: [["path", { d: "M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" }]],
  stadium: [["path", { d: "M3 9c0-2.2 4-4 9-4s9 1.8 9 4v6c0 2.2-4 4-9 4s-9-1.8-9-4z" }], ["path", { d: "M3 9c0 2.2 4 4 9 4s9-1.8 9-4" }]],
  landmark: [["path", { d: "M4 20h16M6 17V10M10 17V10M14 17V10M18 17V10M3 10l9-6 9 6z" }]],
  tree: [["path", { d: "M12 21v-5M7 16h10l-5-12z" }]],
  home: [["path", { d: "M4 11l8-7 8 7M6 9.5V20h12V9.5M10 20v-5h4v5" }]],
  health: [["rect", { x: 4, y: 4, width: 16, height: 16, rx: 4 }], ["path", { d: "M12 8.5v7M8.5 12h7" }]],
  building: [["rect", { x: 5, y: 3, width: 14, height: 18, rx: 1.5 }], ["path", { d: "M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2" }]],
  phone: [["path", { d: "M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z", fill: true }]],
  bulb: [["path", { d: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" }]],
  check: [["path", { d: "M5 12.5l4.5 4.5L19 7.5" }]],
};
const SHAPES = { path: Path, circle: Circle, rect: Rect };

export default function Icon({ name, size = 20, color, strokeWidth = 2 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false} pointerEvents="none">
      {ICONS[name].map(([shape, { fill, ...props }], i) => {
        const Shape = SHAPES[shape];
        return <Shape key={i} {...props} fill={fill ? color : "none"} stroke={fill ? "none" : color}
          strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />;
      })}
    </Svg>
  );
}
