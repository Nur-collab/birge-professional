export const TAB_PATHS = Object.freeze({
  home: '/',
  matches: '/matches',
  trip: '/scheduled',
  profile: '/profile',
  settings: '/settings',
  history: '/history',
});

const TRIP_PATH = /^\/trips\/(\d+)\/?$/;

export function tripIdFromPath(pathname = '/') {
  const match = TRIP_PATH.exec(pathname);
  return match ? Number(match[1]) : null;
}

export function isKnownPath(pathname = '/') {
  return pathname === '/' || Object.values(TAB_PATHS).includes(pathname) || TRIP_PATH.test(pathname);
}

export function pathToTab(pathname = '/') {
  if (pathname === '/' || pathname === '') return 'home';
  if (pathname === '/scheduled' || TRIP_PATH.test(pathname)) return 'trip';

  const entry = Object.entries(TAB_PATHS).find(([, path]) => path === pathname);
  return entry ? entry[0] : 'home';
}

export function tabToPath(tab, activeTripId = null) {
  if (tab === 'trip') {
    return activeTripId ? `/trips/${activeTripId}` : TAB_PATHS.trip;
  }
  return TAB_PATHS[tab] || TAB_PATHS.home;
}
