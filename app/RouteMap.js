import { useEffect, useRef } from "react";
import { Platform, StyleSheet, View } from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import { routeRuns } from "./theme";
import { useTheme, useThemedStyles } from "./ThemeContext";

const toLatLng = (coords) => coords.map(([longitude, latitude]) => ({ latitude, longitude }));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Native map (Expo Go). RouteMap.web.js is the browser version.
export default function RouteMap({ data, selected, bounds, picking, onMapPress }) {
  const styles = useThemedStyles(createStyles);
  const { colors: { MAROON, surface }, routes: ROUTES, night } = useTheme();
  const map = useRef(null);
  const fittedTrip = useRef(null);
  const area = {
    latitude: (bounds.south + bounds.north) / 2,
    longitude: (bounds.west + bounds.east) / 2,
    latitudeDelta: bounds.north - bounds.south,
    longitudeDelta: bounds.east - bounds.west,
  };

  const fit = () => data && map.current?.fitToCoordinates(data.features.flatMap((f) => toLatLng(f.geometry.coordinates)), {
    edgePadding: { top: 60, left: 40, right: 40, bottom: 40 },
    animated: true,
  });
  // Refit only when the trip changes, not when the time or selected route does.
  useEffect(() => {
    if (!data) return;
    const trip = [data.start.lat, data.start.lon, data.end.lat, data.end.lon].join();
    if (trip !== fittedTrip.current) { fittedTrip.current = trip; fit(); }
  }, [data]);

  const onReady = () => {
    // Google Maps (Android) can hard-limit panning; elsewhere onRegionChangeComplete snaps back.
    if (Platform.OS === "android") {
      map.current?.setMapBoundaries({ latitude: bounds.north, longitude: bounds.east }, { latitude: bounds.south, longitude: bounds.west });
    }
    fit();
  };

  // Keep the view inside the campus area: no zooming out past it or panning away from it.
  const keepInside = (r) => {
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

  return (
    <MapView
      ref={map}
      style={StyleSheet.absoluteFill}
      initialRegion={area}
      minZoomLevel={13.5}
      onMapReady={onReady}
      onLayout={fit}
      onRegionChangeComplete={keepInside}
      onPress={(e) => picking && onMapPress({ lat: e.nativeEvent.coordinate.latitude, lon: e.nativeEvent.coordinate.longitude })}
      toolbarEnabled={false}
      userInterfaceStyle={night ? "dark" : "light"}
    >
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
          <Marker coordinate={{ latitude: data.start.lat, longitude: data.start.lon }} title={data.start.name} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={[styles.pin, styles.pinStart]} />
          </Marker>
          <Marker coordinate={{ latitude: data.end.lat, longitude: data.end.lon }} title={data.end.name} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={[styles.pin, styles.pinEnd]} />
          </Marker>
        </>
      )}
    </MapView>
  );
}

const createStyles = ({ INK, LINE, MAROON, MUTED, SUN, TINT, surface, header, onAccent, track, handle, skeleton, error, warning, overlay }) => StyleSheet.create({
  pin: { width: 18, height: 18, borderRadius: 9, borderWidth: 3, borderColor: MAROON },
  pinStart: { backgroundColor: surface },
  pinEnd: { backgroundColor: MAROON, borderColor: surface },
});
