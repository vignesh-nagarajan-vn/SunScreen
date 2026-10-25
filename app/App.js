import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Image, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, useWindowDimensions, View,
} from "react-native";
import RouteMap from "./RouteMap";
import PlacePicker from "./PlacePicker";
import IndoorDirections from "./IndoorDirections";
import indoorPlaces from "./indoorPlaces.json";
import PlaceDetails from "./PlaceDetails";
import { mapPlaces } from "./mapPlaces";
import highlights from "./placeHighlights.json";
import About from "./About";
import RouteSettings from "./RouteSettings";
import CorpsEscort from "./CorpsEscort";
import Icon from "./Icon";
import { LIGHTING_COLORS } from "./theme";
import { defaultLimits, matchesLimits, savedLimits, sameLimits } from "./routePreferences";
import { API_BASE } from "./config";
import { appleMapsUrl, googleMapsUrl, open } from "./openInMaps";
import { ThemeProvider, useTheme, useThemedStyles } from "./ThemeContext";
import fallback from "./fallback.json";
import lightingFallback from "./fallback-lighting.json";
import area from "./places.json";

const FIRST = 7 * 60, LAST = 20 * 60;
const SLOTS = Array.from({ length: (LAST - FIRST) / 30 + 1 }, (_, i) => FIRST + i * 30);
const WIDE = 900; // side-panel layout at and above this width
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const clock = (min) => `${((Math.floor(min / 60) + 11) % 12) + 1}:${String(min % 60).padStart(2, "0")} ${min < 720 ? "AM" : "PM"}`;
const snap = (min) => Math.min(LAST, Math.max(FIRST, Math.round(min / 30) * 30));
const campusParts = (date) => Object.fromEntries(new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
}).formatToParts(date).map((p) => [p.type, Number(p.value)]));
const nowMin = () => {
  const parts = campusParts(new Date());
  return snap(parts.hour * 60 + parts.minute);
};
const destinations = [...area.places, ...indoorPlaces];
const byId = Object.fromEntries(destinations.map((p) => [p.id, p]));
const mapPlaceCatalog = mapPlaces(area.places, highlights);
const mapPlaceById = Object.fromEntries(mapPlaceCatalog.map(p => [p.id, p]));
// Room details belong in the guide; outdoor maps use the containing building pin.
const mapEndpoint = p => p.indoor ? (byId[p.building_id] ?? p) : p;
const param = (p) => p.id ?? `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
const inBounds = (p, b) => p.lat >= b.south && p.lat <= b.north && p.lon >= b.west && p.lon <= b.east;
const extraText = (s) => (s < 60 ? `+${s} s` : `+${(s / 60).toFixed(1)} min`);
const tripKey = (a, b) => [a.lat, a.lon, b.lat, b.lon].map((v) => v.toFixed(5)).join();

// Per-viewer conveniences (recent places, intro seen) persist in the browser; native keeps them for the session.
const store = {
  get: (k, d) => { try { return Platform.OS === "web" ? JSON.parse(localStorage.getItem(k)) ?? d : d; } catch { return d; } },
  set: (k, v) => { try { if (Platform.OS === "web") localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// Start at the current time; on web, ?from=&to=&time=HH:MM&route= preselect a trip.
const params = Platform.OS === "web" ? new URLSearchParams(window.location.search) : new URLSearchParams();
const rawTime = params.get("time");
const timeParam = rawTime && /^([01]?\d|2[0-3]):[0-5]\d$/.test(rawTime) ? rawTime.split(":").map(Number) : null;
const initialMin = timeParam ? snap(timeParam[0] * 60 + timeParam[1]) : nowMin();

// Today's sun height over campus for each half hour, from a standard solar-position approximation.
// Only the timeline's bar heights use it; the selected time's sunlight comes from the server.
function daySunCurve() {
  const now = new Date();
  const today = campusParts(now);
  const offset = Math.round((Date.UTC(today.year, today.month - 1, today.day, today.hour, today.minute) - now.getTime()) / 18e5) * 30;
  const day = (Date.UTC(today.year, today.month - 1, today.day) - Date.UTC(today.year, 0, 0)) / 864e5;
  const rad = Math.PI / 180;
  const decl = -23.44 * rad * Math.cos((2 * Math.PI / 365) * (day + 10));
  const b = (2 * Math.PI * (day - 81)) / 364;
  const eot = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
  const lat = ((area.bounds.south + area.bounds.north) / 2) * rad, lon = (area.bounds.west + area.bounds.east) / 2;
  return SLOTS.map((min) => {
    const solar = min - offset + 4 * lon + eot;
    const hour = (solar / 4 - 180) * rad;
    return Math.max(0, Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hour));
  });
}

function weatherLine({ weather, sun }) {
  if (weather.source === "sun down") return "Sun down";
  const up = `${Math.round(sun.altitude)}° up`;
  const c = weather.cloud_cover_pct;
  if (c == null) return `Sun ${up} · weather unavailable`;
  const sky = c < 10 ? "Clear" : c < 40 ? "Mostly sunny" : c < 70 ? "Partly cloudy" : "Overcast";
  return `${sky} · ${weather.sun_strength_pct}% sunlight · ${up}`;
}

// Two lines on what the selected route buys you compared with Fastest.
function insight(data, selected) {
  const features = data.features.map((x) => x.properties);
  const f = features[0];
  const p = features.find((x) => x.id === selected) ?? features[1];
  if (data.mode === "lighting") {
    const sub = `${p.mapped_lit_pct}% mapped · ${p.estimated_lit_pct}% est. · ${p.unknown_pct}% unknown`;
    if (p.id === "fastest") return [`Quickest way there, ${p.lit_pct}% lit`, sub];
    if (p.same_as_fastest) return ["Same path as Fastest", sub];
    const more = p.lit_pct - f.lit_pct;
    return [more > 0 ? `${extraText(p.extra_s)} walk, ${more}% more of it lit` : data.summary, sub];
  }
  const sub = `${p.distance_m} m · ${p.shaded_pct}% shaded · ${p.sun_min} min in direct sun`;
  if (data.weather.source === "sun down") return ["The sun is down", "Every route is shaded. Night mode routes by streetlights."];
  if (data.weather.sun_strength_pct < 25) return [data.summary, sub];
  if (p.id === "fastest") return ["Quickest way there", sub];
  if (p.same_as_fastest) return ["Same path as Fastest", sub];
  const saved = f.sun_min - p.sun_min;
  const savedText = saved >= 1 ? `${Math.round(saved * 10) / 10} fewer min` : `${Math.round(saved * 60)} fewer s`;
  return [`${extraText(p.extra_s)} walk, ${savedText} in direct sun`, sub];
}

export default function App() {
  const [night, setNight] = useState(() => store.get("sunscreen-night-mode", false));
  const toggleNight = (value) => { setNight(value); store.set("sunscreen-night-mode", value); };
  return <ThemeProvider night={night}><AppContent toggleNight={toggleNight} /></ThemeProvider>;
}

function AppContent({ toggleNight }) {
  const styles = useThemedStyles(createStyles);
  const { colors: { surface }, night } = useTheme();
  const dimensions = useWindowDimensions();
  const wide = dimensions.width >= WIDE;
  // Short phones dock the trip card above the map: floating, it would cover a map too small to route beneath it.
  const docked = !wide && dimensions.height < 700;
  const [from, setFrom] = useState(byId[params.get("from")] ?? byId[area.default[0]]);
  const [to, setTo] = useState(byId[params.get("to")] ?? byId[area.default[1]]);
  const [minutes, setMinutes] = useState(initialMin);
  const [preview, setPreview] = useState(initialMin);
  const [selected, setSelected] = useState(params.get("route") ?? "recommended");
  const [data, setData] = useState(null);
  const [status, setStatus] = useState({ loading: true });
  const [endpointError, setEndpointError] = useState(null);
  useEffect(() => setEndpointError(null), [from, to]);
  const [picker, setPicker] = useState(null); // "from" | "to" while choosing an endpoint
  const [picking, setPicking] = useState(null); // "from" | "to" while waiting for a map tap
  const [highlightedId, setHighlightedId] = useState(null);
  const highlightedPlace = mapPlaceById[highlightedId];
  useEffect(() => { if (picker || picking) setHighlightedId(null); }, [picker, picking]);
  const [playing, setPlaying] = useState(false);
  const [cardHeight, setCardHeight] = useState(300);
  const [tripHeight, setTripHeight] = useState(110);
  const [recents, setRecents] = useState(() => store.get("sunscreen-recents", []));
  const [here, setHere] = useState(null); // last known GPS position, for distances in the picker
  const [about, setAbout] = useState(() => Platform.OS === "web" && params.get("intro") !== "0" && !store.get("sunscreen-intro-seen", false));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [limits, setLimits] = useState(() => savedLimits(store.get("sunscreen-route-limits", null)));
  const applyLimits = value => {
    setPlaying(false);
    if (!sameLimits(limits, value)) setLimits(value);
    store.set("sunscreen-route-limits", value);
    setSettingsOpen(false);
  };

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const mode = night ? "lighting" : "shade";
    const q = new URLSearchParams({ mode, time: hhmm(minutes), from: param(from), to: param(to), from_name: from.name, to_name: to.name, ...limits });
    setStatus({ loading: true });
    fetch(`${API_BASE}/api/route?${q}`, { signal: ctrl.signal })
      .then(async (r) => {
        const json = await r.json();
        if (cancelled) return;
        if (!r.ok) {
          setStatus({ error: typeof json.detail === "string" ? json.detail : "This trip could not be routed. Try different endpoints." });
          setPlaying(false);
          return;
        }
        if ((json.mode ?? "shade") !== mode) {
          setStatus({ error: "The server does not support this routing mode yet." });
          setPlaying(false);
          return;
        }
        if (!matchesLimits(json, limits)) throw new Error("Server did not apply route limits");
        const ids = ["fastest", "recommended", mode === "lighting" ? "max_lit" : "max_shade"];
        if (!json.start || !json.end || !Array.isArray(json.features) || json.features.length !== 3
          || json.features.some((f, i) => f?.properties?.id !== ids[i] || !Array.isArray(f.geometry?.coordinates) || f.geometry.coordinates.length < 2)) {
          throw new Error("Invalid route response");
        }
        setData(json); setStatus({});
      })
      .catch(() => {
        if (cancelled) return;
        // Server unreachable: the default trip has bundled routes, anything else can't be routed offline.
        if (!defaultLimits(limits)) {
          setStatus({ error: "Custom route limits need a connection and an updated server. Reset to 10% / 30% in Route settings to use saved routes." });
          setPlaying(false);
        } else if (from.id === area.default[0] && to.id === area.default[1]) {
          setData(night ? lightingFallback : fallback[hhmm(minutes)]);
          setStatus({ offline: true });
        } else {
          setStatus({ error: "Can't reach the SunScreen server. Check your connection and try again." });
          setPlaying(false);
        }
      })
      .finally(() => clearTimeout(timer));
    return () => { cancelled = true; clearTimeout(timer); ctrl.abort(); };
  }, [night, minutes, from, to, limits]);

  useEffect(() => {
    setPlaying(false);
    setSelected((value) => value === "max_shade" && night ? "max_lit" : value === "max_lit" && !night ? "max_shade" : value);
  }, [night]);

  useEffect(() => {
    if (data && !data.features.some((feature) => feature.properties.id === selected)) {
      setSelected("recommended");
    }
  }, [data, selected]);

  // Play: step through the day, waiting for each slot's routes before moving on.
  useEffect(() => {
    if (night || !playing || status.loading) return;
    if (minutes >= LAST) return setPlaying(false);
    const t = setTimeout(() => { setMinutes(minutes + 30); setPreview(minutes + 30); }, 700);
    return () => clearTimeout(t);
  }, [night, playing, status.loading, minutes]);

  const setTime = (m) => { setPlaying(false); setMinutes(m); setPreview(m); };
  const togglePlay = () => {
    if (!playing && minutes >= LAST) setTime(FIRST);
    setPlaying(!playing);
  };
  const choose = (which, place) => {
    setHighlightedId(null);
    setEndpointError(null);
    (which === "from" ? setFrom : setTo)(place);
    const next = [place, ...recents.filter((r) => r.name !== place.name)].slice(0, 5);
    setRecents(next);
    store.set("sunscreen-recents", next);
    setPicker(null);
    setPicking(null);
  };
  const onMapPress = (p) => {
    if (!inBounds(p, area.bounds)) return;
    choose(picking, { ...p, id: null, name: "Dropped pin" });
  };
  const onEndpointDragEnd = (which, point) => {
    setPlaying(false);
    if (!inBounds(point, area.bounds)) {
      setEndpointError("Keep the pin inside the campus area SunScreen covers.");
      return false;
    }
    setEndpointError(null);
    (which === "from" ? setFrom : setTo)({
      ...point, id: null, name: which === "from" ? "Custom start" : "Custom destination",
    });
    return true;
  };
  const showRoutes = data && !status.error;
  // While a new trip loads, show placeholders instead of the previous trip's routes.
  const stale = !status.error && (!data || !matchesLimits(data, limits) || (data.mode ?? "shade") !== (night ? "lighting" : "shade") ||
    (status.loading && tripKey(data.start, data.end) !== tripKey(from, to)));
  const closeAbout = () => { setAbout(false); store.set("sunscreen-intro-seen", true); };

  const mapControls = (
    <MapControls style={wide || docked ? { top: 12 } : { top: topInset + tripHeight + 12 }}
      onNight={() => toggleNight(!night)} onSettings={() => { setPlaying(false); setSettingsOpen(true); }} onInfo={() => setAbout(true)} />
  );
  const controls = highlightedPlace ? (
    <PlaceDetails place={highlightedPlace} from={from} to={to} onClose={() => setHighlightedId(null)}
      onChoose={(which, place) => {
        if ((which === "from" ? to : from).id === place.id) return;
        choose(which, byId[place.id]);
      }} />
  ) : (
    <Controls
      data={showRoutes && !stale ? data : null} stale={stale} status={{ ...status, error: endpointError || status.error }} selected={selected} setSelected={setSelected}
      preview={preview} setPreview={setPreview} setTime={setTime} playing={playing} togglePlay={togglePlay} limits={limits} fill={wide} from={from} to={to}
    />
  );
  const mapPane = (
    <>
      <RouteMap data={showRoutes && !stale ? data : null} selected={selected} bounds={area.bounds} picking={!!picking} onMapPress={onMapPress}
        places={mapPlaceCatalog} highlightedId={highlightedId}
        onPlacePress={place => { if (!picking && mapPlaceById[place.id]) { setPlaying(false); setHighlightedId(place.id); } }}
        onBackgroundPress={() => setHighlightedId(null)}
        from={mapEndpoint(from)} to={mapEndpoint(to)} onEndpointDragStart={() => { setPlaying(false); setHighlightedId(null); }} onEndpointDragEnd={onEndpointDragEnd}
        insets={wide ? { top: 70, right: 70 } : { top: docked ? 30 : topInset + tripHeight + 24, right: 70, bottom: 64 }} />
      {showRoutes && !stale && !picking && <Legend style={wide ? { bottom: 24 } : { bottom: 36 }} />}
      {picking && (
        <View style={[styles.banner, { top: wide ? 12 : topInset }]}>
          <Text style={styles.bannerText}>Tap the map to set your {picking === "from" ? "start" : "destination"}</Text>
          <Pressable onPress={() => setPicking(null)} hitSlop={8}><Text style={styles.bannerCancel}>Cancel</Text></Pressable>
        </View>
      )}
      {!picking && mapControls}
    </>
  );
  const pickerSheet = picker && (
    <PlacePicker
      title={picker === "from" ? "Choose start" : "Choose destination"} current={picker === "from" ? from : to}
      places={destinations} bounds={area.bounds} recents={recents} here={here} onLocated={setHere}
      onSelect={(p) => choose(picker, p)} onClose={() => setPicker(null)}
      onPickOnMap={() => { setPicking(picker); setPicker(null); }}
    />
  );
  const trip = <TripCard from={from} to={to} setPicker={setPicker} swap={() => { setFrom(to); setTo(from); }} floating={!wide} />;
  const settingsPanel = settingsOpen && <RouteSettings limits={limits} onApply={applyLimits} onClose={() => setSettingsOpen(false)} />;

  if (wide) {
    return (
      <View style={[styles.screen, { flexDirection: "row" }]}>
        <View style={styles.panel}>
          <View style={styles.brandRow}>
            <Image source={require("./assets/logo.png")} style={styles.logo} />
            <Text style={styles.brand}>SunScreen</Text>
          </View>
          <View style={{ paddingHorizontal: 16 }}>{trip}</View>
          <ScrollView contentContainerStyle={[styles.panelBody, { flexGrow: 1 }]}>{controls}</ScrollView>
          {pickerSheet}
        </View>
        <View style={styles.map}>{mapPane}</View>
        {about && <About onClose={closeAbout} />}
        {settingsPanel}
      </View>
    );
  }
  return (
    <View style={styles.screen}>
      <StatusBar barStyle={night ? "light-content" : "dark-content"} backgroundColor={surface} />
      {docked && !picking && (
        <View style={[styles.tripDock, { paddingTop: topInset }]} onLayout={(e) => setTripHeight(e.nativeEvent.layout.height - topInset - 8)}>{trip}</View>
      )}
      {/* The map ends where the sheet starts (minus its rounded corner), so fits and limits use what is visible. */}
      <View style={[styles.map, { marginBottom: picking ? 0 : cardHeight - 24 }]}>{mapPane}</View>
      {!docked && !picking && (
        <View style={[styles.tripFloat, { top: topInset }]} onLayout={(e) => setTripHeight(e.nativeEvent.layout.height)}>{trip}</View>
      )}
      {/* The sheet stays near half the screen so the map stays useful; longer night content scrolls. */}
      {!picking && (
        <View style={[styles.card, { maxHeight: Math.max(220, Math.min(dimensions.height * 0.56, dimensions.height - topInset - tripHeight - (docked ? 158 : 90))) }]}
          onLayout={(e) => setCardHeight(e.nativeEvent.layout.height)}>
          <View style={styles.handle} />
          <ScrollView style={{ flexGrow: 0 }} keyboardShouldPersistTaps="handled">{controls}</ScrollView>
        </View>
      )}
      {pickerSheet}
      {about && <About onClose={closeAbout} />}
      {settingsPanel}
    </View>
  );
}

function TripCard({ from, to, setPicker, swap, floating }) {
  const styles = useThemedStyles(createStyles);
  const { colors: { MAROON } } = useTheme();
  return (
    <View style={[styles.trip, floating ? styles.raised : styles.tripInset]}>
      <View style={styles.tripMarks} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={styles.markStart} />
        <View style={styles.markLine} />
        <View style={styles.markEnd} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Endpoint label="From" place={from} onPress={() => setPicker("from")} />
        <View style={styles.tripDivider} />
        <Endpoint label="To" place={to} onPress={() => setPicker("to")} />
      </View>
      <Pressable onPress={swap} style={styles.swap} hitSlop={4} accessibilityRole="button" accessibilityLabel="Swap start and destination">
        <Icon name="swap" color={MAROON} strokeWidth={2.2} />
      </Pressable>
    </View>
  );
}

function Endpoint({ label, place, onPress }) {
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable onPress={onPress} style={styles.endpoint} accessibilityRole="button" accessibilityLabel={`${label}: ${place.name}. Change`}>
      <Text style={styles.endpointLabel}>{label}</Text>
      <Text style={styles.endpointName} numberOfLines={1}>{place.name}</Text>
    </Pressable>
  );
}

// Round buttons floating on the map: night mode (a switch), route settings and "How it works".
function MapControls({ style, onNight, onSettings, onInfo }) {
  const styles = useThemedStyles(createStyles);
  const { colors: { INK, onAccent }, night } = useTheme();
  return (
    <View style={[styles.mapControls, style]} pointerEvents="box-none">
      <Pressable onPress={onNight} style={[styles.round, night && styles.roundActive]} accessibilityRole="switch"
        accessibilityState={{ checked: night }} aria-checked={night} accessibilityLabel="Night mode"
        accessibilityHint="Switch between sun-affected and streetlight-affected routing">
        <Icon name={night ? "moonFilled" : "moon"} color={night ? onAccent : INK} />
      </Pressable>
      <Pressable onPress={onSettings} style={styles.round} accessibilityRole="button" accessibilityLabel="Route settings"
        accessibilityHint="Adjust extra walking distance limits">
        <Icon name="sliders" color={INK} />
      </Pressable>
      <Pressable onPress={onInfo} style={styles.round} accessibilityRole="button" accessibilityLabel="How SunScreen works">
        <Icon name="info" color={INK} />
      </Pressable>
    </View>
  );
}

// `fill` spreads the controls down a tall side panel in three groups (time, routes, actions)
// and lets the sun timeline grow with the window. Night has no timeline, so its actions sit at the bottom.
function Controls({ data, stale, status, selected, setSelected, preview, setPreview, setTime, playing, togglePlay, limits, fill, from, to }) {
  const styles = useThemedStyles(createStyles);
  const { colors: { MAROON, SUN, sunInk, sunTint, onAccent }, night } = useTheme();
  const { height } = useWindowDimensions();
  const [title, sub] = data ? insight(data, selected) : [];

  return (
    <View style={fill ? [styles.fill, night && styles.fillNight] : { gap: 14 }}>
      <View style={{ gap: 14 }}>
        <IndoorDirections key={`${from.id}-${to.id}`} from={from} to={to} />
        {night ? <Text style={styles.nightTitle}>Streetlight routing</Text> : <>
          <View style={styles.timeRow}>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text style={styles.time}>{clock(preview)}</Text>
              {data && <View style={styles.weather}>
                <Icon name="sun" size={14} color={SUN} strokeWidth={2.4} />
                <Text style={styles.sub} numberOfLines={1}>{weatherLine(data)}</Text>
              </View>}
            </View>
            {status.loading && <ActivityIndicator size="small" color={MAROON} />}
            <Pressable onPress={() => setTime(nowMin())} style={styles.nowButton} accessibilityRole="button">
              <Text style={styles.nowText}>Now</Text>
            </Pressable>
            <Pressable onPress={togglePlay} style={styles.playButton} accessibilityRole="button"
              accessibilityLabel={playing ? "Pause day preview" : "Play through the day"}>
              <Icon name={playing ? "pause" : "play"} size={16} color={onAccent} />
            </Pressable>
          </View>
          <SunTimeline preview={preview} setPreview={setPreview} setTime={setTime}
            height={fill ? Math.min(200, Math.max(72, height - 620)) : 40} />
        </>}
      </View>

      <View style={{ gap: 14 }}>
        {status.error && <Text style={styles.error} accessibilityLiveRegion="polite">{status.error}</Text>}
        {!defaultLimits(limits) && <Text style={styles.rowMeta}>Custom limits: Recommended +{limits.recommended_pct}%; {night ? "Most lit" : "Max shade"} +{limits.max_detour_pct}%.</Text>}
        {stale && <Skeleton />}
        {data && (
          <View style={styles.routes}>
            {data.features.map(({ properties: p }) => (
              <RouteCard key={p.id} p={p} active={p.id === selected} onPress={() => setSelected(p.id)} roomy={fill} />
            ))}
          </View>
        )}
        {data && (
          <View style={styles.insight} accessibilityLiveRegion="polite">
            <View style={[styles.insightIcon, { backgroundColor: sunTint }]}>
              <Icon name={night ? "bulb" : "sunOff"} size={18} color={sunInk} strokeWidth={2.2} />
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text style={styles.insightTitle}>{title}</Text>
              <Text style={styles.rowMeta}>{sub}</Text>
            </View>
          </View>
        )}
      </View>

      <View style={[{ gap: 14 }, fill && night && { marginTop: "auto" }]}>
        {night && <CorpsEscort />}
        {data && <Handoff data={data} selected={selected} />}
        {night && data && <Text style={styles.rowMeta}>
          <Text accessibilityRole="link" onPress={() => open("https://www.openstreetmap.org/copyright")}>© OpenStreetMap contributors</Text>
          {data.lighting?.sources?.length > 0 && <>{" · "}<Text accessibilityRole="link"
            onPress={() => open(`https://www.arcgis.com/home/item.html?id=${data.lighting.sources[0].item_id}`)}>TAMU campus GIS</Text></>}
        </Text>}
        {status.offline && <Text style={styles.offline}>Offline: showing saved routes for The Commons → Zachry</Text>}
      </View>
    </View>
  );
}

