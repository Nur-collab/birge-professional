import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LngLatBounds, Map as MapLibreMap, Marker, NavigationControl, Popup, setWorkerUrl } from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { LocateFixed } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, tokenStorage } from '../utils/api';
import { escapeHtml } from '../utils/escapeHtml';
import './RealMap.css';

// Configure self-contained ESM worker asset so Vite/PWA/Capacitor builds resolve it from same-origin.
if (typeof setWorkerUrl === 'function' && maplibreWorkerUrl) {
  setWorkerUrl(maplibreWorkerUrl);
}

const BISHKEK_CENTER_LAT_LNG = [42.8746, 74.5698];
const STYLE_LIGHT_URL = 'https://tiles.openfreemap.org/styles/liberty';
const STYLE_DARK_URL = 'https://tiles.openfreemap.org/styles/dark';
const ROUTE_SOURCE_ID = 'birge-route-source';
const ROUTE_CASING_LAYER_ID = 'birge-route-casing';
const ROUTE_LINE_LAYER_ID = 'birge-route-line';
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

function toLngLat(latLng) {
  return [latLng[1], latLng[0]];
}

function isDarkThemeActive() {
  return typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark';
}

function supportsWebGL() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (window.__BIRGE_FORCE_WEBGL_MAP__ === true) return true;
  if (typeof WebGLRenderingContext === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function buildPinElement(fill, label) {
  const wrapper = document.createElement('div');
  wrapper.className = 'birge-map-pin-el';
  wrapper.innerHTML = `<svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="14" cy="14" r="11" fill="${fill}" stroke="#ffffff" stroke-width="3" />
    <text x="14" y="18" text-anchor="middle" fill="#ffffff" font-size="11" font-weight="800" font-family="system-ui,sans-serif">${escapeHtml(label)}</text>
  </svg>`;
  return wrapper;
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
  zoomPosition = 'top-right',
  fitPaddingTopLeft = DEFAULT_FIT_TOP_LEFT,
  fitPaddingBottomRight = DEFAULT_FIT_BOTTOM_RIGHT,
  isOverlayPreview = false,
  onRouteInfo,
}) {
  const { t } = useTranslation();
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const userMarkerRef = useRef(null);
  const routeMarkersRef = useRef([]);
  const routeDrawStateRef = useRef(null);
  const boundsCoordsRef = useRef(null);
  const appliedThemeRef = useRef(null);
  const onRouteInfoRef = useRef(onRouteInfo);
  const [userLocation, setUserLocation] = useState(null);
  const [routeMeta, setRouteMeta] = useState(null);
  const [isDark, setIsDark] = useState(isDarkThemeActive);

  const resolvedZoomPos = zoomPosition === 'topright' ? 'top-right' : zoomPosition === 'topleft' ? 'top-left' : zoomPosition;

  useEffect(() => {
    onRouteInfoRef.current = onRouteInfo;
  }, [onRouteInfo]);

  useEffect(() => {
    if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return undefined;
    const observer = new MutationObserver(() => {
      setIsDark(isDarkThemeActive());
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!navigator?.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserLocation([pos.coords.latitude, pos.coords.longitude]),
      () => {},
      { timeout: 5000 }
    );
  }, []);

  const fitCurrentBounds = useCallback((duration = 250) => {
    const map = mapRef.current;
    const coords = boundsCoordsRef.current;
    if (!map || !Array.isArray(coords) || coords.length === 0) return;

    const bounds = coords.reduce(
      (acc, lngLat) => acc.extend(lngLat),
      new LngLatBounds(coords[0], coords[0])
    );
    try {
      map.resize();
    } catch {
      // Ignore layout measurement edge cases in detached containers.
    }
    map.fitBounds(bounds, {
      padding: {
        top: fitPaddingTopLeft[1] ?? 36,
        left: fitPaddingTopLeft[0] ?? 28,
        bottom: fitPaddingBottomRight[1] ?? 28,
        right: fitPaddingBottomRight[0] ?? 28,
      },
      maxZoom: 15,
      duration,
    });
  }, [fitPaddingTopLeft, fitPaddingBottomRight]);

  const applyRouteOnMap = useCallback((map, state) => {
    if (!map || !state) return;

    routeMarkersRef.current.forEach((m) => m.remove());
    routeMarkersRef.current = [];

    if (showUserOnly) {
      boundsCoordsRef.current = null;
      return;
    }

    const { aCoords, bCoords, preview, fromLabel, toLabel, fromPrefix, toPrefix } = state;
    const rawGeometry = Array.isArray(preview?.geometry) && preview.geometry.length >= 2
      ? preview.geometry
      : [aCoords, bCoords];
    const lineCoords = rawGeometry.map(toLngLat);
    const isEstimated = !preview || preview.source !== 'osrm';
    const showLine = !isEstimated || showFallbackRoute;

    const applyGeoJson = () => {
      if (!mapRef.current) return;
      const geojson = {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: showLine ? lineCoords : [],
        },
      };

      const existingSource = map.getSource(ROUTE_SOURCE_ID);
      if (existingSource) {
        existingSource.setData(geojson);
      } else {
        map.addSource(ROUTE_SOURCE_ID, { type: 'geojson', data: geojson });
        map.addLayer({
          id: ROUTE_CASING_LAYER_ID,
          type: 'line',
          source: ROUTE_SOURCE_ID,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#ffffff',
            'line-width': isEstimated ? 6 : 8,
            'line-opacity': isEstimated ? 0.55 : 0.9,
          },
        });
        map.addLayer({
          id: ROUTE_LINE_LAYER_ID,
          type: 'line',
          source: ROUTE_SOURCE_ID,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#0F6B57',
            'line-width': isEstimated ? 3.5 : 5,
            'line-opacity': isEstimated ? 0.72 : 0.96,
            ...(isEstimated ? { 'line-dasharray': [2, 2] } : {}),
          },
        });
      }
    };

    if (map.isStyleLoaded?.()) {
      applyGeoJson();
    } else {
      map.once('style.load', applyGeoJson);
    }

    const markerA = new Marker({ element: buildPinElement('#0F6B57', 'A') })
      .setLngLat(toLngLat(aCoords))
      .setPopup(new Popup({ offset: 18 }).setHTML(`<b>${escapeHtml(fromPrefix)}:</b> ${escapeHtml(fromLabel)}`))
      .addTo(map);

    const markerB = new Marker({ element: buildPinElement('#dc2626', 'B') })
      .setLngLat(toLngLat(bCoords))
      .setPopup(new Popup({ offset: 18 }).setHTML(`<b>${escapeHtml(toPrefix)}:</b> ${escapeHtml(toLabel)}`))
      .addTo(map);

    routeMarkersRef.current = [markerA, markerB];
    boundsCoordsRef.current = lineCoords;
  }, [showUserOnly, showFallbackRoute]);

  // Initialize MapLibre GL map once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current || !supportsWebGL()) return;

    const initialDark = isDarkThemeActive();
    let map;
    try {
      map = new MapLibreMap({
        container: el,
        style: initialDark ? STYLE_DARK_URL : STYLE_LIGHT_URL,
        center: toLngLat(BISHKEK_CENTER_LAT_LNG),
        zoom: 12,
        attributionControl: { compact: true },
        pitchWithRotate: false,
        dragRotate: false,
      });
      map.addControl(new NavigationControl({ showCompass: false }), resolvedZoomPos);
    } catch {
      return;
    }

    appliedThemeRef.current = initialDark;

    map.on('style.load', () => {
      if (routeDrawStateRef.current) {
        applyRouteOnMap(map, routeDrawStateRef.current);
      }
    });

    mapRef.current = map;

    return () => {
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      routeMarkersRef.current.forEach((m) => m.remove());
      routeMarkersRef.current = [];
      appliedThemeRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [resolvedZoomPos, applyRouteOnMap]);

  // Switch light/dark vector style only when theme actually toggles.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || appliedThemeRef.current === isDark) return;
    appliedThemeRef.current = isDark;
    map.setStyle(isDark ? STYLE_DARK_URL : STYLE_LIGHT_URL);
  }, [isDark]);

  // Isolated user GPS marker update: never resets route polyline or triggers route-preview API.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !userLocation) return;

    const lngLat = toLngLat(userLocation);
    if (userMarkerRef.current) {
      userMarkerRef.current.setLngLat(lngLat);
    } else {
      const dot = document.createElement('div');
      dot.className = 'birge-map-user-dot';
      dot.setAttribute('aria-label', t('map.you_here'));
      userMarkerRef.current = new Marker({ element: dot })
        .setLngLat(lngLat)
        .addTo(map);
    }

    if (showUserOnly) {
      map.jumpTo({ center: lngLat, zoom: 13 });
    }
  }, [userLocation, showUserOnly, t]);

  // Resolve route preview and draw markers/polyline (independent of userLocation).
  useEffect(() => {
    let cancelled = false;

    const updateRouteState = (aCoords, bCoords, preview, duration = 0) => {
      if (cancelled) return;
      const state = {
        aCoords,
        bCoords,
        preview,
        fromLabel: from || '—',
        toLabel: to || '—',
        fromPrefix: t('search.from'),
        toPrefix: t('search.to'),
      };
      routeDrawStateRef.current = state;
      if (mapRef.current) {
        applyRouteOnMap(mapRef.current, state);
        fitCurrentBounds(duration);
      }
    };

    if (showUserOnly) {
      setRouteMeta(null);
      onRouteInfoRef.current?.(null);
      return;
    }

    const initialFrom = fromCoords || geocodeOffline(from) || [42.8500, 74.5600];
    const initialTo = toCoords || geocodeOffline(to) || BISHKEK_CENTER_LAT_LNG;
    const offlinePreview = estimateOfflineRoute(initialFrom, initialTo);
    updateRouteState(initialFrom, initialTo, offlinePreview, 0);

    if ((!from && !fromCoords) || (!to && !toCoords)) {
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
        updateRouteState(resolvedA, resolvedB, remote, 0);
        setRouteMeta(remote);
        onRouteInfoRef.current?.(remote);
      })
      .catch(() => {
        // Offline fallback route is already displayed.
      });

    return () => {
      cancelled = true;
    };
  }, [from, to, fromCoords, toCoords, showUserOnly, applyRouteOnMap, fitCurrentBounds, t]);

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
          onClick={() => fitCurrentBounds(250)}
          aria-label={t('map.recenter')}
          title={t('map.recenter')}
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
