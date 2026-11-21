import React from 'react';

export default function StatePanel({ icon, badge, title, text, action, titleAs: Title = 'h2' }) {
  return (
    <section className="state-panel">
      {badge ? (
        <span className="state-panel-badge">{badge}</span>
      ) : icon ? (
        <span className="state-panel-icon" aria-hidden="true">{icon}</span>
      ) : null}
      <Title className="state-panel-title">{title}</Title>
      {text ? <p className="state-panel-text">{text}</p> : null}
      {action}
    </section>
  );
}