// Half-hour bars from 7 AM to 8 PM, as tall as the sun is high; drag or tap to pick a departure time.
function SunTimeline({ preview, setPreview, setTime, height }) {
  const styles = useThemedStyles(createStyles);
  const { colors: { MAROON, sunBar, sunNone } } = useTheme();
  const [curve] = useState(daySunCurve);
  const width = useRef(1);
  const latest = useRef(preview);
  const peak = Math.max(...curve, 0.01);
  const index = (preview - FIRST) / 30;
  const at = (x) => SLOTS[Math.min(SLOTS.length - 1, Math.max(0, Math.round((x / width.current) * SLOTS.length - 0.5)))];
  const move = (e) => { latest.current = at(e.nativeEvent.locationX); setPreview(latest.current); };
  const step = (by) => setTime(Math.min(LAST, Math.max(FIRST, preview + by * 30)));
  return (
    <View style={{ gap: 6 }}>
      <View style={[styles.timeline, { height }]} onLayout={(e) => { width.current = e.nativeEvent.layout.width; }}
        onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true} onResponderTerminationRequest={() => false}
        onResponderGrant={move} onResponderMove={move} onResponderRelease={() => setTime(latest.current)}
        accessibilityRole="adjustable" accessibilityLabel="Time of day"
        accessibilityValue={{ min: FIRST, max: LAST, now: preview, text: clock(preview) }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) => step(e.nativeEvent.actionName === "increment" ? 1 : -1)}
        {...(Platform.OS === "web" ? { focusable: true, "aria-valuetext": clock(preview), onKeyDown: (event) => {
          const by = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[event.key];
          if (by === undefined) return;
          event.preventDefault();
          step(by);
        } } : {})}>
        {curve.map((s, i) => {
          const h = s > 0 ? 6 + Math.round((height - 6) * s / peak) : 4;
          return <View key={i} pointerEvents="none" style={[styles.bar, i === index
            ? { height: Math.max(h, 16), backgroundColor: MAROON }
            : { height: h, backgroundColor: s > 0 ? sunBar : sunNone }]} />;
        })}
      </View>
      <View style={styles.ticks}>
        {["7 AM", "11 AM", "3 PM", "8 PM"].map((t) => <Text key={t} style={styles.tick}>{t}</Text>)}
      </View>
    </View>
  );
}

