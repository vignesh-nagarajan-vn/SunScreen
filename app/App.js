import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Image, PanResponder, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Switch, Text, useWindowDimensions, View,
} from "react-native";
import Slider from "@react-native-community/slider";
import RouteMap from "./RouteMap";
import PlacePicker from "./PlacePicker";
import PlaceDetails from "./PlaceDetails";
import { mapPlaces } from "./mapPlaces";
import highlights from "./placeHighlights.json";
import About from "./About";
import RouteSettings from "./RouteSettings";
import CorpsEscort from "./CorpsEscort";
import { LIGHTING_COLORS } from "./theme";
import { defaultLimits, matchesLimits, savedLimits, sameLimits } from "./routePreferences";
import { API_BASE } from "./config";
import { appleMapsUrl, googleMapsUrl, open } from "./openInMaps";
import { ThemeProvider, useTheme, useThemedStyles } from "./ThemeContext";
import fallback from "./fallback.json";
import lightingFallback from "./fallback-lighting.json";
import area from "./places.json";

const FIRST = 7 * 60, LAST = 20 * 60;
const WIDE = 900; // side-panel layout at and above this width
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const clock = (min) => `${((Math.floor(min / 60) + 11) % 12) + 1}:${String(min % 60).padStart(2, "0")} ${min < 720 ? "AM" : "PM"}`;
const snap = (min) => Math.min(LAST, Math.max(FIRST, Math.round(min / 30) * 30));
const nowMin = () => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  return snap(Number(parts.find((p) => p.type === "hour").value) * 60 + Number(parts.find((p) => p.type === "minute").value));
};
const byId = Object.fromEntries(area.places.map((p) => [p.id, p]));
const mapPlaceCatalog = mapPlaces(area.places, highlights);
const mapPlaceById = Object.fromEntries(mapPlaceCatalog.map(p => [p.id, p]));
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

function weatherPills({ weather, sun }) {
  if (weather.source === "sun down") return ["☾ Sun down"];
  const up = `☀ ${Math.round(sun.altitude)}° up`;
  const c = weather.cloud_cover_pct;
  if (c == null) return [up, "Weather unavailable"];
  const sky = c < 10 ? "Clear" : c < 40 ? "Mostly sunny" : c < 70 ? "☁ Partly cloudy" : "☁ Overcast";
  return [up, sky, `${weather.sun_strength_pct}% sunlight`];
}

// One line on what the recommended route buys you.
function headline(data) {
  if (data.mode === "lighting") return data.summary;
  const [f, r] = data.features.map((x) => x.properties);
  if (data.weather.sun_strength_pct === 0 || data.weather.sun_strength_pct < 25 || r.same_as_fastest) return data.summary;
  const saved = f.sun_min - r.sun_min;
  const savedText = saved >= 1 ? `${Math.round(saved)} fewer min` : `${Math.round(saved * 60)} fewer s`;
  return `Recommended: ${extraText(r.extra_s)} walk, ${savedText} in direct sun`;
}

export default function App() {
  const [night, setNight] = useState(() => store.get("sunscreen-night-mode", false));
  const toggleNight = (value) => { setNight(value); store.set("sunscreen-night-mode", value); };
  return <ThemeProvider night={night}><AppContent toggleNight={toggleNight} /></ThemeProvider>;
}

