export const FIRST = 7 * 60, LAST = 20 * 60;
export const campusParts = (date) => Object.fromEntries(new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
}).formatToParts(date).map((p) => [p.type, Number(p.value)]));
export const campusMinutes = (date = new Date()) => {
  const parts = campusParts(date);
  return parts.hour * 60 + parts.minute;
};
// Check the real minute before rounding/clamping it to a calculated shade slot.
export const outsideSunHours = (minutes) => minutes < FIRST || minutes > LAST;
