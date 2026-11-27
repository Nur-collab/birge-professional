import React, { useCallback, useEffect, useState } from 'react';
import { BarChart3, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../utils/api';
import './AdminModerationPanel.css';

export default function AdminModerationPanel() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('reports');
  const [reports, setReports] = useState([]);
  const [funnel, setFunnel] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (tab === 'reports') {
        const list = await api.getAdminReports('');
        setReports(Array.isArray(list) ? list : []);
      } else {
        const data = await api.getAdminFunnel(7);
        setFunnel(data || null);
      }
    } catch (err) {
      setError(err?.message || t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [tab, t]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleModerate = async (reportId, status, blockTarget = null) => {
    try {
      const updated = await api.moderateReport(reportId, {
        status,
        block_target: blockTarget,
      });
      setReports((prev) => prev.map((r) => (r.id === reportId ? updated : r)));
    } catch (err) {
      setError(err?.message || t('common.error'));
    }
  };

  return (
    <section
      className="settings-section glass-panel"
      style={{ marginTop: '1.2rem' }}
      aria-labelledby="admin-panel-heading"
    >
      <div className="section-title" id="admin-panel-heading">
        <ShieldAlert size={18} color="var(--primary)" aria-hidden="true" />
        <span>{t('admin.title')}</span>
      </div>

      <div className="admin-tabs">
        <button
          type="button"
          className={`admin-tab-btn ${tab === 'reports' ? 'active' : ''}`}
          onClick={() => setTab('reports')}
        >
          {t('admin.tab_reports')}
        </button>
        <button
          type="button"
          className={`admin-tab-btn ${tab === 'funnel' ? 'active' : ''}`}
          onClick={() => setTab('funnel')}
        >
          {t('admin.tab_funnel')}
        </button>
      </div>

      {error && <div className="privacy-feedback is-error" role="alert">{error}</div>}
      {loading && <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{t('admin.loading')}</p>}

      {!loading && tab === 'reports' && (
        reports.length === 0 ? (
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>{t('admin.no_reports')}</p>
        ) : (
          reports.map((r) => (
            <div key={r.id} className="admin-report-card">
              <div className="admin-report-head">
                <strong style={{ fontSize: '0.84rem', color: 'var(--text-main)' }}>
                  #{r.id} · {r.target_name || `ID ${r.target_user_id}`}
                </strong>
                <span className={`admin-report-status ${r.status === 'open' ? 'is-open' : ''}`}>
                  {r.status}
                </span>
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                {t(`report.reason_${r.reason === 'unsafe_driving' ? 'unsafe' : r.reason === 'rude_behavior' ? 'rude' : r.reason === 'payment_issue' ? 'payment' : r.reason}`)}
                {r.details ? ` — ${r.details}` : ''}
              </div>
              <div className="admin-report-actions">
                <button
                  type="button"
                  className="admin-mini-btn"
                  onClick={() => handleModerate(r.id, 'resolved')}
                >
                  {t('admin.resolve')}
                </button>
                <button
                  type="button"
                  className="admin-mini-btn"
                  onClick={() => handleModerate(r.id, 'dismissed')}
                >
                  {t('admin.dismiss')}
                </button>
                <button
                  type="button"
                  className="admin-mini-btn danger"
                  onClick={() => handleModerate(r.id, 'resolved', !r.target_is_blocked)}
                >
                  {r.target_is_blocked ? t('admin.unblock_user') : t('admin.block_user')}
                </button>
              </div>
            </div>
          ))
        )
      )}

      {!loading && tab === 'funnel' && funnel && (
        <div>
          <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
            <BarChart3 size={14} aria-hidden="true" />
            {t('admin.funnel_window', { days: funnel.days })}
          </p>
          {(funnel.stages || []).map((st) => (
            <div key={st.stage} className="admin-funnel-row">
              <span className="admin-funnel-stage">{t(`admin.stage_${st.stage}`)}</span>
              <span className="admin-funnel-count">{st.events_count}</span>
              <span className="admin-funnel-pct">{st.conversion_from_search_pct}%</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
