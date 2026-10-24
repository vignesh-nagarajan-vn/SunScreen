import { useEffect, useRef } from "react";
import { StyleSheet } from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import { MAROON, ROUTES } from "./theme";

const toLatLng = (f) => f.geometry.coordinates.map(([longitude, latitude]) => ({ latitude, longitude }));

// Native map (Expo Go). RouteMap.web.js is the browser version.
export default function RouteMap({ data, selected, bottomInset }) {
  const map = useRef(null);
  const { start, end } = data;
  const path = toLatLng(data.features[0]);
  const ends = [path[0], path[path.length - 1]];
  const drawOrder = data.features.filter((f) => f.properties.id !== selected)
    .concat(data.features.filter((f) => f.properties.id === selected));

  const fit = () =>
    map.current?.fitToCoordinates(data.features.flatMap(toLatLng), {
      edgePadding: { top: 40, left: 40, right: 40, bottom: bottomInset + 20 },
      animated: false,
    });
  useEffect(() => { fit(); }, [bottomInset]);

  return (
    <MapView
      ref={map}
      onMapReady={fit}
      style={StyleSheet.absoluteFill}
      initialRegion={{
        latitude: (start.lat + end.lat) / 2,
        longitude: (start.lon + end.lon) / 2,
        latitudeDelta: 0.012,
        longitudeDelta: 0.012,
      }}
    >
      {drawOrder.map((f) => {
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
      {/* Routes start and end at the nearest footpath node; dash the last few metres to each building. */}
      {[[start, ends[0]], [end, ends[1]]].map(([p, q], i) => (
        <Polyline key={i} coordinates={[{ latitude: p.lat, longitude: p.lon }, q]} strokeColor={MAROON} strokeWidth={3} lineDashPattern={[2, 6]} />
      ))}
      <Marker coordinate={{ latitude: start.lat, longitude: start.lon }} title="The Commons" pinColor="white" />
      <Marker coordinate={{ latitude: end.lat, longitude: end.lon }} title="Zachry" pinColor={MAROON} />
    </MapView>
  );
}
