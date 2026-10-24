export const DEFAULT_LIMITS = Object.freeze({ recommended_pct: 10, max_detour_pct: 30 });

export function validLimits(value) {
  return !!value && [value.recommended_pct, value.max_detour_pct].every(
    n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100
  ) && value.recommended_pct <= value.max_detour_pct;
}

export function savedLimits(value) {
  return validLimits(value) ? { recommended_pct: value.recommended_pct, max_detour_pct: value.max_detour_pct } : { ...DEFAULT_LIMITS };
}

export const sameLimits = (a, b) => a?.recommended_pct === b?.recommended_pct && a?.max_detour_pct === b?.max_detour_pct;
export const defaultLimits = value => sameLimits(value, DEFAULT_LIMITS);
// Old bundled routes and older servers omit limits; those only support defaults.
export const matchesLimits = (data, value) => sameLimits(data?.route_limits ?? DEFAULT_LIMITS, value);
