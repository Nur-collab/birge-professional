import { authFetch, tokenStorage } from './client';
import { closeActiveChatSocket } from './chat';

export const usersApi = {
  getCurrentUser: async () => {
    try {
      const data = await authFetch('/users/me');
      if (!data) return null;
      return {
        id: data.id,
        uid: data.id,
        name: data.name || 'Пользователь',
        phone: data.phone || '',
        photo: data.photo || `https://i.pravatar.cc/150?u=${data.id}`,
        trust_rating: data.trust_rating ?? 5.0,
        is_verified: data.is_verified ?? false,
        trips_today: data.trips_today ?? 0,
        registered_since: data.registered_since || '2024',
        car_model: data.car_model || null,
        car_color: data.car_color || null,
        car_plate: data.car_plate || null,
        mbank_phone: data.mbank_phone || null,
        elkart_number: data.elkart_number || null,
        is_admin: Boolean(data.is_admin),
        is_blocked: Boolean(data.is_blocked),
        late_cancellations: data.late_cancellations ?? 0,
        reviews: data.reviews || [],
      };
    } catch (e) {
      // Return null only for truly expired/forbidden sessions; rethrow network/cold-start errors.
      if (e.status === 401 || e.status === 403) return null;
      throw e;
    }
  },

  updateProfile: async (data) => {
    await authFetch('/users/me', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    return usersApi.getCurrentUser();
  },

  getUserById: async (uid) => {
    if (!uid) return null;
    try {
      return await authFetch(`/users/${uid}`);
    } catch {
      return null;
    }
  },

  uploadProfilePhoto: async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    await authFetch('/users/me/photo', { method: 'POST', body: formData });
    return usersApi.getCurrentUser();
  },

  verifyAccount: async () => {
    return authFetch('/users/me/verify', { method: 'POST' });
  },

  verifyUser: async () => usersApi.verifyAccount(),

  exportMyData: async () => {
    return authFetch('/users/me/export');
  },

  deleteAccount: async () => {
    const res = await authFetch('/users/me', { method: 'DELETE' });
    tokenStorage.clear();
    closeActiveChatSocket();
    return res;
  },

  submitReport: async ({ target_user_id, trip_id = null, reason, details = '' }) => {
    return authFetch('/reports/', {
      method: 'POST',
      body: JSON.stringify({
        target_user_id: Number(target_user_id),
        trip_id: trip_id ? Number(trip_id) : null,
        reason,
        details,
      }),
    });
  },

  getAdminReports: async (status = '') => {
    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    return authFetch(`/admin/reports${query}`);
  },

  moderateReport: async (reportId, { status, admin_note = null, block_target = null }) => {
    return authFetch(`/admin/reports/${reportId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status,
        ...(admin_note !== null ? { admin_note } : {}),
        ...(block_target !== null ? { block_target } : {}),
      }),
    });
  },

  getAdminFunnel: async (days = 7) => {
    return authFetch(`/admin/funnel?days=${Number(days) || 7}`);
  },
};
