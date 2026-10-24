import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { routeRuns } from "./theme";
import { useTheme } from "./ThemeContext";

const TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}";

export default function RouteMap({ data, selected, bounds, picking, onMapPress, layoutKey }) {
  const { night, colors: { MAROON, surface, INK, LINE }, routes: ROUTES } = useTheme();
  const el = useRef(null);
  const map = useRef(null);
  const press = useRef(null);
  press.current = picking ? onMapPress : null;
  const lastFit = useRef(null);
  const fittedTrip = useRef(null);
  const lock = useRef(() => {});

  useEffect(() => {
    const area = L.latLngBounds([bounds.south, bounds.west], [bounds.north, bounds.east]);
    const instance = L.map(el.current, { zoomControl: false, attributionControl: false, maxBoundsViscosity: 1 });
    map.current = instance;
    L.control.attribution({ position: "bottomleft", prefix: false }).addTo(instance);
    L.tileLayer(TILES, { maxNativeZoom: 16, maxZoom: 19,
      attribution: "Tiles &copy; Esri, &copy; OpenStreetMap contributors" }).addTo(instance);
    lock.current = () => {
      if (map.current !== instance) return;
      instance.invalidateSize();
      instance.setMinZoom(0);
      instance.setMinZoom(instance.getBoundsZoom(area));
      instance.setMaxBounds(area.pad(0.03));
      if (lastFit.current) instance.fitBounds(lastFit.current, {
        paddingTopLeft: [30, 70], paddingBottomRight: [30, 40], maxZoom: 18, animate: false,
      });
    };
    const observer = new ResizeObserver(() => lock.current());
    observer.observe(el.current);
    instance.fitBounds(area);
    lock.current();
    instance.on("click", (e) => press.current?.({ lat: e.latlng.lat, lon: e.latlng.lng }));
    return () => {
      observer.disconnect();
      lock.current = () => {};
      map.current = null;
      lastFit.current = null;
      fittedTrip.current = null;
      instance.remove();
    };
  }, [bounds]);

  useEffect(() => { if (el.current) el.current.style.cursor = picking ? "crosshair" : ""; }, [picking]);
  useEffect(() => {
    const timer = setTimeout(() => lock.current(), 50);
    return () => clearTimeout(timer);
  }, [layoutKey]);

  useEffect(() => {
    if (!data || !map.current) return;
    const layers = L.layerGroup().addTo(map.current);
    const ordered = data.features.filter((f) => f.properties.id !== selected)
      .concat(data.features.filter((f) => f.properties.id === selected));
    const toLL = (coords) => coords.map(([lon, lat]) => [lat, lon]);
    const lines = ordered.map((f) => {
      const style = ROUTES[f.properties.id];
      const latlngs = toLL(f.geometry.coordinates);
      if (f.properties.id !== selected) {
        if (style.outline) L.polyline(latlngs, { color: style.outline, weight: 6, opacity: 0.5 }).addTo(layers);
        return L.polyline(latlngs, { color: style.color, weight: style.outline ? 3 : 4,
          opacity: style.dash ? 0.9 : 0.6, dashArray: style.dash?.join(" ") }).addTo(layers);
      }
      // Selected route: casing, then each run colored by shade (day) or lighting coverage (night).
      const casing = L.polyline(latlngs, { color: surface, weight: 12 }).addTo(layers);
      for (const run of routeRuns(f, style.color)) L.polyline(toLL(run.coords), {
        color: run.color, weight: 7, lineCap: "butt",
      }).addTo(layers);
      return casing;
    });
    const path = data.features[0].geometry.coordinates;
    for (const [p, [lon, lat]] of [[data.start, path[0]], [data.end, path[path.length - 1]]]) {
      L.polyline([[p.lat, p.lon], [lat, lon]], { color: MAROON, weight: 3, dashArray: "2 6", opacity: 0.8 }).addTo(layers);
    }
    const pin = (p, fill) => {
      // Names may come from address search; bind DOM text, never raw HTML.
      const label = document.createElement("span");
      label.textContent = p.name;
      return L.circleMarker([p.lat, p.lon], { radius: 8, color: MAROON, weight: 3, fillColor: fill, fillOpacity: 1 })
        .bindTooltip(label, { permanent: true, direction: "top", offset: [0, -8], className: "pin-label" }).addTo(layers);
    };
    pin(data.start, surface);
    pin(data.end, MAROON);
    const trip = [data.start.lat, data.start.lon, data.end.lat, data.end.lon].join();
    if (trip !== fittedTrip.current) {
      fittedTrip.current = trip;
      lastFit.current = L.featureGroup(lines).getBounds().extend([data.start, data.end].map((p) => [p.lat, p.lon]));
      lock.current();
    }
    return () => layers.remove();
  }, [data, selected, ROUTES, MAROON, surface]);

  return <>
    <style>{`.sunscreen-map .pin-label{background:${surface};color:${INK};border:1px solid ${LINE};font:600 12px system-ui;box-shadow:0 1px 4px rgba(0,0,0,.25)}.sunscreen-map .leaflet-tooltip-top:before{border-top-color:${surface}}.sunscreen-map .leaflet-control-attribution{background:${surface};color:${INK};font-size:9px!important;opacity:.85}.sunscreen-map .leaflet-control-attribution a{color:${MAROON}}.sunscreen-map .leaflet-tile-pane{filter:${night ? "invert(1) hue-rotate(180deg) brightness(.8)" : "none"}}`}</style>
    <div ref={el} className="sunscreen-map" aria-label="Campus walking routes"
      style={{ position: "absolute", inset: 0, background: night ? "#22252a" : "#ddd", colorScheme: night ? "dark" : "light" }} />
  </>;
}
