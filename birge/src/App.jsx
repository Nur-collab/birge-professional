import React, { useCallback, useState } from 'react';
import { Home, Users, Map, User, Calendar, Sun, Moon } from 'lucide-react';
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

function App() {
  const { t } = useTranslation();
  const { theme, toggleTheme } = useTheme();
  const { activeTrip, setActiveTrip, clearActiveTrip } = useActiveTrip();
  const { notification, showNotification, closeNotification } = useNotifications();
  const [activeTab, setActiveTab] = useState(() => (activeTrip ? 'trip' : 'home'));
  const [unreadCount, setUnreadCount] = useState(0);
  const [showReview, setShowReview] = useState(false);

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
    setActiveTab((current) => {
      if (current !== 'trip') {
        setUnreadCount((n) => n + 1);
      }
      return current;
    });
  }, []);

  const handleLogout = async () => {
    await logout();
    setActiveTab('home');
  };

  if (authLoading) {
    return (
      <div style={{ minHeight: '100dvh', background: 'var(--bg-app)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, textAlign: 'center' }}>
        <div style={{ width: 48, height: 48, borderRadius: 12, background: 'linear-gradient(135deg,#10b981,#059669)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 800, letterSpacing: -0.5 }}>B</div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 600 }}>Инициализация сессии...</p>
      </div>
    );
  }

  if (authError) {
    return (
      <div style={{ minHeight: '100dvh', background: 'var(--bg-app)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, textAlign: 'center' }}>
        <div style={{ width: 52, height: 52, borderRadius: 14, background: 'rgba(239,68,68,0.1)', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Sun size={26} />
        </div>
        <h2 style={{ margin: 0, color: 'var(--text-main)', fontSize: '1.2rem', fontWeight: 800 }}>Нет связи с сервером</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', maxWidth: 320, lineHeight: 1.5 }}>
          Не удалось загрузить профиль. Проверьте подключение к интернету. Сессия сохранена.
        </p>
        <button
          className="primary-btn"
          style={{ width: 'auto', padding: '11px 28px', marginTop: 8 }}
          onClick={retryAuth}
        >
          Повторить попытку
        </button>
      </div>
    );
  }

  if (!isLoggedIn) {
    return <Login onLoggedIn={handleLoggedIn} />;
  }

  const handleTabChange = (tab) => {
    setActiveTab(tab);
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
            onGoToActiveTrip={() => setActiveTab('trip')}
          />
        );
      case 'trip':
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
                  showNotification('Сигнал тревоги отправлен', 'Команда поддержки уведомлена.');
                } else {
                  showNotification('Не удалось отправить тревогу', result?.reason || 'Проверьте связь или позвоните 102.');
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
              // Не переключаем таб — Trip уже рендерится в этом же case
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

  return (
    <div className="app-container">
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
          <div className="header-brand" onClick={() => handleTabChange('home')}>
            <div className="header-brand-mark">B</div>
            <div className="header-brand-text">
              <span className="header-brand-title">BIRGE</span>
              <span className="header-brand-subtitle">CARPOOL</span>
            </div>
          </div>
          <div className="header-actions">
            {currentUser && (
              <div className="header-user-badge">
                <span className="status-indicator-dot" />
                <span>{currentUser.name?.split(' ')[0] || 'Профиль'}</span>
              </div>
            )}
            <button
              type="button"
              className="theme-toggle-btn"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
              aria-label="Сменить тему оформления"
            >
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
          </div>
        </div>
      </header>

      <main className="main-content">
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

      <nav className="bottom-nav">
        <button className={`nav-item ${activeTab === 'home' ? 'active' : ''}`} onClick={() => handleTabChange('home')}>
          <Home size={24} />
          <span>{t('nav.find')}</span>
        </button>
        <button className={`nav-item ${activeTab === 'matches' ? 'active' : ''}`} onClick={() => handleTabChange('matches')}>
          <Users size={24} />
          {/* Для пассажира — кол-во найденных водителей; для водителя — входящие запросы */}
          {pendingRequestCount > 0 && <span className="badge incoming-badge">{pendingRequestCount}</span>}
          {pendingRequestCount === 0 && matches.length > 0 && <span className="badge">{matches.length}</span>}
          <span>{t('matches.title')}</span>
        </button>
        <button className={`nav-item ${activeTab === 'trip' ? 'active' : ''}`} onClick={() => handleTabChange('trip')}>
          {activeTrip ? <Map size={24} /> : <Calendar size={24} />}
          {unreadCount > 0 && <span className="badge">{unreadCount}</span>}
          {activeTrip && unreadCount === 0 && <span className="badge dot" />}
          <span>{activeTrip ? t('nav.on_way') : t('nav.trips')}</span>
        </button>
        <button className={`nav-item ${(activeTab === 'profile' || activeTab === 'settings' || activeTab === 'history') ? 'active' : ''}`} onClick={() => handleTabChange('profile')}>
          <User size={24} />
          <span>{t('nav.profile')}</span>
        </button>
      </nav>

      <style>{`
        .app-container {
          padding-bottom: calc(88px + env(safe-area-inset-bottom, 0px));
          min-height: 100vh;
          min-height: 100dvh;
        }
        .bottom-nav {
          position: fixed;
          bottom: calc(12px + env(safe-area-inset-bottom, 0px));
          left: 50%;
          transform: translateX(-50%);
          width: calc(100% - 24px);
          max-width: 456px;
          background: var(--nav-bg);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          border: 1px solid var(--nav-border);
          border-radius: var(--radius-lg);
          box-shadow: var(--floating-shadow);
          display: flex;
          justify-content: space-around;
          padding: 6px;
          z-index: 100;
          transition: background-color 0.25s ease, border-color 0.25s ease;
        }
        .nav-item {
          flex: 1;
          display: flex; flex-direction: column; align-items: center;
          gap: 3px; background: none; border: none; color: var(--text-subtle);
          font-size: 0.68rem; font-weight: 700; cursor: pointer;
          position: relative; transition: all 0.2s;
          padding: 8px 6px;
          border-radius: 12px;
          letter-spacing: 0.02em;
        }
        .nav-item:hover { color: var(--text-main); background: var(--bg-subtle); }
        .nav-item.active {
          color: var(--primary);
          background: var(--nav-active-bg);
        }
        .badge {
          position: absolute; top: 4px; right: 14px;
          background: #ef4444; color: white; font-size: 0.62rem;
          font-weight: 800; min-width: 16px; height: 16px; border-radius: 8px;
          display: flex; align-items: center; justify-content: center;
          padding: 0 4px; border: 2px solid var(--bg-app);
          font-variant-numeric: tabular-nums;
        }
        .badge.dot {
          width: 7px; height: 7px; min-width: unset; right: 18px; padding: 0;
          top: 6px; background: #10b981;
        }
        .badge.incoming-badge {
          background: #f59e0b;
        }
      `}</style>
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
