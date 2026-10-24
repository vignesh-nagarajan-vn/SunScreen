import { useEffect, useRef } from "react";
import { MAROON, ROUTES } from "./theme";

// Browser version of RouteMap: react-native-maps has no web support, so use Leaflet from a CDN.
const LEAFLET = "https://unpkg.com/leaflet@1.9.4/dist/leaflet";
const TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}";
let leaflet;
function loadLeaflet() {
  leaflet ??= new Promise((resolve) => {
    const css = Object.assign(document.createElement("link"), { rel: "stylesheet", href: `${LEAFLET}.css` });
    const js = Object.assign(document.createElement("script"), { src: `${LEAFLET}.js`, onload: () => resolve(window.L) });
    document.head.append(css, js);
  });
  return leaflet;
}

export default function RouteMap({ data, selected, bottomInset, bounds, picking, onMapPress }) {
  const el = useRef(null);
  const map = useRef(null);
  const press = useRef(onMapPress);
  press.current = picking ? onMapPress : null;

  // Create the map once, locked to the campus area: no panning or zooming out past it.
  useEffect(() => {
    loadLeaflet().then((L) => {
      const area = L.latLngBounds([bounds.south, bounds.west], [bounds.north, bounds.east]);
      map.current = L.map(el.current, { zoomControl: false, attributionControl: false, maxBounds: area.pad(0.05), maxBoundsViscosity: 1 });
      L.control.attribution({ position: "topright", prefix: false }).addTo(map.current);
      L.tileLayer(TILES, { maxNativeZoom: 16, maxZoom: 19, attribution: "Tiles © Esri, © OpenStreetMap contributors" })
        .addTo(map.current);
      const lockZoom = () => {
        map.current.invalidateSize();
        map.current.setMinZoom(map.current.getBoundsZoom(area, true));
      };
      // The container has no size until React Native Web lays it out.
      new ResizeObserver(lockZoom).observe(el.current);
      lockZoom();
      map.current.fitBounds(area);
      map.current.on("click", (e) => press.current?.({ lat: e.latlng.lat, lon: e.latlng.lng }));
    });
  }, []);

  useEffect(() => {
    if (el.current) el.current.style.cursor = picking ? "crosshair" : "";
  }, [picking]);

  useEffect(() => {
    if (!data) return;
    let layers;
    loadLeaflet().then((L) => {
      if (!map.current) return;
      layers = L.layerGroup().addTo(map.current);
      const ordered = data.features.filter((f) => f.properties.id !== selected)
        .concat(data.features.filter((f) => f.properties.id === selected));
      const lines = ordered.map((f) => {
        const on = f.properties.id === selected;
        const latlngs = f.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
        if (on) L.polyline(latlngs, { color: "white", weight: 11, opacity: 1 }).addTo(layers);
        return L.polyline(latlngs, {
          color: ROUTES[f.properties.id].color, weight: on ? 7 : 4, opacity: on ? 1 : 0.55,
        }).addTo(layers);
      });
      // Routes start and end at the nearest footpath node; dash the last few metres to each point.
      const path = data.features[0].geometry.coordinates;
      for (const [p, [lon, lat]] of [[data.start, path[0]], [data.end, path[path.length - 1]]]) {
        L.polyline([[p.lat, p.lon], [lat, lon]], { color: MAROON, weight: 3, dashArray: "2 6", opacity: 0.8 }).addTo(layers);
      }
      const pin = (p, fill) =>
        L.circleMarker([p.lat, p.lon], { radius: 8, color: MAROON, weight: 3, fillColor: fill, fillOpacity: 1 })
          .bindTooltip(p.name, { permanent: true, direction: "top", offset: [0, -8], className: "pin-label" })
          .addTo(layers);
      pin(data.start, "white");
      pin(data.end, MAROON);
      map.current.invalidateSize();
      map.current.fitBounds(L.featureGroup(lines).getBounds(), {
        paddingTopLeft: [40, 60], paddingBottomRight: [40, bottomInset + 20], maxZoom: 18,
      });
    });
    return () => layers?.remove();
  }, [data, selected, bottomInset]);

  return (
    <>
      <style>{`.pin-label{background:white;color:${MAROON};border:none;font:600 12px system-ui;box-shadow:0 1px 4px rgba(0,0,0,.25)}`}</style>
      <div ref={el} style={{ position: "absolute", inset: 0 }} />
    </>
  );
}
