import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import '../i18n';
import RealMap from './RealMap';

const mockState = vi.hoisted(() => ({
  mapCalls: [],
  addSource: vi.fn(),
  addLayer: vi.fn(),
  fitBounds: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('maplibre-gl', async () => {
  const actual = await vi.importActual('maplibre-gl');
  function MockMap(options) {
    mockState.mapCalls.push(options);
    return {
      addControl: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      isStyleLoaded: vi.fn(() => true),
      getSource: vi.fn(() => null),
      addSource: mockState.addSource,
      addLayer: mockState.addLayer,
      setStyle: vi.fn(),
      resize: vi.fn(),
      fitBounds: mockState.fitBounds,
      jumpTo: vi.fn(),
      remove: mockState.remove,
    };
  }
  function MockNav() {
    return {};
  }
  function MockMarker() {
    return {
      setLngLat: vi.fn().mockReturnThis(),
      setPopup: vi.fn().mockReturnThis(),
      addTo: vi.fn().mockReturnThis(),
      remove: vi.fn(),
    };
  }
  function MockPopup() {
    return { setHTML: vi.fn().mockReturnThis() };
  }
  return {
    ...actual,
    Map: MockMap,
    NavigationControl: MockNav,
    Marker: MockMarker,
    Popup: MockPopup,
    setWorkerUrl: vi.fn(),
  };
});

describe('RealMap (MapLibre GL)', () => {
  beforeEach(() => {
    mockState.mapCalls = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete window.__BIRGE_FORCE_WEBGL_MAP__;
  });

  test('renders offline fallback route, ETA pill, recenter button, and legend when WebGL is unavailable', () => {
    const onRouteInfo = vi.fn();
    const { unmount } = render(
      <RealMap
        from="мкр. Асанбай"
        to="ЦУМ (Центр)"
        onRouteInfo={onRouteInfo}
      />
    );

    expect(screen.getByLabelText('Расстояние и время в пути')).toHaveTextContent(/км.*мин/);
    const recenterBtn = screen.getByRole('button', { name: 'Показать весь маршрут' });
    fireEvent.click(recenterBtn);
    expect(screen.getByText('мкр. Асанбай')).toBeInTheDocument();
    expect(screen.getByText('ЦУМ (Центр)')).toBeInTheDocument();
    expect(onRouteInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        distance_km: expect.any(Number),
        eta_minutes: expect.any(Number),
      })
    );

    unmount();
  });

  test('hides ETA pill in full-screen preview mode when showEtaPill=false', () => {
    const { unmount } = render(
      <RealMap
        from="мкр. Асанбай"
        to="ЦУМ (Центр)"
        showLegend={false}
        showEtaPill={false}
        isOverlayPreview={true}
      />
    );

    expect(screen.queryByLabelText('Расстояние и время в пути')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Показать весь маршрут' })).toHaveClass('in-preview');
    unmount();
  });

  test('initializes MapLibre Map with OpenFreeMap style and converts [lat, lng] to [lng, lat]', () => {
    window.__BIRGE_FORCE_WEBGL_MAP__ = true;

    const { unmount } = render(
      <RealMap
        from="мкр. Асанбай"
        to="ЦУМ (Центр)"
        showLegend={false}
        showEtaPill={false}
        isOverlayPreview={true}
      />
    );

    expect(mockState.mapCalls[0]).toEqual(
      expect.objectContaining({
        style: 'https://tiles.openfreemap.org/styles/liberty',
        center: [74.5698, 42.8746],
      })
    );
    expect(mockState.addSource).toHaveBeenCalledWith(
      'birge-route-source',
      expect.objectContaining({
        type: 'geojson',
        data: expect.objectContaining({
          geometry: expect.objectContaining({
            coordinates: [[74.6305, 42.824], [74.614, 42.876]],
          }),
        }),
      })
    );
    expect(mockState.addLayer).toHaveBeenCalledTimes(2);
    expect(mockState.fitBounds).toHaveBeenCalled();

    unmount();
    expect(mockState.remove).toHaveBeenCalledTimes(1);
  });
});
