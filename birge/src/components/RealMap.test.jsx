import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import '../i18n';
import RealMap from './RealMap';

describe('RealMap (Leaflet)', () => {
  test('renders offline fallback route, ETA pill, recenter button, and legend', () => {
    const onRouteInfo = vi.fn();
    const { container, unmount } = render(
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
    expect(container.querySelector('.leaflet-tile-pane')).toBeInTheDocument();
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
});
