import { useEffect, useRef } from "react";
import { Platform, StyleSheet } from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import { MAROON, ROUTES } from "./theme";

const toLatLng = (f) => f.geometry.coordinates.map(([longitude, latitude]) => ({ latitude, longitude }));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Native map (Expo Go). RouteMap.web.js is the browser version.
export default function RouteMap({ data, selected, bounds, picking, onMapPress }) {
  const map = useRef(null);
  const area = {
    latitude: (bounds.south + bounds.north) / 2,
    longitude: (bounds.west + bounds.east) / 2,
    latitudeDelta: bounds.north - bounds.south,
    longitudeDelta: bounds.east - bounds.west,
  };

  const fit = () => data && map.current?.fitToCoordinates(data.features.flatMap(toLatLng), {
    edgePadding: { top: 40, left: 40, right: 40, bottom: 40 },
    animated: true,
  });
  useEffect(() => { fit(); }, [data]);

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

  const ordered = data ? data.features.filter((f) => f.properties.id !== selected)
    .concat(data.features.filter((f) => f.properties.id === selected)) : [];
  const path = data ? toLatLng(data.features[0]) : [];

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
    >
      {ordered.map((f) => {
        const on = f.properties.id === selected;
        return (
          <Polyline
            key={f.properties.id}
            coordinates={toLatLng(f)}
            strokeColor={on ? ROUTES[f.properties.id].color : ROUTES[f.properties.id].color + "88"}
            strokeWidth={on ? 7 : 4}
          />
        );
      })}
      {data && (
        <>
          {/* Routes start and end at the nearest footpath node; dash the last few metres to each point. */}
          {[[data.start, path[0]], [data.end, path[path.length - 1]]].map(([p, q], i) => (
            <Polyline key={i} coordinates={[{ latitude: p.lat, longitude: p.lon }, q]} strokeColor={MAROON} strokeWidth={3} lineDashPattern={[2, 6]} />
          ))}
          <Marker coordinate={{ latitude: data.start.lat, longitude: data.start.lon }} title={data.start.name} pinColor="white" />
          <Marker coordinate={{ latitude: data.end.lat, longitude: data.end.lon }} title={data.end.name} pinColor={MAROON} />
        </>
      )}
    </MapView>
  );
}