function AppContent({ toggleNight }) {
  const styles = useThemedStyles(createStyles);
  const { colors: { MAROON, surface, header: headerColor, onAccent, track }, night } = useTheme();
  const dimensions = useWindowDimensions();
  const wide = dimensions.width >= WIDE;
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
  const [expanded, setExpanded] = useState(false); // phone card: all three routes vs. just the selected one
  const [playing, setPlaying] = useState(false);
  const [cardHeight, setCardHeight] = useState(300);
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

  const nightSwitch = (
    <View style={styles.themeFooter}>
      <View style={{ flex: 1 }}>
        <Text style={styles.themeLabel}>☾  Night mode</Text>
        <Text style={styles.rowMeta}>{night ? "Route by streetlights" : "Route by shade"}</Text>
      </View>
      <Switch value={night} onValueChange={toggleNight} accessibilityLabel="Night mode"
        accessibilityHint="Switch between sun-affected and streetlight-affected routing"
        trackColor={{ false: track, true: MAROON }} thumbColor={night ? onAccent : surface}
        {...(Platform.OS === "web" ? { activeThumbColor: onAccent } : {})}
        ios_backgroundColor={track} />
      <Pressable onPress={() => { setPlaying(false); setSettingsOpen(true); }} style={styles.settingsButton}
        accessibilityRole="button" accessibilityLabel="Route settings" accessibilityHint="Adjust extra walking distance limits">
        <Text style={{ color: MAROON, fontSize: 23 }}>⚙</Text>
      </Pressable>
    </View>
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
      preview={preview} minutes={minutes} setPreview={setPreview} setTime={setTime}
      playing={playing} togglePlay={togglePlay} expanded={wide || expanded} setExpanded={wide ? null : setExpanded}
      limits={limits}
    />
  );
  const mapPane = (
    <>
      <RouteMap data={showRoutes && !stale ? data : null} selected={selected} bounds={area.bounds} picking={!!picking} onMapPress={onMapPress}
        places={mapPlaceCatalog} highlightedId={highlightedId}
        onPlacePress={place => { if (!picking && mapPlaceById[place.id]) { setPlaying(false); setHighlightedId(place.id); } }}
        onBackgroundPress={() => setHighlightedId(null)}
        from={from} to={to} onEndpointDragStart={() => { setPlaying(false); setHighlightedId(null); }} onEndpointDragEnd={onEndpointDragEnd} />
      {showRoutes && !stale && !picking && <Legend />}
      {picking && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Tap the map to set your {picking === "from" ? "start" : "destination"}</Text>
          <Pressable onPress={() => setPicking(null)} hitSlop={8}><Text style={styles.bannerCancel}>Cancel</Text></Pressable>
        </View>
      )}
    </>
  );
  const pickerSheet = picker && (
    <PlacePicker
      title={picker === "from" ? "Start" : "Destination"} places={area.places} bounds={area.bounds}
      recents={recents} here={here} onLocated={setHere}
      onSelect={(p) => choose(picker, p)} onClose={() => setPicker(null)}
      onPickOnMap={() => { setPicking(picker); setPicker(null); }}
    />
  );
  const header = <Header from={from} to={to} setPicker={setPicker} swap={() => { setFrom(to); setTo(from); }} onInfo={() => setAbout(true)} />;
  const settingsPanel = settingsOpen && <RouteSettings limits={limits} onApply={applyLimits} onClose={() => setSettingsOpen(false)} />;

  if (wide) {
    return (
      <View style={[styles.screen, { flexDirection: "row" }]}>
        <View style={styles.panel}>
          {header}
          <ScrollView contentContainerStyle={styles.panelBody}>{controls}</ScrollView>
          {nightSwitch}
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
      <StatusBar barStyle="light-content" backgroundColor={headerColor} />
      {header}
      {/* The map ends where the card starts (minus its rounded corner), so fits and limits use what is visible. */}
      <View style={[styles.map, { marginBottom: picking ? 0 : cardHeight - 20 }]}>{mapPane}</View>
      {!picking && (
        <View style={[styles.card, { maxHeight: Math.max(200, dimensions.height - 280) }]}
          onLayout={(e) => setCardHeight(e.nativeEvent.layout.height)}>
          <ScrollView style={{ flexGrow: 0 }} keyboardShouldPersistTaps="handled">{controls}</ScrollView>
          {nightSwitch}
        </View>
      )}
      {pickerSheet}
      {about && <About onClose={closeAbout} />}
      {settingsPanel}
    </View>
  );
}

