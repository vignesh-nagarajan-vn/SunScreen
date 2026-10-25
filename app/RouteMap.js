import { useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import { routeRuns } from "./theme";
import { useTheme, useThemedStyles } from "./ThemeContext";
import { endpointReservations, markerWidth, PLACE_KINDS, projectRegion, visibleMapPlaces } from "./mapPlaces";
import { routeFitKey } from "./viewGeometry";

const toLatLng = (coords) => coords.map(([longitude, latitude]) => ({ latitude, longitude }));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Native map (Expo Go). RouteMap.web.js is the browser version.
// `insets` keeps fitted routes clear of panels floating over the map ({ top, right, bottom } in px).
export default function RouteMap({ data, selected, bounds, picking, onMapPress, insets, from, to, onEndpointDragStart, onEndpointDragEnd,
  places = [], highlightedId, onPlacePress, onBackgroundPress }) {
  const styles = useThemedStyles(createStyles);
  const { colors: { MAROON, surface }, routes: ROUTES, night } = useTheme();
  const map = useRef(null);
  const fittedTrip = useRef(null);
  const draggedTrip = useRef(null);
  const ready = useRef(false);
  const latest = useRef(null);
  const [pinRevision, setPinRevision] = useState(0);
  const [viewRegion, setViewRegion] = useState(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  latest.current = { data, insets, size };
  const finishDrag = (which, e) => {
    const { latitude: lat, longitude: lon } = e.nativeEvent.coordinate;
    if (onEndpointDragEnd(which, { lat, lon }) === false) {
      // Remount rejected pins so the native map restores their controlled coordinates.
      setPinRevision(v => v + 1);
      return;
    }
    const a = which === "from" ? { lat, lon } : from;
    const b = which === "to" ? { lat, lon } : to;
    draggedTrip.current = [a.lat, a.lon, b.lat, b.lon].map(v => v.toFixed(5)).join();
  };
  const area = {
    latitude: (bounds.south + bounds.north) / 2,
    longitude: (bounds.west + bounds.east) / 2,
    latitudeDelta: bounds.north - bounds.south,
    longitudeDelta: bounds.east - bounds.west,
  };

  const fit = () => {
    const { data: route, insets: padding, size: layout } = latest.current;
    const trip = routeFitKey(route, ready.current, layout, fittedTrip.current);
    if (!trip || !map.current) return;
    if (trip === draggedTrip.current) { fittedTrip.current = trip; return; }
    const animated = fittedTrip.current !== null;
    map.current.fitToCoordinates([
      ...route.features.flatMap(f => toLatLng(f.geometry.coordinates)),
      ...[route.start, route.end].map(p => ({ latitude: p.lat, longitude: p.lon })),
    ], {
      edgePadding: { top: padding?.top ?? 60, left: 40, right: padding?.right ?? 40, bottom: padding?.bottom ?? 40 },
      animated,
    });
    fittedTrip.current = trip;
  };
  // Refit only when the trip changes, not when the time or selected route does.
  useEffect(() => {
    fit();
  }, [data]);

  const onReady = () => {
    ready.current = true;
    // Google Maps (Android) can hard-limit panning; elsewhere onRegionChangeComplete snaps back.
    if (Platform.OS === "android") {
      map.current?.setMapBoundaries({ latitude: bounds.north, longitude: bounds.east }, { latitude: bounds.south, longitude: bounds.west });
    }
    fit();
  };

  // Keep the view inside the campus area: no zooming out past it or panning away from it.
  const keepInside = (r, details) => {
    setViewRegion(r);
    // Google Maps already enforces its camera bounds. A second JS correction
    // fights route fitting and can repeatedly snap the camera after layout changes.
    if (Platform.OS === "android" || details?.isGesture === false) return;
    const latitudeDelta = Math.min(r.latitudeDelta, area.latitudeDelta);
    const longitudeDelta = Math.min(r.longitudeDelta, area.longitudeDelta);
    const latitude = clamp(r.latitude, bounds.south + latitudeDelta / 2, bounds.north - latitudeDelta / 2);
    const longitude = clamp(r.longitude, bounds.west + longitudeDelta / 2, bounds.east - longitudeDelta / 2);
    const moved = Math.abs(latitude - r.latitude) > 1e-6 || Math.abs(longitude - r.longitude) > 1e-6;
    if (moved || latitudeDelta < r.latitudeDelta) map.current?.animateToRegion({ latitude, longitude, latitudeDelta, longitudeDelta }, 200);
  };

  const others = data ? data.features.filter((f) => f.properties.id !== selected) : [];
  const chosen = data?.features.find((f) => f.properties.id === selected);
  const path = data ? toLatLng(data.features[0].geometry.coordinates) : [];
  const region = viewRegion ?? area;
  const project = p => projectRegion(p, region, size);
  const shown = picking ? [] : visibleMapPlaces(places, { project,
    zoom: Math.log2(360 * Math.max(1, size.width) / (256 * region.longitudeDelta)), ...size,
    excludedIds: [from.id, to.id], reserved: endpointReservations([from, to], project), selectedId: highlightedId });
  const inspect = (e, place) => {
    e.stopPropagation?.();
    if (!picking && place.id) onPlacePress?.(place);
  };

  return (
    <MapView
      provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
      ref={map}
      style={StyleSheet.absoluteFill}
      initialRegion={area}
      minZoomLevel={13.5}
      onMapReady={onReady}
      onLayout={e => {
        const layout = e.nativeEvent.layout;
        latest.current.size = layout;
        setSize(layout);
        fit();
      }}
      onRegionChangeComplete={keepInside}
      onPress={e => {
        if (e.nativeEvent.action?.includes("marker")) return;
        if (picking) onMapPress({ lat: e.nativeEvent.coordinate.latitude, lon: e.nativeEvent.coordinate.longitude });
        else onBackgroundPress?.();
      }}
      toolbarEnabled={false}
      userInterfaceStyle={night ? "dark" : "light"}
    >
      {shown.map(p => <Marker key={`place-${p.id}`} coordinate={{ latitude: p.lat, longitude: p.lon }}
        anchor={{ x: 10 / markerWidth(p), y: 0.5 }} zIndex={highlightedId === p.id ? 100 : -500}
        accessible accessibilityRole="button" accessibilityLabel={`About ${p.name}`}
        accessibilityState={{ selected: highlightedId === p.id }} onPress={e => inspect(e, p)}>
        <View style={[styles.placeHit, { width: markerWidth(p) }]}>
          <View style={[styles.placeLabel, highlightedId === p.id && styles.placeSelected]}>
            <Text style={[styles.placeSymbol, { backgroundColor: PLACE_KINDS[p.kind].color }]}>{PLACE_KINDS[p.kind].symbol}</Text>
            <Text numberOfLines={1} style={styles.placeName}>{p.label}</Text>
          </View>
        </View>
      </Marker>)}
      {others.map((f) => {
        const style = ROUTES[f.properties.id];
        return (
          <Polyline
            key={f.properties.id}
            coordinates={toLatLng(f.geometry.coordinates)}
            strokeColor={style.dash ? style.color : style.color + "99"}
            strokeWidth={style.outline ? 3 : 4}
            lineDashPattern={style.dash}
          />
        );
      })}
      {/* Selected route: white casing, then each edge colored from shade (route color) to sun (gold). */}
      {chosen && <Polyline coordinates={toLatLng(chosen.geometry.coordinates)} strokeColor={surface} strokeWidth={11} />}
      {chosen && routeRuns(chosen, ROUTES[selected].color).map((run, i) => (
        <Polyline key={`run${i}`} coordinates={toLatLng(run.coords)} strokeColor={run.color} strokeWidth={7} />
      ))}
      {data && (
        <>
          {/* Routes start and end at the nearest footpath node; dash the last few metres to each point. */}
          {[[data.start, path[0]], [data.end, path[path.length - 1]]].map(([p, q], i) => (
            <Polyline key={i} coordinates={[{ latitude: p.lat, longitude: p.lon }, q]} strokeColor={MAROON} strokeWidth={3} lineDashPattern={[2, 6]} />
          ))}
        </>
      )}
      {[["from", from, styles.pinStart], ["to", to, styles.pinEnd]].map(([which, p, style]) => (
        <Marker key={`${which}-${pinRevision}`} coordinate={{ latitude: p.lat, longitude: p.lon }}
          zIndex={1000} onPress={e => inspect(e, p)}
          title={p.name} accessibilityLabel={which === "from" ? "Drag start" : "Drag destination"}
          anchor={{ x: 0.5, y: 0.5 }} draggable onDragStart={onEndpointDragStart}
          onDragEnd={e => finishDrag(which, e)}>
          <View style={[styles.pin, style]} />
        </Marker>
      ))}
    </MapView>
  );
}

const createStyles = ({ INK, LINE, MAROON, MUTED, SUN, TINT, surface, header, onAccent, track, handle, skeleton, error, warning, overlay }) => StyleSheet.create({
  pin: { width: 18, height: 18, borderRadius: 9, borderWidth: 3, borderColor: MAROON },
  pinStart: { backgroundColor: surface },
  pinEnd: { backgroundColor: MAROON, borderColor: surface },
  placeHit: { height: 44, justifyContent: "center" },
  placeLabel: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 3, paddingLeft: 3, paddingRight: 7,
    borderRadius: 16, backgroundColor: surface, borderColor: LINE, borderWidth: 1 },
  placeSelected: { borderColor: MAROON, borderWidth: 2 },
  placeSymbol: { width: 19, height: 19, borderRadius: 10, color: "#ffffff", textAlign: "center", fontSize: 12 },
  placeName: { flexShrink: 1, color: INK, fontSize: 11, fontWeight: "600" },
});
