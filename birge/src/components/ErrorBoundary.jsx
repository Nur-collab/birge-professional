import React from 'react';
import { captureException } from '../sentry';
import { AlertTriangle, RotateCcw, RefreshCw, ChevronDown, Copy, Check } from 'lucide-react';
import i18n from '../i18n';
import './ErrorBoundary.css';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    // Keep error logging for telemetry/diagnostics
    console.error('[Birge ErrorBoundary caught error]:', error, errorInfo);
    captureException(error, {
      extra: { componentStack: errorInfo?.componentStack },
    });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  handleHardReset = () => {
    try {
      localStorage.removeItem('birge_active_trip');
      localStorage.removeItem('birge_search_history');
    } catch (_) {}
    window.location.href = '/';
  };

  handleCopy = () => {
    const text = `${this.state.error?.toString()}\n\nStack:\n${this.state.errorInfo?.componentStack || this.state.error?.stack || 'No stack trace'}`;
    navigator.clipboard?.writeText(text).then(() => {
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback({
          error: this.state.error,
          resetError: this.handleReset,
        });
      }

      return (
        <div className="eb-container">
          <div className="eb-card">
            <div className="eb-icon-wrapper">
              <AlertTriangle className="eb-icon" size={32} />
            </div>

            <div className="eb-header">
              <span className="eb-badge">{i18n.t('error_boundary.badge')}</span>
              <h2 className="eb-title">{i18n.t('error_boundary.title')}</h2>
              <p className="eb-subtitle">
                {i18n.t('error_boundary.subtitle')}
              </p>
            </div>

            <div className="eb-actions">
              <button
                type="button"
                className="eb-btn eb-btn-primary"
                onClick={this.handleReset}
              >
                <RotateCcw size={16} />
                <span>{i18n.t('error_boundary.retry')}</span>
              </button>

              <button
                type="button"
                className="eb-btn eb-btn-secondary"
                onClick={this.handleHardReset}
              >
                <RefreshCw size={16} />
                <span>{i18n.t('error_boundary.hard_reset')}</span>
              </button>
            </div>

            {this.state.error && (
              <details className="eb-details">
                <summary className="eb-summary">
                  <span>{i18n.t('error_boundary.details')}</span>
                  <ChevronDown size={14} className="eb-chevron" />
                </summary>
                <div className="eb-stack-box">
                  <div className="eb-stack-header">
                    <span className="eb-stack-label">Trace</span>
                    <button
                      type="button"
                      className="eb-copy-btn"
                      onClick={this.handleCopy}
                    >
                      {this.state.copied ? (
                        <>
                          <Check size={12} />
                          <span>{i18n.t('error_boundary.copied')}</span>
                        </>
                      ) : (
                        <>
                          <Copy size={12} />
                          <span>{i18n.t('copy')}</span>
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="eb-code">
                    {this.state.error?.toString()}
                    {'\n'}
                    {this.state.errorInfo?.componentStack}
                  </pre>
                </div>
              </details>
            )}
          </div>

        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
