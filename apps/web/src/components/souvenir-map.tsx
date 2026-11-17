// EX-51 / D-166: Leaflet maps of the souvenirs. Tiles come through Mémento (/api/v1/map/tiles, CSP img-src
// 'self'); markers are HTML (divIcon), never remote images. One point per place, clustered when zoomed out.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import { useEffect, useRef } from 'react';

export interface MapPoint {
  key: string;
  lat: number;
  lng: number;
  /** Shown in the pin (the number of souvenirs at that place); empty = a small dot. */
  label?: string;
  title: string;
  color?: string;
}

const TILES = '/api/v1/map/tiles/{z}/{x}/{y}';
const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function SouvenirLeaflet({
  points,
  home,
  radiusM,
  onSelect,
  cluster = true,
  className = 'souvenir-map',
  height,
  route,
}: {
  points: MapPoint[];
  home?: { lat: number; lng: number } | null;
  /** « Rayon de vie »: a dashed circle around the home. */
  radiusM?: number | null;
  onSelect?: (key: string) => void;
  cluster?: boolean;
  className?: string;
  height?: number;
  /** Mini-map « parcours » of a souvenir: the photo positions, joined in time order. */
  route?: { lat: number; lng: number }[];
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const select = useRef(onSelect);
  select.current = onSelect;

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { scrollWheelZoom: false, attributionControl: true });
    L.tileLayer(TILES, { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    layer.current?.remove();
    const group = cluster
      ? L.markerClusterGroup({
          showCoverageOnHover: false,
          iconCreateFunction: (c) =>
            L.divIcon({
              className: '',
              html: `<div class="map-pin" style="background:var(--text)">${c.getChildCount()}</div>`,
              iconSize: [30, 30],
              iconAnchor: [15, 15],
            }),
        })
      : L.layerGroup();
    const bounds: L.LatLngExpression[] = [];
    if (route && route.length > 1)
      L.polyline(
        route.map((p) => [p.lat, p.lng] as L.LatLngTuple),
        { color: '#6b4fd8', weight: 2, opacity: 0.6, dashArray: '4 4' },
      ).addTo(group);
    for (const p of points) {
      const icon = L.divIcon({
        className: '',
        html: p.label
          ? `<div class="map-pin" style="${p.color ? `background:${p.color}` : ''}">${esc(p.label)}</div>`
          : `<div class="map-pin" style="min-width:14px;height:14px;padding:0;${p.color ? `background:${p.color}` : ''}"></div>`,
        iconSize: p.label ? [26, 26] : [14, 14],
        iconAnchor: p.label ? [13, 13] : [7, 7],
      });
      const marker = L.marker([p.lat, p.lng], { icon, title: p.title, keyboard: true });
      marker.on('click', () => select.current?.(p.key));
      marker.addTo(group);
      bounds.push([p.lat, p.lng]);
    }
    if (home) {
      L.circleMarker([home.lat, home.lng], { radius: 5, color: '#2f6fdb', weight: 2, fillOpacity: 0.8 })
        .bindTooltip('Domicile')
        .addTo(group);
      if (radiusM)
        L.circle([home.lat, home.lng], {
          radius: radiusM,
          color: '#2f6fdb',
          weight: 1,
          fillOpacity: 0.04,
          dashArray: '4 4',
        })
          .bindTooltip('Rayon de vie (80 % des souvenirs)')
          .addTo(group);
      if (!bounds.length) bounds.push([home.lat, home.lng]);
    }
    group.addTo(m);
    layer.current = group;
    if (bounds.length === 1) m.setView(bounds[0], 14);
    else if (bounds.length) m.fitBounds(L.latLngBounds(bounds), { padding: [30, 30], maxZoom: 15 });
    else m.setView([46.6, 2.4], 5);
  }, [points, home, radiusM, cluster, route]);

  return <div ref={el} className={className} style={height ? { height } : undefined} />;
}
