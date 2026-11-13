import { useCallback, useState } from 'react';

export default function useNotifications() {
  const [notification, setNotification] = useState({ show: false, title: '', message: '' });

  const showNotification = useCallback((title, message) => {
    setNotification({ show: true, title, message });
    // Нативное Push-уведомление если вкладка скрыта/свернута
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      new Notification(title, { body: message });
    }
  }, []);

  const closeNotification = useCallback(() => {
    setNotification((prev) => ({ ...prev, show: false }));
  }, []);

  return { notification, showNotification, closeNotification };
}
