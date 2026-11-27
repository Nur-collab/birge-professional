import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import '../i18n';
import RealMap from './RealMap';

describe('RealMap (Leaflet)', () => {
  test('renders offline fallback route, ETA pill, and legend', () => {
    const onRouteInfo = vi.fn();
    const { unmount } = render(
      <RealMap
        from="мкр. Асанбай"
        to="ЦУМ (Центр)"
        onRouteInfo={onRouteInfo}
      />
    );

    expect(screen.getByLabelText('Расстояние и время в пути')).toHaveTextContent(/км.*мин/);
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
});
