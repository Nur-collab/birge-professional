import { describe, expect, it } from 'vitest';

import { isKnownPath, pathToTab, tabToPath, tripIdFromPath } from './routes';

describe('route helpers', () => {
  it('maps tab paths to tabs', () => {
    expect(pathToTab('/')).toBe('home');
    expect(pathToTab('/matches')).toBe('matches');
    expect(pathToTab('/scheduled')).toBe('trip');
    expect(pathToTab('/profile')).toBe('profile');
    expect(pathToTab('/settings')).toBe('settings');
    expect(pathToTab('/history')).toBe('history');
  });

  it('parses trip ids and treats them as the trip tab', () => {
    expect(tripIdFromPath('/trips/42')).toBe(42);
    expect(tripIdFromPath('/trips/42/')).toBe(42);
    expect(tripIdFromPath('/trips/not-a-number')).toBeNull();
    expect(pathToTab('/trips/42')).toBe('trip');
  });

  it('builds deep-link paths', () => {
    expect(tabToPath('home')).toBe('/');
    expect(tabToPath('trip', 42)).toBe('/trips/42');
    expect(tabToPath('trip', null)).toBe('/scheduled');
    expect(tabToPath('profile')).toBe('/profile');
  });

  it('rejects unknown paths', () => {
    expect(isKnownPath('/')).toBe(true);
    expect(isKnownPath('/trips/42')).toBe(true);
    expect(isKnownPath('/unknown')).toBe(false);
  });
});
