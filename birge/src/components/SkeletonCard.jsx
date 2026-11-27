import React from 'react';
import './SkeletonCard.css';

export default function SkeletonCard() {
    return (
        <div className="skeleton-card">
            <div className="skeleton-header">
                <div className="skeleton-circle" />
                <div style={{ flex: 1 }}>
                    <div className="skeleton-line" style={{ width: '60%', marginBottom: '8px' }} />
                    <div className="skeleton-line" style={{ width: '35%', height: '12px' }} />
                </div>
                <div className="skeleton-badge" />
            </div>
            <div className="skeleton-route">
                <div className="skeleton-line" style={{ width: '80%', marginBottom: '8px' }} />
                <div className="skeleton-rect" style={{ width: '2px', height: '14px', margin: '4px 0 4px 6px' }} />
                <div className="skeleton-line" style={{ width: '70%' }} />
            </div>
            <div className="skeleton-btn" />

        </div>
    );
}