function Header({ from, to, setPicker, swap, onInfo }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.header}>
      <View style={styles.brandRow}>
        <Image source={require("./assets/logo.png")} style={styles.logo} />
        <Text style={styles.brand}>SunScreen</Text>
        <Pressable onPress={onInfo} style={styles.info} hitSlop={8} accessibilityRole="button" accessibilityLabel="How SunScreen works">
          <Text style={styles.infoText}>ⓘ</Text>
        </Pressable>
      </View>
      <View style={styles.trip}>
        <View style={{ flex: 1 }}>
          <Endpoint label="From" place={from} onPress={() => setPicker("from")} />
          <View style={styles.tripDivider} />
          <Endpoint label="To" place={to} onPress={() => setPicker("to")} />
        </View>
        <Pressable onPress={swap} style={styles.swap} hitSlop={8} accessibilityLabel="Swap start and destination">
          <Text style={styles.swapText}>⇅</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Controls({ data, stale, status, selected, setSelected, preview, minutes, setPreview, setTime, playing, togglePlay, expanded, setExpanded, limits }) {
  const styles = useThemedStyles(createStyles);
  const { colors: { MAROON, track }, night } = useTheme();
  // Swipe the handle up/down (or tap it) to show all routes or just the selected one.
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 8,
    onPanResponderRelease: (_, g) => { if (g.dy < -20) setExpanded?.(true); else if (g.dy > 20) setExpanded?.(false); },
  })).current;
  const routes = data ? (expanded ? data.features : data.features.filter((f) => f.properties.id === selected)) : [];

  return (
    <View>
      {setExpanded && (
        <Pressable {...pan.panHandlers} onPress={() => setExpanded(!expanded)} style={styles.handleArea}
          accessibilityLabel={expanded ? "Show fewer routes" : "Compare all routes"}>
          <View style={styles.handle} />
        </Pressable>
      )}
      {night ? (
        <View style={{ paddingTop: 12, paddingBottom: 8 }}>
          <Text style={styles.time}>Streetlight routing</Text>
          <Text style={styles.rowMeta}>Prefer paths with mapped streetlights</Text>
        </View>
      ) : <>
      <View style={styles.timeRow}>
        <Text style={styles.time}>{clock(preview)}</Text>
        <View style={styles.timeButtons}>
          <SmallButton label={playing ? "❚❚ Pause" : "▶ Play day"} onPress={togglePlay} active={playing} />
          <SmallButton label="Now" onPress={() => setTime(nowMin())} />
        </View>
      </View>
      {data && (
        <View style={styles.pills}>
          {weatherPills(data).map((t) => <Text key={t} style={styles.pill}>{t}</Text>)}
          {status.loading && <ActivityIndicator size="small" color={MAROON} />}
        </View>
      )}
      <Slider
        accessibilityLabel="Time of day"
        minimumValue={FIRST} maximumValue={LAST} step={30} value={minutes}
        onValueChange={setPreview} onSlidingComplete={setTime}
        minimumTrackTintColor={MAROON} maximumTrackTintColor={track} thumbTintColor={MAROON}
      />
      <View style={styles.ticks}>
        {["7 AM", "11 AM", "3 PM", "8 PM"].map((t) => <Text key={t} style={styles.tick}>{t}</Text>)}
      </View>
      </>}

      {night && <CorpsEscort />}
      {night && data && <>
        <View style={styles.pills}>
          <Text style={styles.pill}>{data.lighting?.source ?? "OpenStreetMap"}</Text>
          <Text style={styles.pill}>{data.features[1]?.properties.lighting_status !== "available" ? "Limited coverage" : "Mapped + estimated"}</Text>
        </View>
        <Text style={[styles.rowMeta, { marginVertical: 8 }]}>Lamp proximity is estimated, not measured brightness or live outage status. Unmapped paths remain unknown.</Text>
      </>}

      {status.error && <Text style={styles.error} accessibilityLiveRegion="polite">{status.error}</Text>}
      {!defaultLimits(limits) && <Text style={[styles.rowMeta, { marginBottom: 6 }]}>Custom limits: Recommended +{limits.recommended_pct}%; {night ? "Most lit" : "Max shade"} +{limits.max_detour_pct}%.</Text>}
      {stale && <Skeleton rows={expanded ? 3 : 1} />}
      {data && <Text style={styles.headline}>{headline(data)}</Text>}
      {routes.map(({ properties: p }) => (
        <RouteRow key={p.id} p={p} active={p.id === selected} onPress={() => setSelected(p.id)} />
      ))}
      {data && setExpanded && (
        <Pressable onPress={() => setExpanded(!expanded)} hitSlop={6}>
          <Text style={styles.compare}>{expanded ? "Show less ▾" : `Compare all ${data.features.length} routes ▴`}</Text>
        </Pressable>
      )}
      {data && <Handoff data={data} selected={selected} />}
      {night && data && <Text style={[styles.rowMeta, { marginTop: 8 }]} accessibilityRole="link"
        onPress={() => open("https://www.openstreetmap.org/copyright")}>© OpenStreetMap contributors · ODbL{data.lighting?.retrieved_at ? ` · ${data.lighting.retrieved_at.slice(0, 10)}` : ""}</Text>}
      {night && data?.lighting?.sources?.length > 0 && <Text style={styles.rowMeta} accessibilityRole="link"
        onPress={() => open(`https://www.arcgis.com/home/item.html?id=${data.lighting.sources[0].item_id}`)}>Lamp locations: TAMU campus GIS · nighttime coverage is estimated</Text>}
      {status.offline && <Text style={styles.offline}>Offline: showing saved routes for The Commons → Zachry</Text>}
    </View>
  );
}

// Gray placeholders while routes load.
function Skeleton({ rows }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View accessibilityLabel="Loading routes">
      <View style={[styles.skelLine, { width: "70%" }]} />
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={[styles.row, styles.skelRow]}>
          <View style={[styles.skelLine, { width: "45%", marginBottom: 0 }]} />
          <View style={[styles.skelLine, { width: 48, height: 22, marginBottom: 0 }]} />
        </View>
      ))}
    </View>
  );
}

