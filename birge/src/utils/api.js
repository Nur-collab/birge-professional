// ==============================================================================
// BIRGE WEB CLIENT — PUBLIC API FACADE
// Modular implementation lives in ./api/{client,auth,users,trips,chat}.js.
// ==============================================================================

/**
 * @typedef {import('./api/trips').TripView} TripView
 */

export {
  API_URL,
  AUTH_URL,
  getCurrentUserId,
  stripLegacyTokenFromUrl,
  takeLoginCodeFromUrl,
  tokenStorage,
} from './api/client';

import { authApi } from './api/auth';
import { usersApi } from './api/users';
import { tripsApi } from './api/trips';
import { chatApi, safetyApi } from './api/chat';

export const api = {
  ...authApi,
  ...usersApi,
  ...tripsApi,
  ...chatApi,
  ...safetyApi,
};
