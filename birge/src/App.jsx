import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Home, Users, Map, User, Calendar, Sun, Moon, WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Dashboard from './screens/Dashboard';
import Matches from './screens/Matches';
import Trip from './screens/Trip';
import Profile from './screens/Profile';
import Settings from './screens/Settings';
import TripHistory from './screens/TripHistory';
import ScheduledTrips from './screens/ScheduledTrips';
import Login from './screens/Login';
import InstallPWA from './components/InstallPWA';
import PushNotification from './components/PushNotification';
import ReviewModal from './components/ReviewModal';
import TripRequestModal from './components/TripRequestModal';
import ResumeTripBanner from './components/ResumeTripBanner';
import ErrorBoundary from './components/ErrorBoundary';
import OfflineIndicator from './components/OfflineIndicator';
import useActiveTrip from './hooks/useActiveTrip';
import useAuth from './hooks/useAuth';
import useIncomingRequests from './hooks/useIncomingRequests';
import useNotifications from './hooks/useNotifications';
import useTheme from './hooks/useTheme';
import useTripActions from './hooks/useTripActions';
import useTripSearch from './hooks/useTripSearch';
import { api } from './utils/api';
import { isKnownPath, pathToTab, tabToPath, tripIdFromPath } from './utils/routes';
import './App.css';

