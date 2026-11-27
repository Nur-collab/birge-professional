import { authFetch } from './client';

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
};
