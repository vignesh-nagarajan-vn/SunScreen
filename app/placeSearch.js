// Keep scoring aligned with campus_routing/places.py; checked with shared fixtures.
export function normalize(value) {
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function matchScore(place, query) {
  const q = normalize(query);
  if (!q) return null;
  const compact = q.replace(/ /g, '');
  const terms = [place.name, place.id?.replace(/_/g, ' '), place.building_code, place.building_number, ...(place.aliases ?? [])]
    .filter(Boolean).map(normalize);
  if (terms.some(t => t === q || compact.length >= 2 && t.replace(/ /g, '') === compact)) return 0;
  if (terms.some(t => t.startsWith(q) || compact.length >= 2 && t.replace(/ /g, '').startsWith(compact))) return 1;
  if (terms.some(t => q.split(' ').every(token => t.split(' ').some(word => word.startsWith(token))))) return 2;
  if (terms.some(t => t.includes(q))) return 3;
  return null;
}

export function searchPlaces(places, query, limit = 40) {
  const compare = (a, b) => (a > b) - (a < b);
  return places.map(place => ({ place, score: matchScore(place, query) })).filter(x => x.score !== null)
    .sort((a, b) => a.score - b.score || compare(normalize(a.place.name), normalize(b.place.name)) || compare(a.place.id, b.place.id))
    .slice(0, limit).map(x => x.place);
}

export function exactPlace(places, query) {
  const found = places.filter(p => matchScore(p, query) === 0);
  return found.length === 1 ? found[0] : null;
}
