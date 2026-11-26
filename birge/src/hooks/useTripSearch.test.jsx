import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import useTripSearch from './useTripSearch';
import { api } from '../utils/api';

vi.mock('../utils/api', () => ({
  api: {
    createTrip: vi.fn(),
    findMatches: vi.fn(),
    cancelTrip: vi.fn(),
  },
}));

describe('useTripSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('stops loading and notifies when findMatches fails', async () => {
    const setActiveTab = vi.fn();
    const showNotification = vi.fn();
    api.createTrip.mockResolvedValue({ id: 101 });
    api.findMatches.mockRejectedValue(new Error('Сеть недоступна'));

    const { result } = renderHook(() =>
      useTripSearch({
        currentUser: { id: 1, name: 'Test' },
        setCurrentUser: vi.fn(),
        setActiveTrip: vi.fn(),
        setActiveTab,
        showNotification,
      }),
    );

    await act(async () => {
      await result.current.handleSearch({
        role: 'passenger',
        from: 'Джал',
        to: 'ЦУМ',
        time: '09:00',
        date: '2026-12-01',
        seats: 1,
        price: 0,
      });
    });

    expect(result.current.isSearching).toBe(false);
    expect(setActiveTab).toHaveBeenLastCalledWith('home');
    expect(showNotification).toHaveBeenCalledWith('Ошибка', 'Сеть недоступна');
  });

  test('maps seats and seats_taken from findMatches response', async () => {
    const showNotification = vi.fn();
    api.createTrip.mockResolvedValue({ id: 202 });
    api.findMatches.mockResolvedValue([
      {
        id: 303,
        role: 'driver',
        origin: 'Джал',
        destination: 'ЦУМ',
        time: '09:00',
        date: '2026-12-01',
        seats: 4,
        seats_taken: 1,
        price_per_seat: 120,
        user_id: 9,
        user: { id: 9, name: 'Азамат', trust_rating: 4.9, is_verified: true },
      },
    ]);

    const { result } = renderHook(() =>
      useTripSearch({
        currentUser: { id: 1, name: 'Test' },
        setCurrentUser: vi.fn(),
        setActiveTrip: vi.fn(),
        setActiveTab: vi.fn(),
        showNotification,
      }),
    );

    await act(async () => {
      await result.current.handleSearch({
        role: 'passenger',
        from: 'Джал',
        to: 'ЦУМ',
        time: '09:00',
        date: '2026-12-01',
        seats: 1,
        price: 0,
      });
    });

    expect(result.current.isSearching).toBe(false);
    expect(result.current.matches).toHaveLength(1);
    expect(result.current.matches[0]).toMatchObject({
      id: 303,
      seats: 4,
      seats_taken: 1,
      price_per_seat: 120,
    });
  });
});
