import React, { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { LocateFixed } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, tokenStorage } from '../utils/api';
import { escapeHtml } from '../utils/escapeHtml';
import './RealMap.css';

const BISHKEK_CENTER = [42.8746, 74.5698];
const PRIMARY_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const FALLBACK_TILE_URL = 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png';
const DEFAULT_FIT_TOP_LEFT = [28, 36];
const DEFAULT_FIT_BOTTOM_RIGHT = [28, 28];

const BISHKEK_LOCATIONS = {
  'ала-арча': [42.8380, 74.5520],
  'ала арча': [42.8380, 74.5520],
  'аламедин': [42.8835, 74.6335],
  'джал': [42.8425, 74.5620],
  'кара-жыгач': [42.8650, 74.5050],
  'кара жыгач': [42.8650, 74.5050],
  'асанбай': [42.8240, 74.6305],
  'тунгуч': [42.8575, 74.6870],
  'восток-5': [42.8752, 74.6378],
  'восток 5': [42.8752, 74.6378],
  'мкр 7': [42.8315, 74.6160],
  'мкр. 7': [42.8315, 74.6160],
  'ак-өргө': [42.8570, 74.5170],
  'ак-орго': [42.8570, 74.5170],
  'орто-сай': [42.8390, 74.6145],
  'южная магистраль': [42.8285, 74.5970],
  'политех': [42.8495, 74.5872],
  'бгу': [42.8495, 74.5872],
  'asia mall': [42.8554, 74.5858],
  'вефа': [42.8575, 74.6095],
  'цум': [42.8760, 74.6140],
  'центр': [42.8746, 74.5698],
  'площадь': [42.8762, 74.6036],
  'ала-тоо': [42.8762, 74.6036],
  'ошский базар': [42.8758, 74.5705],
  'ошский': [42.8758, 74.5705],
  'дордой': [42.9330, 74.6225],
  'кудайберген': [42.8935, 74.5445],
  'манас': [43.0613, 74.4776],
  'аэропорт': [43.0613, 74.4776],
  'западный автовокзал': [42.8855, 74.5485],
  'восточный автовокзал': [42.8860, 74.6395],
  'кант': [42.8910, 74.8505],
  'токмок': [42.8419, 75.3015],
  'сокулук': [42.8569, 74.2940],
  'кара-балта': [42.8140, 73.8481],
};

function geocodeOffline(locationStr) {
  if (!locationStr) return null;
  const lower = String(locationStr).toLowerCase().trim();
  for (const [key, coords] of Object.entries(BISHKEK_LOCATIONS)) {
    if (lower.includes(key)) return coords;
  }
  return null;
}

function estimateOfflineRoute(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  const straightKm = 6371 * 2 * Math.asin(Math.sqrt(h));
  const roadKm = Math.round(Math.max(0.4, straightKm * 1.35) * 10) / 10;
  const etaMinutes = Math.max(3, Math.round((roadKm / 26) * 60));
  return {
    distance_km: roadKm,
    eta_minutes: etaMinutes,
    geometry: [a, b],
    source: 'offline_fallback',
  };
}

function createPinIcon(fill, label) {
  return L.divIcon({
    className: 'birge-map-pin',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: `<svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="14" cy="14" r="11" fill="${fill}" stroke="#ffffff" stroke-width="3" />
      <text x="14" y="18" text-anchor="middle" fill="#ffffff" font-size="11" font-weight="800" font-family="system-ui,sans-serif">${escapeHtml(label)}</text>
    </svg>`,
  });
}