// Gray placeholders while routes load.
function Skeleton() {
  const styles = useThemedStyles(createStyles);
  return (
    <View accessibilityLabel="Loading routes" style={styles.routes}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={[styles.routeCard, { gap: 8 }]}>
          <View style={[styles.skelLine, { width: "70%" }]} />
          <View style={[styles.skelLine, { width: "55%", height: 18 }]} />
          <View style={[styles.skelLine, { width: "100%", height: 6 }]} />
        </View>
      ))}
    </View>
  );
}

function Legend({ style }) {
  const styles = useThemedStyles(createStyles);
  const { colors: { MAROON, SUN }, night } = useTheme();
  const items = night
    ? [[LIGHTING_COLORS.mapped, "Mapped lit"], [LIGHTING_COLORS.estimated, "Estimated"], [LIGHTING_COLORS.unknown, "Unknown"], [LIGHTING_COLORS.unlit, "Unlit"]]
    : [[MAROON, "Shade"], [SUN, "Sun"]];
  return (
    <View style={[styles.legend, style]} pointerEvents="none">
      {items.map(([color, label]) => (
        <View key={label} style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: color }]} /><Text style={styles.legendText}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

// Hand the selected route to a maps app for turn-by-turn directions.
function Handoff({ data, selected }) {
  const styles = useThemedStyles(createStyles);
  const { colors: { onAccent } } = useTheme();
  const feature = data.features.find((f) => f.properties.id === selected) ?? data.features[0];
  const buildings = feature.properties.via_buildings ?? [];
  return (
    <View style={{ gap: 8 }}>
      {buildings.length > 0 && <Text style={styles.rowMeta} accessibilityLiveRegion="polite">
        {feature.properties.access_unconfirmed ? "Check building access. " : ""}External maps may change covered sections.
      </Text>}
      <View style={styles.handoff}>
        <Pressable style={[styles.mapsButton, styles.mapsPrimary]} onPress={() => open(googleMapsUrl(feature, data.start, data.end))}
          accessibilityRole="link" accessibilityLabel={`Open the ${feature.properties.label.toLowerCase()} route in Google Maps`}>
          <Icon name="navigate" size={18} color={onAccent} />
          <Text style={styles.mapsPrimaryText}>Start in Google Maps</Text>
        </Pressable>
        <Pressable style={styles.mapsButton} onPress={() => open(appleMapsUrl(data.start, data.end))}
          accessibilityRole="link" accessibilityLabel="Open in Apple Maps">
          <Text style={styles.mapsText}>Apple Maps</Text>
        </Pressable>
      </View>
    </View>
  );
}

function RouteCard({ p, active, onPress, roomy }) {
  const styles = useThemedStyles(createStyles);
  const { colors: { SUN, unlitBar }, routes: ROUTES } = useTheme();
  const narrow = useWindowDimensions().width < 360;
  const lighting = p.mode === "lighting";
  const { tone } = ROUTES[p.id];
  const pct = lighting ? p.lit_pct : p.shaded_pct;
  return (
    <Pressable onPress={onPress} style={[styles.routeCard, narrow && { padding: 8 }, roomy && { padding: 12, gap: 8 }, active && styles.routeCardActive]} accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${p.label}: ${p.time_min} minutes, ${lighting ? `${p.lit_pct} percent mapped or estimated lit, ${p.unknown_pct} percent unknown` : `${p.shaded_pct} percent shaded`}`}>
      <View style={styles.routeLabelRow}>
        <View style={[styles.dot, { backgroundColor: tone }]} />
        <Text style={styles.routeLabel} numberOfLines={1}>{p.label}</Text>
      </View>
      <Text style={[styles.routeTime, narrow && { fontSize: 15 }]} numberOfLines={1}>{p.time_min} min</Text>
      <View style={[styles.meter, { backgroundColor: lighting ? unlitBar : SUN }]}>
        <View style={{ width: `${pct}%`, backgroundColor: lighting ? LIGHTING_COLORS.mapped : tone }} />
      </View>
      <Text style={styles.routeMetric} numberOfLines={1}>{pct}% {lighting ? "lit" : "shade"}</Text>
      {roomy && <Text style={styles.routeMetric} numberOfLines={1}>{p.distance_m} m</Text>}
    </Pressable>
  );
}

const topInset = Platform.select({ ios: 50, android: (StatusBar.currentHeight ?? 24) + 8, default: 12 });

const createStyles = ({ INK, LINE, MAROON, MUTED, TINT, surface, card, chip, divider, onAccent, handle, skeleton, shadow, error, warning, overlay }) => {
  const raised = { shadowColor: shadow, shadowOpacity: 0.16, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8 };
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: surface },
    map: { flex: 1 },
    raised,
    panel: { width: 400, borderRightWidth: 1, borderRightColor: LINE, backgroundColor: surface },
    panelBody: { padding: 16 },
    brandRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 },
    logo: { width: 26, height: 26 },
    brand: { color: MAROON, fontSize: 19, fontWeight: "800", letterSpacing: 0.2 },
    tripFloat: { position: "absolute", left: 12, right: 12 },
    tripDock: { paddingHorizontal: 12, paddingBottom: 8, backgroundColor: surface, zIndex: 1 },
    trip: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: card, borderRadius: 20, paddingVertical: 6, paddingLeft: 16, paddingRight: 6 },
    tripInset: { borderWidth: 1, borderColor: LINE },
    tripMarks: { alignItems: "center", gap: 4 },
    markStart: { width: 10, height: 10, borderRadius: 5, borderWidth: 2.5, borderColor: MAROON },
    markLine: { width: 2, height: 26, borderRadius: 1, backgroundColor: LINE },
    markEnd: { width: 12, height: 12, borderRadius: 6, backgroundColor: MAROON },
    tripDivider: { height: 1, backgroundColor: divider },
    endpoint: { minHeight: 48, justifyContent: "center" },
    endpointLabel: { color: MUTED, fontSize: 11, fontWeight: "600" },
    endpointName: { color: INK, fontSize: 16, fontWeight: "700" },
    swap: { width: 44, height: 44, borderRadius: 14, backgroundColor: TINT, alignItems: "center", justifyContent: "center" },
    mapControls: { position: "absolute", zIndex: 1000, right: 12, gap: 8 },
    round: { width: 44, height: 44, borderRadius: 22, backgroundColor: card, alignItems: "center", justifyContent: "center", ...raised },
    roundActive: { backgroundColor: MAROON },
    banner: { position: "absolute", zIndex: 1000, left: 12, right: 12, backgroundColor: MAROON, borderRadius: 14, padding: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    bannerText: { color: onAccent, fontWeight: "600", flex: 1 },
    bannerCancel: { color: onAccent, fontWeight: "700", marginLeft: 12 },
    legend: { position: "absolute", zIndex: 1000, left: 12, maxWidth: "80%", flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 8, rowGap: 4, backgroundColor: overlay, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
    legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
    legendSwatch: { width: 14, height: 5, borderRadius: 3 },
    legendText: { fontSize: 12, fontWeight: "600", color: INK },
    card: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 16, paddingTop: 8, paddingBottom: Platform.OS === "ios" ? 30 : 18, ...raised, shadowOffset: { width: 0, height: -6 }, elevation: 12 },
    handle: { alignSelf: "center", width: 36, height: 5, borderRadius: 3, backgroundColor: handle, marginBottom: 12 },
    timeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    time: { fontSize: 28, fontWeight: "800", color: MAROON, letterSpacing: -0.5 },
    weather: { flexDirection: "row", alignItems: "center", gap: 6 },
    sub: { flexShrink: 1, fontSize: 13, fontWeight: "500", color: MUTED },
    nightTitle: { fontSize: 22, fontWeight: "800", color: INK, letterSpacing: -0.3 },
    nowButton: { height: 44, paddingHorizontal: 16, borderRadius: 22, borderWidth: 1.5, borderColor: LINE, justifyContent: "center" },
    nowText: { color: MAROON, fontSize: 14, fontWeight: "700" },
    playButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: MAROON, alignItems: "center", justifyContent: "center" },
    timeline: { flexDirection: "row", alignItems: "flex-end", gap: 3, cursor: "pointer" },
    bar: { flex: 1, borderRadius: 3 },
    ticks: { flexDirection: "row", justifyContent: "space-between" },
    tick: { color: MUTED, fontSize: 11, fontWeight: "600" },
    fill: { flexGrow: 1, justifyContent: "space-between", gap: 24 },
    fillNight: { justifyContent: "flex-start", gap: 18 },
    routes: { flexDirection: "row", gap: 6 },
    routeCard: { flex: 1, minWidth: 0, gap: 6, padding: 10, borderRadius: 14, borderWidth: 1.5, borderColor: LINE, backgroundColor: card },
    routeCardActive: { borderColor: MAROON, backgroundColor: TINT },
    routeLabelRow: { flexDirection: "row", alignItems: "center", gap: 5 },
    dot: { width: 7, height: 7, borderRadius: 4 },
    routeLabel: { flexShrink: 1, fontSize: 11, fontWeight: "700", color: MUTED },
    routeTime: { fontSize: 18, fontWeight: "800", color: INK, letterSpacing: -0.3 },
    meter: { flexDirection: "row", height: 6, borderRadius: 3, overflow: "hidden" },
    routeMetric: { fontSize: 12, fontWeight: "600", color: MUTED },
    insight: { flexDirection: "row", alignItems: "center", gap: 12 },
    insightIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
    insightTitle: { fontSize: 14, fontWeight: "700", color: INK },
    rowMeta: { fontSize: 12, color: MUTED },
    handoff: { flexDirection: "row", gap: 8 },
    mapsButton: { flex: 1, flexDirection: "row", gap: 8, borderRadius: 14, borderWidth: 1.5, borderColor: LINE, minHeight: 50, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
    mapsPrimary: { flex: 1.7, backgroundColor: MAROON, borderColor: MAROON },
    mapsPrimaryText: { color: onAccent, fontWeight: "700", fontSize: 15 },
    mapsText: { color: MAROON, fontWeight: "700", fontSize: 15 },
    skelLine: { height: 12, borderRadius: 6, backgroundColor: skeleton },
    error: { color: error, fontSize: 14, textAlign: "center" },
    offline: { fontSize: 12, color: warning, textAlign: "center" },
  });
};
