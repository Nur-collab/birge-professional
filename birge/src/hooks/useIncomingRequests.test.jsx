import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useIncomingRequests from './useIncomingRequests';
import { api } from '../utils/api';

describe('useIncomingRequests', () => {
  let audioInstances;
  let eventSources;

  beforeEach(() => {
    audioInstances = [];
    eventSources = [];

    global.AudioContext = class FakeAudioContext {
      constructor() {
        this.state = 'running';
        this.currentTime = 0;
        this.destination = {};
        this.close = vi.fn().mockResolvedValue(undefined);
        this.resume = vi.fn().mockResolvedValue(undefined);
        audioInstances.push(this);
      }
      createOscillator() {
        return {
          connect: vi.fn(),
          frequency: { setValueAtTime: vi.fn() },
          start: vi.fn(),
          stop: vi.fn(),
        };
      }
      createGain() {
        return {
          connect: vi.fn(),
          gain: {
            setValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: vi.fn(),
          },
        };
      }
    };

    global.EventSource = class FakeEventSource {
      constructor(url) {
        this.url = url;
        this.listeners = {};
        this.close = vi.fn();
        eventSources.push(this);
      }
      addEventListener(type, fn) {
        this.listeners[type] = fn;
      }
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete global.AudioContext;
    delete global.EventSource;
  });

  it('subscribes to driver SSE, surfaces incoming requests immediately, and closes AudioContext on unmount', async () => {
    vi.spyOn(api, 'getIncomingRequests').mockResolvedValue([]);
    vi.spyOn(api, 'createSseTicket').mockResolvedValue({ ticket: 'driver-sse-ticket', expires_in: 60 });

    const { result, unmount } = renderHook(() =>
      useIncomingRequests({
        currentUser: { id: 5 },
        myTripId: 12,
        activeTrip: null,
      })
    );

    await waitFor(() => expect(eventSources).toHaveLength(1));
    expect(eventSources[0].url).toContain('/trip-requests/driver-events/5?ticket=driver-sse-ticket');

    act(() => {
      eventSources[0].listeners.new_request?.({
        data: JSON.stringify({
          id: 44,
          trip_id: 12,
          status: 'pending',
          requester_name: 'Айбек',
        }),
      });
    });

    expect(result.current.incomingRequest?.id).toBe(44);
    expect(result.current.pendingRequestCount).toBe(1);
    expect(audioInstances).toHaveLength(1);

    act(() => {
      eventSources[0].listeners.new_request?.({
        data: JSON.stringify({
          id: 45,
          trip_id: 12,
          status: 'pending',
          requester_name: 'Бермет',
        }),
      });
    });

    // Reuses the same AudioContext across notifications instead of leaking one per event.
    expect(audioInstances).toHaveLength(1);

    unmount();
    expect(eventSources[0].close).toHaveBeenCalled();
    expect(audioInstances[0].close).toHaveBeenCalledOnce();
  });
});