export default function RealMap({
  from,
  to,
  fromCoords = null,
  toCoords = null,
  height = '250px',
  showUserOnly = false,
  borderRadius = '12px',
  framed = true,
  showLegend = true,
  showEtaPill = true,
  showFallbackRoute = true,
  zoomPosition = 'topright',
  fitPaddingTopLeft = DEFAULT_FIT_TOP_LEFT,
  fitPaddingBottomRight = DEFAULT_FIT_BOTTOM_RIGHT,
  isOverlayPreview = false,
  onRouteInfo,
}) {
  const { t } = useTranslation();
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerGroupRef = useRef(null);
  const boundsRef = useRef(null);
  const onRouteInfoRef = useRef(onRouteInfo);
  const [userLocation, setUserLocation] = useState(null);
  const [routeMeta, setRouteMeta] = useState(null);

  useEffect(() => {
    onRouteInfoRef.current = onRouteInfo;
  }, [onRouteInfo]);

  useEffect(() => {
    if (!navigator?.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserLocation([pos.coords.latitude, pos.coords.longitude]),
      () => {},
      { timeout: 5000 }
    );
  }, []);

  const fitCurrentBounds = useCallback(() => {
    const map = mapRef.current;
    const bounds = boundsRef.current;
    if (!map || !bounds || !bounds.isValid()) return;
    try {
      map.invalidateSize(false);
    } catch {
      // Ignore layout measurement issues inside detached containers.
    }
    map.fitBounds(bounds, {
      paddingTopLeft: fitPaddingTopLeft,
      paddingBottomRight: fitPaddingBottomRight,
      maxZoom: 15,
    });
  }, [fitPaddingTopLeft, fitPaddingBottomRight]);

  // Initialize Leaflet instance once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    const map = L.map(el, {
      center: BISHKEK_CENTER,
      zoom: 12,
      zoomControl: false,
      attributionControl: true,
    });

    L.control.zoom({ position: zoomPosition }).addTo(map);
    const primaryLayer = L.tileLayer(PRIMARY_TILE_URL, {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);

    // Switch automatically to OSM HOT tiles if the primary tile server fails.
    primaryLayer.once('tileerror', () => {
      if (!mapRef.current) return;
      map.removeLayer(primaryLayer);
      L.tileLayer(FALLBACK_TILE_URL, {
        attribution: '&copy; OpenStreetMap HOT',
        maxZoom: 19,
        subdomains: 'abc',
      }).addTo(map);
    });

    const group = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerGroupRef.current = group;

    return () => {
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
    };
  }, [zoomPosition]);

  // Resolve route preview + update Leaflet markers and polyline.
  useEffect(() => {
    let cancelled = false;
    const map = mapRef.current;
    const group = layerGroupRef.current;
    if (!map || !group) return;

    const drawState = (aCoords, bCoords, preview) => {
      if (cancelled || !mapRef.current || !layerGroupRef.current) return;
      group.clearLayers();

      if (userLocation) {
        L.circleMarker(userLocation, {
          radius: 7,
          fillColor: '#3b82f6',
          color: '#ffffff',
          weight: 2,
          fillOpacity: 0.95,
        })
          .bindPopup(escapeHtml(t('map.you_here')))
          .addTo(group);
      }

      if (showUserOnly) {
        map.setView(userLocation || BISHKEK_CENTER, 13);
        boundsRef.current = null;
        return;
      }

      const geometry = Array.isArray(preview?.geometry) && preview.geometry.length >= 2
        ? preview.geometry
        : [aCoords, bCoords];
      const isEstimated = !preview || preview.source !== 'osrm';

      if (!isEstimated || showFallbackRoute) {
        L.polyline(geometry, {
          color: '#0F6B57',
          weight: isEstimated ? 4 : 5,
          opacity: isEstimated ? 0.65 : 0.94,
          dashArray: isEstimated ? '7 6' : undefined,
        }).addTo(group);
      }

      L.marker(aCoords, { icon: createPinIcon('#0F6B57', 'A') })
        .bindPopup(`<b>${escapeHtml(t('search.from'))}:</b> ${escapeHtml(from || '—')}`)
        .addTo(group);

      L.marker(bCoords, { icon: createPinIcon('#dc2626', 'B') })
        .bindPopup(`<b>${escapeHtml(t('search.to'))}:</b> ${escapeHtml(to || '—')}`)
        .addTo(group);

      boundsRef.current = L.latLngBounds(geometry);
      fitCurrentBounds();
    };

    const initialFrom = fromCoords || geocodeOffline(from) || [42.8500, 74.5600];
    const initialTo = toCoords || geocodeOffline(to) || BISHKEK_CENTER;
    const offlinePreview = estimateOfflineRoute(initialFrom, initialTo);
    drawState(initialFrom, initialTo, offlinePreview);

    if (showUserOnly || (!from && !fromCoords) || (!to && !toCoords)) {
      setRouteMeta(null);
      onRouteInfoRef.current?.(null);
      return;
    }

    setRouteMeta(offlinePreview);
    onRouteInfoRef.current?.(offlinePreview);

    if (!tokenStorage.get() || typeof api.getRoutePreview !== 'function') {
      return;
    }

    api
      .getRoutePreview({
        origin: from,
        destination: to,
        origin_lat: fromCoords?.[0],
        origin_lng: fromCoords?.[1],
        dest_lat: toCoords?.[0],
        dest_lng: toCoords?.[1],
      })
      .then((remote) => {
        if (cancelled || !remote) return;
        const resolvedA = [remote.origin_lat, remote.origin_lng];
        const resolvedB = [remote.dest_lat, remote.dest_lng];
        drawState(resolvedA, resolvedB, remote);
        setRouteMeta(remote);
        onRouteInfoRef.current?.(remote);
      })
      .catch(() => {
        // Offline fallback route is already drawn cleanly.
      });

    return () => {
      cancelled = true;
    };
  }, [from, to, fromCoords, toCoords, showUserOnly, showFallbackRoute, userLocation, fitCurrentBounds, t]);

  return (
    <div
      className="birge-real-map-wrap"
      style={{
        height,
        borderRadius,
        border: framed ? '1px solid var(--border-subtle)' : 'none',
      }}
    >
      <div className="birge-real-map-canvas" ref={containerRef} />

      {!showUserOnly && showEtaPill && routeMeta && (
        <div className="birge-map-eta-pill" aria-label={t('map.eta_aria')}>
          <span>
            {t('map.eta_badge', {
              distance: routeMeta.distance_km,
              minutes: routeMeta.eta_minutes,
            })}
          </span>
        </div>
      )}

      {!showUserOnly && (
        <button
          type="button"
          className={`birge-map-recenter-btn ${isOverlayPreview ? 'in-preview' : ''}`}
          onClick={fitCurrentBounds}
          aria-label={t('map.recenter')}
          title={t('map.recenter')}
          style={!isOverlayPreview ? { top: 92 } : undefined}
        >
          <LocateFixed size={16} aria-hidden="true" />
        </button>
      )}

      {!showUserOnly && showLegend && (
        <div className="birge-map-legend">
          <div className="birge-map-legend-row">
            <div className="birge-map-legend-dot" style={{ background: 'var(--primary)' }} />
            <span className="birge-map-legend-text">{from || t('map.origin_missing')}</span>
          </div>
          <div className="birge-map-legend-row">
            <div className="birge-map-legend-dot" style={{ background: 'var(--danger)' }} />
            <span className="birge-map-legend-text">{to || t('map.dest_missing')}</span>
          </div>
        </div>
      )}
    </div>
  );
}