function App() {
  const { t } = useTranslation();
  const { theme, toggleTheme } = useTheme();
  const { activeTrip, setActiveTrip, clearActiveTrip } = useActiveTrip();
  const { notification, showNotification, closeNotification } = useNotifications();
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab = pathToTab(location.pathname);
  const routeTripId = tripIdFromPath(location.pathname);
  const initialRouteHandled = useRef(false);
  const mainRef = useRef(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showReview, setShowReview] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  // Hide the floating tab bar when a virtual keyboard shrinks the mobile viewport.
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return undefined;
    const handleViewportResize = () => {
      const heightDiff = window.innerHeight - vv.height;
      setKeyboardOpen(heightDiff > 140);
    };
    handleViewportResize();
    vv.addEventListener('resize', handleViewportResize);
    return () => vv.removeEventListener('resize', handleViewportResize);
  }, []);

  // Hooks call this immediately after setActiveTrip, when React has not
  // re-rendered with the new trip yet. Trip navigation therefore goes through
  // `/scheduled`; the effect above canonicalizes it to `/trips/:id` once the
  // new activeTrip is available. `handleTabChange` can pass the id directly.
  const setActiveTab = useCallback((tab, tripId = null) => {
    navigate(tabToPath(tab, tripId));
  }, [navigate]);

  // Instant keeps the global smooth-scroll rule from animating the jump.
  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, []);

  const {
    isLoggedIn,
    authLoading,
    authError,
    currentUser,
    setCurrentUser,
    orphanedTrip,
    setOrphanedTrip,
    handleLoggedIn,
    handleLogout: logout,
    handleAccountDeleted,
    retryAuth,
  } = useAuth({ clearActiveTrip });

  const {
    matches,
    setMatches,
    isSearching,
    searchCriteria,
    setSearchCriteria,
    myTripId,
    setMyTripId,
    handleSearch,
    handleCancelSearch,
  } = useTripSearch({
    currentUser,
    setCurrentUser,
    setActiveTrip,
    setActiveTab,
    showNotification,
  });

  const {
    incomingRequest,
    pendingRequestCount,
    dismissIncomingRequest,
    decrementPendingRequestCount,
  } = useIncomingRequests({ currentUser, myTripId, activeTrip });

  const {
    handleConnectPassenger,
    handleAcceptRequest,
    handleDeclineRequest,
    handleFinishTrip,
    handleReviewSubmit,
    handleReviewSkip,
    handleTripCancelled,
    handleResumeOrphan,
    handleDiscardOrphan,
  } = useTripActions({
    activeTrip,
    currentUser,
    incomingRequest,
    orphanedTrip,
    setActiveTrip,
    setActiveTab,
    setCurrentUser,
    setMatches,
    setMyTripId,
    setOrphanedTrip,
    setSearchCriteria,
    setShowReview,
    setUnreadCount,
    dismissIncomingRequest,
    decrementPendingRequestCount,
    showNotification,
  });

  // Колбэк из Chat — новое входящее сообщение
  const handleNewChatMessage = useCallback(() => {
    if (activeTab !== 'trip') {
      setUnreadCount((n) => n + 1);
    }
  }, [activeTab]);

  useEffect(() => {
    if (!isKnownPath(location.pathname)) {
      navigate('/', { replace: true });
    }
  }, [location.pathname, navigate]);

  // SPA route changes should move focus out of the tab bar into the new view.
  useEffect(() => {
    if (isLoggedIn) mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname, isLoggedIn]);

  // Each screen opens at its own top instead of inheriting the previous scroll.
  useEffect(() => {
    scrollToTop();
  }, [location.pathname, scrollToTop]);

  // Preserve the old behavior: a stored active trip wins on a bare `/` load.
  useEffect(() => {
    if (initialRouteHandled.current) return;
    initialRouteHandled.current = true;
    if (activeTrip && location.pathname === '/') {
      navigate(`/trips/${activeTrip.id}`, { replace: true });
    }
  }, [activeTrip, location.pathname, navigate]);

  // `/scheduled` is the trip tab when there is no active trip. With an active
  // trip, the canonical URL is `/trips/:id`.
  useEffect(() => {
    if (activeTrip && location.pathname === '/scheduled') {
      navigate(`/trips/${activeTrip.id}`, { replace: true });
    }
  }, [activeTrip, location.pathname, navigate]);

  // Deep links load only trips where the current user is the driver or an
  // accepted participant; the backend returns 404 for everyone else.
  useEffect(() => {
    if (!isLoggedIn || !routeTripId || activeTrip?.id === routeTripId) return undefined;
    let cancelled = false;
    api.getTrip(routeTripId)
      .then((trip) => {
        if (!cancelled) setActiveTrip(trip);
      })
      .catch(() => {
        if (!cancelled) {
          showNotification(t('app.trip_unavailable'), t('app.trip_unavailable_desc'));
          navigate('/', { replace: true });
        }
      });
    return () => { cancelled = true; };
  }, [routeTripId, isLoggedIn, activeTrip?.id, setActiveTrip, showNotification, navigate]);

  const handleLogout = async () => {
    await logout();
    setActiveTab('home');
  };

  if (authLoading) {
    return (
      <div role="status" aria-live="polite" style={{ minHeight: '100dvh', background: 'var(--bg-app)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, textAlign: 'center' }}>
        <div style={{ width: 48, height: 48, borderRadius: 13, background: 'var(--primary)', color: 'var(--bg-page)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 23, fontWeight: 800, letterSpacing: -0.5 }}>B</div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 600 }}>{t('app.session_init')}</p>
      </div>
    );
  }

  if (authError) {
    return (
      <div role="alert" style={{ minHeight: '100dvh', background: 'var(--bg-app)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, textAlign: 'center' }}>
        <div style={{ width: 52, height: 52, borderRadius: 16, background: 'var(--danger-soft)', color: 'var(--danger)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <WifiOff size={24} />
        </div>
        <h2 style={{ margin: 0, color: 'var(--text-main)', fontSize: '1.2rem', fontWeight: 800 }}>{t('app.server_offline_title')}</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', maxWidth: 320, lineHeight: 1.5 }}>
          {t('app.server_offline_desc')}
        </p>
        <button
          className="primary-btn"
          style={{ width: 'auto', padding: '11px 28px', marginTop: 8 }}
          onClick={retryAuth}
        >
          {t('app.retry_attempt')}
        </button>
      </div>
    );
  }

  if (!isLoggedIn) {
    return <Login onLoggedIn={handleLoggedIn} />;
  }

  const handleTabChange = (tab) => {
    const tripId = tab === 'trip' ? activeTrip?.id : null;
    if (tabToPath(tab, tripId) === location.pathname) {
      // Re-tapping the active tab returns that screen to the top.
      scrollToTop();
    } else {
      setActiveTab(tab, tripId);
    }
    if (tab === 'trip') setUnreadCount(0); // сброс непрочитанных при открытии чата
  };

  const renderScreen = () => {
    switch (activeTab) {
      case 'home':
        return <Dashboard onSearch={handleSearch} currentUser={currentUser} onShowSettings={() => setActiveTab('settings')} />;
      case 'matches':
        return (
          <Matches
            matches={matches}
            setMatches={setMatches}
            onConnect={handleConnectPassenger}
            onCancel={handleCancelSearch}
            isLoading={isSearching}
            searchCriteria={searchCriteria}
            currentUser={currentUser}
            myTripId={myTripId}
            activeTrip={activeTrip}
            onGoToActiveTrip={() => setActiveTab('trip', activeTrip?.id)}
          />
        );
      case 'trip':
        // Deep link is loading, or points at a different trip than the stored one.
        if (routeTripId && activeTrip?.id !== routeTripId) {
          return (
            <div role="status" aria-live="polite" style={{ minHeight: '50vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 600 }}>
              {t('app.loading_trip')}
            </div>
          );
        }
        // УМНАЯ ВКЛАДКА: если есть активная поездка — показываем её
        // Если нет — показываем список запланированных
        if (activeTrip) {
          return (
            <Trip
              trip={activeTrip}
              currentUser={currentUser}
              onNewMessage={handleNewChatMessage}
              onPanic={async () => {
                // Отправляем реальный тревожный сигнал в Telegram поддержки
                const result = await api.sendPanic(activeTrip?.id);
                if (result?.sent) {
                  showNotification(t('app.panic_sent_title'), t('app.panic_sent_desc'));
                } else {
                  showNotification(t('app.panic_failed_title'), result?.reason || t('app.panic_failed_desc'));
                }
              }}
              onFinish={handleFinishTrip}
              onCancelled={handleTripCancelled}
            />
          );
        }
        return (
          <ScheduledTrips
            currentUser={currentUser}
            onCancel={() => setActiveTab('home')}
            onOpenTrip={(scheduledTrip) => {
              // Открываем запланированную поездку в Trip.jsx
              const tripData = {
                id: scheduledTrip.trip_id,
                from: scheduledTrip.origin,
                to: scheduledTrip.destination,
                origin: scheduledTrip.origin,
                destination: scheduledTrip.destination,
                time: scheduledTrip.time,
                date: scheduledTrip.date,
                isDriver: scheduledTrip.role === 'driver',
                isScheduled: true,
                seats: scheduledTrip.seats,
                user: scheduledTrip.role === 'passenger' && scheduledTrip.driver ? {
                  id: scheduledTrip.driver.id,
                  name: scheduledTrip.driver.name,
                  photo: scheduledTrip.driver.photo,
                  trust_rating: scheduledTrip.driver.trust_rating,
                  is_verified: scheduledTrip.driver.is_verified,
                } : (scheduledTrip.passengers?.[0] || null),
                driverCarModel: scheduledTrip.driver?.car_model,
                driverCarPlate: scheduledTrip.driver?.car_plate,
                driverCarColor: scheduledTrip.driver?.car_color,
              };
              setActiveTrip(tripData);
              navigate(`/trips/${scheduledTrip.trip_id}`);
            }}
          />
        );
      case 'profile':
        return (
          <Profile
            currentUser={currentUser}
            onLogout={handleLogout}
            onShowSettings={() => setActiveTab('settings')}
            onShowHistory={() => setActiveTab('history')}
          />
        );
      case 'settings':
        return (
          <Settings
            currentUser={currentUser}
            onBack={() => setActiveTab('profile')}
            onUpdate={(updatedUser) => setCurrentUser(updatedUser)}
            onAccountDeleted={handleAccountDeleted}
          />
        );
      case 'history':
        return (
          <TripHistory
            currentUser={currentUser}
            onBack={() => setActiveTab('profile')}
          />
        );
      default:
        return <Dashboard onSearch={handleSearch} />;
    }
  };

  const hideHeader = activeTab === 'profile' || activeTab === 'settings' || activeTab === 'history';

  return (
    <div className={`app-container${hideHeader ? ' no-header' : ''}${keyboardOpen ? ' keyboard-open' : ''}`}>
      <a className="skip-link" href="#main-content">{t('app.skip_to_content')}</a>
      <PushNotification
        show={notification.show}
        title={notification.title}
        message={notification.message}
        onClose={closeNotification}
      />
      <OfflineIndicator />

      {showReview && (
        <ReviewModal
          partner={activeTrip?.user}
          onSubmit={handleReviewSubmit}
          onSkip={handleReviewSkip}
        />
      )}

      <header className="header" style={{ display: (activeTab === 'profile' || activeTab === 'settings' || activeTab === 'history') ? 'none' : 'block' }}>
        <div className="header-inner">
          <button type="button" className="header-brand" onClick={() => handleTabChange('home')}>
            <span className="header-brand-mark" aria-hidden="true">B</span>
            <span className="header-brand-text">
              <span className="header-brand-title">BIRGE</span>
              <span className="header-brand-subtitle">{t('app.brand_subtitle')}</span>
            </span>
            <span className="sr-only">{t('app.brand_home_sr')}</span>
          </button>
          <div className="header-actions">
            {currentUser && (
              <div className="header-user-badge">
                <span className="status-indicator-dot" />
                <span>{currentUser.name?.split(' ')[0] || t('nav.profile')}</span>
              </div>
            )}
            <button
              type="button"
              className="theme-toggle-btn"
              onClick={toggleTheme}
              title={theme === 'dark' ? t('app.theme_to_light') : t('app.theme_to_dark')}
              aria-label={t('app.theme_toggle_aria')}
              aria-pressed={theme === 'dark'}
            >
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
          </div>
        </div>
      </header>

      <main className="main-content" id="main-content" ref={mainRef} tabIndex={-1} aria-label={t('app.main_content')}>
        <h1 className="sr-only">{t('app.sr_title')}</h1>
        <ErrorBoundary key={activeTab}>
          {renderScreen()}
        </ErrorBoundary>
      </main>

      <InstallPWA />

      {/* Баннер возобновления поиска */}
      {orphanedTrip && activeTab === 'home' && (
        <ResumeTripBanner
          trip={orphanedTrip}
          onResume={handleResumeOrphan}
          onDiscard={handleDiscardOrphan}
        />
      )}

      <nav className="bottom-nav" aria-label={t('app.main_nav')}>
        <button type="button" className={`nav-item ${activeTab === 'home' ? 'active' : ''}`} onClick={() => handleTabChange('home')} aria-current={activeTab === 'home' ? 'page' : undefined} aria-label={t('nav.find')}>
          <Home size={24} aria-hidden="true" />
          <span>{t('nav.find')}</span>
        </button>
        <button type="button" className={`nav-item ${activeTab === 'matches' ? 'active' : ''}`} onClick={() => handleTabChange('matches')} aria-current={activeTab === 'matches' ? 'page' : undefined} aria-label={`${t('matches.title')}${pendingRequestCount > 0 ? t('app.new_requests_aria', { count: pendingRequestCount }) : ''}`}>
          <Users size={24} aria-hidden="true" />
          {/* Для пассажира — кол-во найденных водителей; для водителя — входящие запросы */}
          {pendingRequestCount > 0 && <span className="badge incoming-badge" aria-hidden="true">{pendingRequestCount}</span>}
          {pendingRequestCount === 0 && matches.length > 0 && <span className="badge" aria-hidden="true">{matches.length}</span>}
          <span>{t('matches.title')}</span>
        </button>
        <button type="button" className={`nav-item ${activeTab === 'trip' ? 'active' : ''}`} onClick={() => handleTabChange('trip')} aria-current={activeTab === 'trip' ? 'page' : undefined} aria-label={`${activeTrip ? t('nav.on_way') : t('nav.trips')}${unreadCount > 0 ? t('app.unread_aria', { count: unreadCount }) : ''}`}>
          {activeTrip ? <Map size={24} aria-hidden="true" /> : <Calendar size={24} aria-hidden="true" />}
          {unreadCount > 0 && <span className="badge" aria-hidden="true">{unreadCount}</span>}
          {activeTrip && unreadCount === 0 && <span className="badge dot" aria-hidden="true" />}
          <span>{activeTrip ? t('nav.on_way') : t('nav.trips')}</span>
        </button>
        <button type="button" className={`nav-item ${(activeTab === 'profile' || activeTab === 'settings' || activeTab === 'history') ? 'active' : ''}`} onClick={() => handleTabChange('profile')} aria-current={['profile', 'settings', 'history'].includes(activeTab) ? 'page' : undefined} aria-label={t('nav.profile')}>
          <User size={24} aria-hidden="true" />
          <span>{t('nav.profile')}</span>
        </button>
      </nav>

      {/* Модал входящего запроса для водителя */}
      {incomingRequest && (
        <TripRequestModal
          request={incomingRequest}
          onAccept={handleAcceptRequest}
          onDecline={handleDeclineRequest}
        />
      )}
    </div>
  );
}

export default App;
