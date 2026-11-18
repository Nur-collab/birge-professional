import React, { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';

export default function PushNotification({ title, message, show, onClose }) {
    const [animClass, setAnimClass] = useState('slide-out');

    useEffect(() => {
        if (show) {
            setAnimClass('slide-in');
            const timer = setTimeout(() => {
                setAnimClass('slide-out');
                setTimeout(onClose, 300); // Wait for anim
            }, 4000);
            return () => clearTimeout(timer);
        }
    }, [show, onClose]);

    if (!show && animClass === 'slide-out') return null;

    return (
        <div className={`push-notification ${animClass}`} role="status" aria-live="polite" aria-atomic="true">
            <div className="push-icon" aria-hidden="true">
                <Bell size={20} color='var(--on-primary)' />
            </div>
            <div className="push-content">
                <h4>{title}</h4>
                <p>{message}</p>
            </div>

            <style>{`
        .push-notification {
          position: fixed;
          top: 20px;
          left: 50%;
          transform: translateX(-50%);
          width: 90%;
          max-width: 400px;
          background: var(--bg-card);
          border-radius: 16px;
          box-shadow: 0 10px 25px var(--shadow-medium);
          display: flex;
          padding: 12px 16px;
          gap: 12px;
          z-index: 1000;
          transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }
        .push-notification.slide-in {
          top: 20px;
          opacity: 1;
        }
        .push-notification.slide-out {
          top: -100px;
          opacity: 0;
        }
        .push-icon {
          background: var(--primary);
          width: 40px;
          height: 40px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .push-content h4 {
          margin: 0 0 2px 0;
          font-size: 0.9rem;
          color: var(--text-main);
        }
        .push-content p {
          margin: 0;
          font-size: 0.8rem;
          color: var(--text-muted);
        }
      `}</style>
        </div>
    );
}
