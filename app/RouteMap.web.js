import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { routeRuns } from "./theme";
import { useTheme } from "./ThemeContext";
import { endpointReservations, markerWidth, PLACE_KINDS, visibleMapPlaces } from "./mapPlaces";

const TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}";

// `insets` keeps fitted routes clear of panels floating over the map ({ top, right, bottom } in px).
export default function RouteMap({ data, selected, bounds, picking, onMapPress, insets, from, to, onEndpointDragStart, onEndpointDragEnd,
  places = [], highlightedId, onPlacePress, onBackgroundPress }) {
  const { night, colors: { MAROON, surface, card, INK, LINE }, routes: ROUTES } = useTheme();
  const el = useRef(null);
  const map = useRef(null);
  const press = useRef(null);
  press.current = picking ? onMapPress : null;
  const highlights = useRef(null);
  highlights.current = { highlightedId, onPlacePress, onBackgroundPress };
  const refreshPlaces = useRef(() => {});
  const drag = useRef(null);
  drag.current = { onEndpointDragStart, onEndpointDragEnd };
  const draggedTrip = useRef(null);
  const lastFit = useRef(null);
  const fittedTrip = useRef(null);
  const lock = useRef(() => {});
  const pad = useRef(insets);
  pad.current = insets;

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
      if (lastFit.current && !highlights.current.highlightedId) instance.fitBounds(lastFit.current, {
        paddingTopLeft: [30, pad.current?.top ?? 70], paddingBottomRight: [pad.current?.right ?? 30, pad.current?.bottom ?? 40], maxZoom: 18, animate: false,
      });
    };
    // Actual size changes drive layout. A delayed refit on picker state changes
    // can otherwise override a zoom/pan that the user has just made.
    const observer = new ResizeObserver(() => lock.current());
    observer.observe(el.current);
    instance.fitBounds(area);
    lock.current();
    instance.on("click", (e) => {
      if (press.current) press.current({ lat: e.latlng.lat, lon: e.latlng.lng });
      else highlights.current.onBackgroundPress?.();
    });
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
    const instance = map.current;
    if (!instance || picking) return;
    const layer = L.layerGroup().addTo(instance);
    const markers = new Map();
    const update = () => {
      const { x: width, y: height } = instance.getSize();
      const project = p => instance.latLngToContainerPoint([p.lat, p.lon]);
      const shown = visibleMapPlaces(places, { project, zoom: instance.getZoom(), width, height,
        excludedIds: [from.id, to.id], reserved: endpointReservations([from, to], project), selectedId: highlights.current.highlightedId });
      const ids = new Set(shown.map(p => p.id));
      for (const [id, marker] of markers) if (!ids.has(id)) { layer.removeLayer(marker); markers.delete(id); }
      for (const p of shown) {
        if (!markers.has(p.id)) {
          const chip = document.createElement("span"); chip.className = "place-label";
          const icon = document.createElement("span"); icon.className = "place-symbol";
          icon.textContent = PLACE_KINDS[p.kind].symbol; icon.style.background = PLACE_KINDS[p.kind].color;
          const text = document.createElement("span"); text.className = "place-name"; text.textContent = p.label;
          chip.append(icon, text);
          const marker = L.marker([p.lat, p.lon], { title: `About ${p.name}`, keyboard: true, bubblingMouseEvents: false,
            icon: L.divIcon({ html: chip, className: "place-marker", iconSize: [markerWidth(p), 44], iconAnchor: [10, 22] }), zIndexOffset: -500 })
            .on("click", () => highlights.current.onPlacePress?.(p)).addTo(layer);
          marker.getElement().setAttribute("aria-label", `About ${p.name}`);
          marker.getElement().dataset.placeId = p.id;
          marker.on("keydown", e => {
            if (e.originalEvent.key === "Enter" || e.originalEvent.key === " ") {
              L.DomEvent.stop(e.originalEvent);
              highlights.current.onPlacePress?.(p);
            }
          });
          markers.set(p.id, marker);
        }
        const active = p.id === highlights.current.highlightedId;
        markers.get(p.id).getElement().classList.toggle("place-selected", active);
        markers.get(p.id).getElement().setAttribute("aria-pressed", String(active));
      }
    };
    refreshPlaces.current = update;
    instance.on("moveend zoomend resize", update);
    update();
    return () => { instance.off("moveend zoomend resize", update); refreshPlaces.current = () => {}; layer.remove(); };
  }, [places, bounds, picking, from, to]);
  useEffect(() => { refreshPlaces.current(); }, [highlightedId]);

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
    const trip = [data.start.lat, data.start.lon, data.end.lat, data.end.lon].map(v => v.toFixed(5)).join();
    lastFit.current = L.featureGroup(lines).getBounds().extend([data.start, data.end].map((p) => [p.lat, p.lon]));
    if (trip !== fittedTrip.current) {
      fittedTrip.current = trip;
      if (trip !== draggedTrip.current) lock.current();
    }
    return () => layers.remove();
  }, [data, selected, ROUTES, MAROON, surface]);

  // Pins belong to the requested trip, even while routes load or a drop cannot be routed.
  useEffect(() => {
    if (!map.current) return;
    const layers = L.layerGroup().addTo(map.current);
    for (const [which, p, fill] of [["from", from, surface], ["to", to, MAROON]]) {
      const dot = document.createElement("div");
      Object.assign(dot.style, { width: "20px", height: "20px", borderRadius: "50%", background: fill,
        border: `3px solid ${MAROON}`, boxSizing: "border-box", margin: "6px" });
      const label = document.createElement("span");
      label.textContent = p.name;
      const marker = L.marker([p.lat, p.lon], {
        draggable: true, autoPan: true, bubblingMouseEvents: false,
        title: which === "from" ? "Drag start" : "Drag destination",
        alt: which === "from" ? "Drag start" : "Drag destination",
        icon: L.divIcon({ html: dot, className: "endpoint-pin", iconSize: [32, 32], iconAnchor: [16, 16] }),
      }).bindTooltip(label, { permanent: true, direction: "top", offset: [0, -12], className: "pin-label" }).addTo(layers);
      marker.on("click", () => { if (!press.current && p.id) highlights.current.onPlacePress?.(p); });
      marker.on("keydown", e => {
        if (e.originalEvent.key === "Enter" || e.originalEvent.key === " ") {
          L.DomEvent.stop(e.originalEvent);
          if (!press.current && p.id) highlights.current.onPlacePress?.(p);
        }
      });
      marker.on("dragstart", () => drag.current.onEndpointDragStart?.());
      marker.on("dragend", () => {
        const { lat, lng: lon } = marker.getLatLng();
        if (drag.current.onEndpointDragEnd(which, { lat, lon }) === false) {
          marker.setLatLng([p.lat, p.lon]);
          return;
        }
        const a = which === "from" ? { lat, lon } : from;
        const b = which === "to" ? { lat, lon } : to;
        draggedTrip.current = [a.lat, a.lon, b.lat, b.lon].map(v => v.toFixed(5)).join();
      });
    }
    return () => layers.remove();
  }, [from, to, MAROON, surface, bounds]);

  return <>
    <style>{`.sunscreen-map .pin-label{background:${card};color:${MAROON};border:0;border-radius:10px;padding:5px 10px;font:700 12px system-ui;box-shadow:0 2px 8px rgba(0,0,0,.18)}.sunscreen-map .leaflet-tooltip-top:before{display:none}.sunscreen-map .leaflet-control-attribution{background:${surface};color:${INK};font-size:9px!important;opacity:.85}.sunscreen-map .leaflet-control-attribution a{color:${MAROON}}.sunscreen-map .leaflet-tile-pane{filter:${night ? "invert(1) hue-rotate(180deg) brightness(.8)" : "none"}}`}</style>
    <style>{`.sunscreen-map .place-marker{display:flex;align-items:center;border:0;background:none;font:600 11px system-ui;outline-offset:-3px}.sunscreen-map .place-label{display:flex;align-items:center;gap:5px;max-width:100%;padding:3px 7px 3px 3px;box-sizing:border-box;border-radius:16px;border:1px solid ${LINE};background:${surface};color:${INK};box-shadow:0 1px 3px #0002;pointer-events:none}.sunscreen-map .place-symbol{width:19px;height:19px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:12px;flex-shrink:0}.sunscreen-map .place-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sunscreen-map .place-selected .place-label,.sunscreen-map .place-marker:focus-visible .place-label{outline:2px solid ${MAROON};outline-offset:2px}.sunscreen-map .place-marker:hover .place-label{border-color:${MAROON}}`}</style>
    <div ref={el} className="sunscreen-map" aria-label="Campus walking routes"
      style={{ position: "absolute", inset: 0, background: night ? "#22252a" : "#ddd", colorScheme: night ? "dark" : "light" }} />
  </>;
}
