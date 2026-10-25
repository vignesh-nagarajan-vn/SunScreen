export function sheetLimits(height, topInset, tripHeight, docked) {
  const max = Math.max(100, Math.min(height * 0.8, height - topInset - tripHeight - (docked ? 130 : 90)));
  const min = Math.min(180, max);
  return { min, max, initial: Math.max(min, Math.min(max, height * 0.5)) };
}

export const clampSheetHeight = (height, limits) => Math.max(limits.min, Math.min(limits.max, height));

export function routeFitKey(data, ready, size, fittedTrip) {
  if (!data || !ready || size.width <= 0 || size.height <= 0) return null;
  const trip = [data.start.lat, data.start.lon, data.end.lat, data.end.lon].map(v => v.toFixed(5)).join();
  return trip === fittedTrip ? null : trip;
}
