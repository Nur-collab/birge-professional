import { useCallback, useState } from 'react';
import { showSystemNotificationSafely } from '../utils/platform';

export default function useNotifications() {
  const [notification, setNotification] = useState({ show: false, title: '', message: '' });

  const showNotification = useCallback((title, message) => {
    setNotification({ show: true, title, message });
    showSystemNotificationSafely(title, { body: message });
  }, []);

  const closeNotification = useCallback(() => {
    setNotification((prev) => ({ ...prev, show: false }));
  }, []);

  return { notification, showNotification, closeNotification };
}