function SmallButton({ label, onPress, active }) {
  const styles = useThemedStyles(createStyles);
  const { colors: { onAccent } } = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.small, active && styles.smallActive]} accessibilityRole="button">
      <Text style={[styles.smallText, active && { color: onAccent }]}>{label}</Text>
    </Pressable>
  );
}

function Legend() {
  const styles = useThemedStyles(createStyles);
  const { colors: { MAROON, SUN }, night } = useTheme();
  return (
    <View style={styles.legend} pointerEvents="none">
      {night ? [[LIGHTING_COLORS.mapped, "Mapped lit"], [LIGHTING_COLORS.estimated, "Estimated"], [LIGHTING_COLORS.unknown, "Unknown"], [LIGHTING_COLORS.unlit, "Unlit / conflict"]].map(([color, label]) => (
        <View key={label} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <View style={[styles.legendSwatch, { backgroundColor: color }]} /><Text style={styles.legendText}>{label}</Text>
        </View>
      )) : <>
        <View style={[styles.legendSwatch, { backgroundColor: MAROON }]} /><Text style={styles.legendText}>Shade</Text>
        <View style={[styles.legendSwatch, { backgroundColor: SUN }]} /><Text style={styles.legendText}>Sun</Text>
      </>}
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

// Hand the selected route to a maps app for turn-by-turn directions.
function Handoff({ data, selected }) {
  const styles = useThemedStyles(createStyles);
  const feature = data.features.find((f) => f.properties.id === selected) ?? data.features[0];
  const buildings = feature.properties.via_buildings ?? [];
  return (
    <View>
      {buildings.length > 0 && <Text style={styles.rowMeta} accessibilityLiveRegion="polite">
        {feature.properties.access_unconfirmed ? "Check building access. " : ""}External maps may change covered sections.
      </Text>}
      <View style={styles.handoff}>
      <Pressable style={[styles.mapsButton, styles.mapsPrimary]} onPress={() => open(googleMapsUrl(feature, data.start, data.end))}
        accessibilityRole="link" accessibilityLabel={`Open the ${feature.properties.label.toLowerCase()} route in Google Maps`}>
        <Text style={styles.mapsPrimaryText}>Open in Google Maps</Text>
      </Pressable>
      <Pressable style={styles.mapsButton} onPress={() => open(appleMapsUrl(data.start, data.end))}
        accessibilityRole="link" accessibilityLabel="Open in Apple Maps">
        <Text style={styles.mapsText}>Apple Maps</Text>
      </Pressable>
      </View>
    </View>
  );
}

function RouteRow({ p, active, onPress }) {
  const styles = useThemedStyles(createStyles);
  const { colors: { MAROON }, routes: ROUTES } = useTheme();
  const extra = p.extra_s > 0 ? ` · ${extraText(p.extra_s)}` : "";
  const lighting = p.mode === "lighting";
  const style = ROUTES[p.id];
  return (
    <Pressable onPress={onPress} style={[styles.row, active && styles.rowActive]} accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${p.label}: ${p.time_min} minutes, ${lighting ? `${p.lit_pct} percent mapped or estimated lit, ${p.unknown_pct} percent unknown` : `${p.shaded_pct} percent shaded`}`}>
      <View style={[styles.swatch, { backgroundColor: style.color }, style.dash && styles.swatchDashed]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>
          {p.label}
          {p.id !== "fastest" && p.same_as_fastest && <Text style={styles.same}>  same route</Text>}
          {!p.same_as_fastest && p.same_as_recommended && <Text style={styles.same}>  same route</Text>}
        </Text>
        <Text style={styles.rowMeta}>{p.time_min} min · {p.distance_m} m{extra}</Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={[styles.shade, active && { color: MAROON }]}>{lighting ? p.lit_pct : p.shaded_pct}%</Text>
        <Text style={styles.rowMeta}>{lighting ? `lit evidence · ${p.unknown_pct}% unknown` : `shaded · ${p.sun_min} min sun`}</Text>
        {lighting && <Text style={styles.rowMeta}>{p.mapped_lit_pct}% mapped · {p.estimated_lit_pct}% est.</Text>}
      </View>
    </Pressable>
  );
}

const topInset = Platform.select({ ios: 50, android: (StatusBar.currentHeight ?? 24) + 6, default: 12 });

const createStyles = ({ INK, LINE, MAROON, MUTED, SUN, TINT, surface, header, onAccent, track, handle, skeleton, error, warning, overlay }) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: surface },
  header: { backgroundColor: header, paddingTop: topInset, paddingBottom: 12, paddingHorizontal: 16, gap: 10 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  logo: { width: 28, height: 28 },
  brand: { flex: 1, color: "#ffffff", fontSize: 20, fontWeight: "700", letterSpacing: 0.3 },
  info: { width: 44, height: 36, alignItems: "flex-end", justifyContent: "center" },
  infoText: { color: "#ffffff", fontSize: 22 },
  trip: { flexDirection: "row", alignItems: "center", backgroundColor: surface, borderRadius: 12, paddingLeft: 12 },
  tripDivider: { height: 1, backgroundColor: LINE },
  endpoint: { flexDirection: "row", alignItems: "center", paddingVertical: 10, gap: 10 },
  endpointLabel: { width: 36, color: MUTED, fontSize: 12, fontWeight: "600" },
  endpointName: { flex: 1, color: INK, fontSize: 15, fontWeight: "600" },
  swap: { width: 48, alignSelf: "stretch", alignItems: "center", justifyContent: "center" },
  swapText: { color: MAROON, fontSize: 22, fontWeight: "700" },
  map: { flex: 1 },
  panel: { width: 400, borderRightWidth: 1, borderRightColor: LINE, backgroundColor: surface },
  panelBody: { padding: 16 },
  themeFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: LINE, paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  themeLabel: { color: INK, fontSize: 14, fontWeight: "600" },
  settingsButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: LINE, borderRadius: 10 },
  banner: { position: "absolute", zIndex: 1000, top: 12, left: 12, right: 12, backgroundColor: MAROON, borderRadius: 12, padding: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  bannerText: { color: onAccent, fontWeight: "600", flex: 1 },
  bannerCancel: { color: onAccent, fontWeight: "600", marginLeft: 12 },
  legend: { position: "absolute", zIndex: 1000, top: 10, left: 10, maxWidth: "95%", flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, backgroundColor: overlay, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  legendSwatch: { width: 16, height: 5, borderRadius: 3 },
  legendText: { fontSize: 12, color: INK, marginRight: 6 },
  card: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingBottom: Platform.OS === "ios" ? 30 : 14, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 12, elevation: 12 },
  handleArea: { alignItems: "center", paddingTop: 8, paddingBottom: 6 },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: handle },
  timeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  time: { fontSize: 26, fontWeight: "700", color: MAROON },
  timeButtons: { flexDirection: "row", gap: 6 },
  small: { borderWidth: 1.5, borderColor: MAROON, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, minHeight: 34, justifyContent: "center" },
  smallActive: { backgroundColor: MAROON },
  smallText: { color: MAROON, fontWeight: "700", fontSize: 13 },
  pills: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 6 },
  pill: { backgroundColor: TINT, color: INK, fontSize: 12, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 10, overflow: "hidden" },
  ticks: { flexDirection: "row", justifyContent: "space-between", marginTop: -2, marginBottom: 6, paddingHorizontal: 4 },
  tick: { color: MUTED, fontSize: 12 },
  headline: { fontSize: 14, fontWeight: "600", color: INK, marginBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1.5, borderColor: LINE, marginBottom: 6, minHeight: 56 },
  rowActive: { borderColor: MAROON, backgroundColor: TINT },
  swatch: { width: 6, alignSelf: "stretch", borderRadius: 3 },
  swatchDashed: { opacity: 0.7 },
  rowTitle: { fontSize: 15, fontWeight: "600", color: INK },
  same: { fontSize: 12, fontWeight: "400", color: MUTED },
  rowMeta: { fontSize: 12, color: MUTED, marginTop: 1 },
  shade: { fontSize: 20, fontWeight: "700", color: INK },
  compare: { color: MAROON, fontWeight: "600", fontSize: 13, textAlign: "center", paddingVertical: 4 },
  handoff: { flexDirection: "row", gap: 8, marginTop: 8 },
  mapsButton: { flex: 1, borderRadius: 12, borderWidth: 1.5, borderColor: MAROON, paddingVertical: 11, alignItems: "center", minHeight: 44, justifyContent: "center" },
  mapsPrimary: { flex: 1.6, backgroundColor: MAROON },
  mapsPrimaryText: { color: onAccent, fontWeight: "700", fontSize: 14 },
  mapsText: { color: MAROON, fontWeight: "700", fontSize: 14 },
  skelRow: { justifyContent: "space-between", borderColor: LINE },
  skelLine: { height: 14, borderRadius: 7, backgroundColor: skeleton, marginBottom: 8 },
  error: { color: error, fontSize: 14, marginVertical: 8, textAlign: "center" },
  offline: { marginTop: 6, fontSize: 12, color: warning, textAlign: "center" },
});
