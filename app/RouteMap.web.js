import { useEffect, useRef } from "react";
import { MAROON, ROUTES, shadeColor, shadeRuns } from "./theme";

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

export default function RouteMap({ data, selected, bounds, picking, onMapPress }) {
  const el = useRef(null);
  const map = useRef(null);
  const press = useRef(onMapPress);
  press.current = picking ? onMapPress : null;
  const lastFit = useRef(null); // bounds of the latest trip, refit on resize
  const fittedTrip = useRef(null);
  const lock = useRef(() => {});

  // Create the map once, locked to the campus area: no panning or zooming out past it.
  useEffect(() => {
    loadLeaflet().then((L) => {
      const area = L.latLngBounds([bounds.south, bounds.west], [bounds.north, bounds.east]);
      map.current = L.map(el.current, { zoomControl: false, attributionControl: false, maxBoundsViscosity: 1 });
      L.control.attribution({ position: "bottomleft", prefix: false }).addTo(map.current);
      L.tileLayer(TILES, { maxNativeZoom: 16, maxZoom: 19, attribution: "Tiles © Esri, © OpenStreetMap contributors" })
        .addTo(map.current);
      // Widest zoom = the whole area on screen; panning stops at its edges.
      lock.current = () => {
        const m = map.current;
        m.invalidateSize();
        m.setMinZoom(m.getBoundsZoom(area));
        m.setMaxBounds(area.pad(0.03));
        if (lastFit.current) m.fitBounds(lastFit.current, { paddingTopLeft: [30, 70], paddingBottomRight: [30, 40], maxZoom: 18, animate: false });
      };
      // The container has no size until React Native Web lays it out.
      new ResizeObserver(() => lock.current()).observe(el.current);
      map.current.fitBounds(area);
      lock.current();
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
      const toLL = (coords) => coords.map(([lon, lat]) => [lat, lon]);
      const lines = ordered.map((f) => {
        const style = ROUTES[f.properties.id];
        const latlngs = toLL(f.geometry.coordinates);
        if (f.properties.id !== selected) {
          if (style.outline) L.polyline(latlngs, { color: style.outline, weight: 6, opacity: 0.5 }).addTo(layers);
          return L.polyline(latlngs, {
            color: style.color, weight: style.outline ? 3 : 4, opacity: style.dash ? 0.9 : 0.6, dashArray: style.dash?.join(" "),
          }).addTo(layers);
        }
        // Selected route: white casing, then each edge colored from shade (route color) to sun (gold).
        const casing = L.polyline(latlngs, { color: "white", weight: 12, opacity: 1 }).addTo(layers);
        for (const run of shadeRuns(f)) {
          L.polyline(toLL(run.coords), { color: shadeColor(style.color, run.shade), weight: 7, opacity: 1, lineCap: "butt" }).addTo(layers);
        }
        return casing;
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
      // Refit only when the trip changes, not when the time or selected route does.
      const trip = [data.start.lat, data.start.lon, data.end.lat, data.end.lon].join();
      if (trip !== fittedTrip.current) {
        fittedTrip.current = trip;
        lastFit.current = L.featureGroup(lines).getBounds().extend([data.start, data.end].map((p) => [p.lat, p.lon]));
        lock.current();
      }
    });
    return () => layers?.remove();
  }, [data, selected]);

  return (
    <>
      <style>{`.pin-label{background:white;color:${MAROON};border:none;font:600 12px system-ui;box-shadow:0 1px 4px rgba(0,0,0,.25)}.leaflet-control-attribution{font-size:9px!important;opacity:.75}`}</style>
      <div ref={el} style={{ position: "absolute", inset: 0 }} />
    </>
  );
}
