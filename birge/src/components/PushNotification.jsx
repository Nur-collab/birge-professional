import React, { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import './PushNotification.css';

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

        </div>
    );
}
