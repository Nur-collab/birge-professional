import React, { useState } from 'react';
import { localDateStr } from '../utils/date';
import { 
  User, 
  Car, 
  Clock, 
  Search, 
  Navigation, 
  ArrowRight, 
  ArrowUpDown,
  Calendar, 
  MapPin, 
  Layers, 
  Building2, 
  Compass, 
  ShoppingBag, 
  AlertTriangle,
  Users,
  CreditCard,
  Plus,
  Minus,
  ChevronDown,
  Map as MapIcon
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import AddressInput from '../components/AddressInput';
import RouteMapPreview from '../components/RouteMapPreview';
import './Dashboard.css';

// Популярные жилые комплексы, микрорайоны и ориентиры Бишкека и Чуйской области
const BISHKEK_HUBS = [
  { name: 'ЦУМ (Центр)', cat: 'center' },
  { name: 'ТРК Asia Mall', cat: 'center' },
  { name: 'Южная Магистраль', cat: 'center' },
  { name: 'Политех / БГУ', cat: 'center' },
  { name: 'мкр. Асанбай', cat: 'districts' },
  { name: 'мкр. Джал', cat: 'districts' },
  { name: 'мкр. Тунгуч', cat: 'districts' },
  { name: 'мкр. Восток-5', cat: 'districts' },
  { name: 'ЖК «Ала-Арча»', cat: 'districts' },
  { name: 'ж/м Ак-Өргө', cat: 'districts' },
  { name: 'Рынок Дордой', cat: 'markets' },
  { name: 'Ошский базар', cat: 'markets' },
  { name: 'Аламединский базар', cat: 'markets' },
  { name: 'Кудайберген', cat: 'markets' },
  { name: 'Аэропорт Манас', cat: 'chuy' },
  { name: 'г. Кант', cat: 'chuy' },
  { name: 'г. Токмок', cat: 'chuy' },
  { name: 'с. Сокулук', cat: 'chuy' },
  { name: 'г. Кара-Балта', cat: 'chuy' },
];

const HUB_CATEGORIES = [
  { id: 'all', labelKey: 'dash.cat_all', icon: Layers },
  { id: 'center', labelKey: 'dash.cat_center', icon: Building2 },
  { id: 'districts', labelKey: 'dash.cat_districts', icon: Compass },
  { id: 'markets', labelKey: 'dash.cat_markets', icon: ShoppingBag },
  { id: 'chuy', labelKey: 'dash.cat_chuy', icon: Navigation },
];

export default function Dashboard({ onSearch, currentUser, onShowSettings }) {
  const { t, i18n } = useTranslation();
  const firstName = currentUser?.name?.trim().split(/\s+/)[0] || '';
  const [role, setRole] = useState('passenger');
  const [from, setFrom] = useState('Жилмассив Ала-Арча');
  const [to, setTo] = useState('ЦУМ (Центр)');
  const [tagTarget, setTagTarget] = useState('to'); // 'from' или 'to'
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [time, setTime] = useState('08:15');
  const [date, setDate] = useState(localDateStr());
  const [seats, setSeats] = useState(3);
  const [price, setPrice] = useState(100); // цена за место в сомах
  const [geoLoading, setGeoLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [showHubs, setShowHubs] = useState(false);
  const [showDriverDetails, setShowDriverDetails] = useState(false);
  const [showRoutePreview, setShowRoutePreview] = useState(false);

  const today = localDateStr();
  const tomorrow = localDateStr(1);

  const formatDateLabel = (d) => {
    if (d === today) return t('common.today');
    if (d === tomorrow) return t('common.tomorrow');
    const dt = new Date(d);
    const locale = i18n.language === 'ky' ? 'ky-KG' : 'ru-RU';
    return dt.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  };

  const handleGeolocate = () => {
    if (!navigator.geolocation) return;
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&accept-language=ru`,
            { headers: { 'Accept-Language': 'ru' } }
          );
          const data = await res.json();
          const addr = data.address;
          const location =
            addr.quarter ||
            addr.suburb ||
            addr.neighbourhood ||
            addr.residential ||
            addr.road ||
            data.display_name?.split(',')[0];
          if (location) setFrom(location);
        } catch {
          // ignore
        } finally {
          setGeoLoading(false);
        }
      },
      () => setGeoLoading(false),
      { timeout: 8000 }
    );
  };

  const handleSwapAddresses = () => {
    if ('vibrate' in navigator) navigator.vibrate?.(10);
    setFrom(to);
    setTo(from);
  };

  const handleTagClick = (placeName) => {
    if ('vibrate' in navigator) navigator.vibrate?.(10);
    if (tagTarget === 'from') {
      setFrom(placeName);
      setErrors(prev => ({ ...prev, from: undefined }));
    } else {
      setTo(placeName);
      setErrors(prev => ({ ...prev, to: undefined }));
    }
  };

  const buildSearchPayload = () => ({
    role,
    from: from.trim(),
    to: to.trim(),
    time,
    date,
    seats: role === 'driver' ? seats : 1,
    price: role === 'driver' ? price : 0,
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const newErrors = {};
    if (!from.trim()) newErrors.from = t('dash.err_from');
    if (!to.trim()) newErrors.to = t('dash.err_to');
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setErrors({});

    onSearch(buildSearchPayload());
  };

  const seatWord = seats === 1
    ? t('dash.seat_one')
    : seats < 5
      ? t('dash.seat_few')
      : t('dash.seat_many');

  return (
    <div className="dashboard screen-content">
      <div className="dashboard-heading">
        <p className="dashboard-kicker">{t('dash.kicker')}</p>
        <h2 className="dashboard-title">{firstName ? t('dash.greeting_title', { name: firstName }) : t('dash.where_to')}</h2>
      </div>

      {/* Селектор роли (iOS / Linear Segmented Pill) */}
      <div className="role-switch-container">
        <div className="role-switch" role="group" aria-label={t('dash.role_group_aria')}>
          <button
            type="button"
            className={`role-option ${role === 'passenger' ? 'active' : ''}`}
            onClick={() => {
              if ('vibrate' in navigator) navigator.vibrate?.(10);
              setRole('passenger');
            }}
            aria-pressed={role === 'passenger'}
          >
            <User size={16} aria-hidden="true" />
            <span>{t('dash.role_passenger')}</span>
          </button>
          <button
            type="button"
            className={`role-option ${role === 'driver' ? 'active' : ''}`}
            onClick={() => {
              if ('vibrate' in navigator) navigator.vibrate?.(10);
              setRole('driver');
            }}
            aria-pressed={role === 'driver'}
          >
            <Car size={16} aria-hidden="true" />
            <span>{t('dash.role_driver')}</span>
          </button>
        </div>
      </div>

      {/* Основная карточка маршрута */}
      <form className="route-form-card" onSubmit={handleSubmit}>
        <div className="form-header">
          <div className="form-header-title">
            <MapPin size={16} className="text-primary" />
            <span>{role === 'driver' ? t('dash.route_header_driver') : t('dash.route_header_passenger')}</span>
          </div>
          <div className="form-header-actions">
            {role === 'driver' && currentUser && !currentUser.car_model && (
              <button
                type="button"
                className="car-warning-chip"
                onClick={onShowSettings}
                title={t('dash.no_car_title')}
                aria-label={t('dash.no_car_aria')}
              >
                <AlertTriangle size={13} aria-hidden="true" />
                <span>{t('dash.no_car')}</span>
              </button>
            )}
            <button
              type="button"
              className="swap-route-btn route-map-btn"
              onClick={() => setShowRoutePreview(true)}
              disabled={!from.trim() || !to.trim()}
              title={from.trim() && to.trim() ? t('dash.show_map') : t('dash.fill_route_first')}
              aria-label={t('dash.show_map')}
            >
              <MapIcon size={17} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="swap-route-btn"
              onClick={handleSwapAddresses}
              title={t('dash.swap')}
              aria-label={t('dash.swap_aria')}
            >
              <ArrowUpDown size={15} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Интегрированный трек маршрута */}
        <div className="connected-route-card">
          <div className="route-track-indicator">
            <div className="track-node origin-node" />
            <div className="track-line" />
            <div className="track-node dest-node" />
          </div>

          <div className="route-inputs-col">
            <div className="route-input-cell">
              <AddressInput
                value={from}
                onChange={(v) => { setFrom(v); setErrors(prev => ({ ...prev, from: undefined })); }}
                placeholder={t('dash.from_placeholder')}
                iconColor={errors.from ? 'var(--danger)' : 'var(--primary)'}
                name="from"
                invalid={Boolean(errors.from)}
                describedBy={errors.from ? 'dashboard-from-error' : undefined}
              />
              <button
                type="button"
                onClick={handleGeolocate}
                disabled={geoLoading}
                title={t('dash.geolocate_aria')}
                aria-label={t('dash.geolocate_aria')}
                className="inline-geo-btn"
              >
                <Navigation size={15} className={geoLoading ? 'spin' : ''} aria-hidden="true" />
              </button>
            </div>
            {errors.from && <p className="input-err-msg" id="dashboard-from-error" role="alert">{errors.from}</p>}

            <div className="route-input-cell">
              <AddressInput
                value={to}
                onChange={(v) => { setTo(v); setErrors(prev => ({ ...prev, to: undefined })); }}
                placeholder={t('dash.to_placeholder')}
                iconColor={errors.to ? 'var(--danger)' : 'var(--text-subtle)'}
                name="to"
                invalid={Boolean(errors.to)}
                describedBy={errors.to ? 'dashboard-to-error' : undefined}
              />
            </div>
            {errors.to && <p className="input-err-msg" id="dashboard-to-error" role="alert">{errors.to}</p>}
          </div>
        </div>

        {/* Популярные точки — раскрываются по запросу */}
        <button
          type="button"
          className="compact-disclosure"
          onClick={() => setShowHubs((open) => !open)}
          aria-expanded={showHubs}
          aria-controls="popular-places-panel"
        >
          <span className="compact-disclosure-main">
            <MapPin size={16} aria-hidden="true" />
            <span>{t('dash.popular_places')}</span>
            <span className="compact-disclosure-meta">{t('dash.quick_pick')}</span>
          </span>
          <ChevronDown
            size={17}
            className={`compact-disclosure-chevron ${showHubs ? 'open' : ''}`}
            aria-hidden="true"
          />
        </button>

        {showHubs && (
          <div className="hubs-section" id="popular-places-panel">
          <div className="hubs-top">
            <div className="section-label">{t('dash.popular_points')}</div>
            <div className="target-toggle" role="group" aria-label={t('dash.target_group_aria')}>
              <button
                type="button"
                className={`target-pill ${tagTarget === 'from' ? 'active' : ''}`}
                onClick={() => setTagTarget('from')}
                aria-pressed={tagTarget === 'from'}
              >
                {t('tags.target_from')}
              </button>
              <button
                type="button"
                className={`target-pill ${tagTarget === 'to' ? 'active' : ''}`}
                onClick={() => setTagTarget('to')}
                aria-pressed={tagTarget === 'to'}
              >
                {t('tags.target_to')}
              </button>
            </div>
          </div>

          {/* Категории */}
          <div className="category-scroll" role="group" aria-label={t('dash.categories_aria')}>
            {HUB_CATEGORIES.map((cat) => {
              const IconComp = cat.icon;
              return (
                <button
                  key={cat.id}
                  type="button"
                  className={`category-pill ${selectedCategory === cat.id ? 'active' : ''}`}
                  onClick={() => {
                    if ('vibrate' in navigator) navigator.vibrate?.(10);
                    setSelectedCategory(cat.id);
                  }}
                  aria-pressed={selectedCategory === cat.id}
                >
                  <IconComp size={13} aria-hidden="true" />
                  <span>{t(cat.labelKey)}</span>
                </button>
              );
            })}
          </div>

          {/* Список хабов */}
          <div className="hubs-chips-scroll" role="group" aria-label={t('dash.popular_points')}>
            {BISHKEK_HUBS.filter(h => selectedCategory === 'all' || h.cat === selectedCategory).map((hub) => {
              const isSelected = tagTarget === 'from' ? from === hub.name : to === hub.name;
              return (
                <button
                  key={hub.name}
                  type="button"
                  className={`hub-chip ${isSelected ? 'selected' : ''}`}
                  onClick={() => handleTagClick(hub.name)}
                  aria-pressed={isSelected}
                >
                  {hub.name}
                </button>
              );
            })}
          </div>
          </div>
        )}

        {/* Дата и Время */}
        <div className="datetime-grid">
          <div className="datetime-cell">
            <div className="cell-label">
              <Calendar size={14} className="text-muted" />
              <span>{t('dash.date_label')}</span>
            </div>
            <div className="date-picker-box">
              <span className="date-display" aria-hidden="true">{formatDateLabel(date)}</span>
              <input
                type="date"
                aria-label={t('dash.date_aria')}
                value={date}
                min={today}
                onChange={e => setDate(e.target.value)}
                onClick={e => e.target.showPicker && e.target.showPicker()}
                className="hidden-native-input"
              />
            </div>
          </div>

          <div className="datetime-cell">
            <div className="cell-label">
              <Clock size={14} className="text-muted" />
              <span>{t('dash.time_label')}</span>
            </div>
            <input
              type="time"
              aria-label={t('dash.time_aria')}
              value={time}
              onChange={e => setTime(e.target.value)}
              required
              className="time-native-input"
            />
          </div>
        </div>

        {/* Настройки для водителя: Места и Цена */}
        {role === 'driver' && (
          <>
            <button
              type="button"
              className="compact-disclosure driver-summary"
              onClick={() => setShowDriverDetails((open) => !open)}
              aria-expanded={showDriverDetails}
              aria-controls="driver-parameters-panel"
            >
              <span className="compact-disclosure-main">
                <Users size={16} aria-hidden="true" />
                <span>{t('dash.trip_details')}</span>
              </span>
              <span className="driver-summary-value">
                {seats} {seatWord} · {price > 0 ? `${price} ${t('common.som')}` : t('dash.free_lower')}
              </span>
              <ChevronDown
                size={17}
                className={`compact-disclosure-chevron ${showDriverDetails ? 'open' : ''}`}
                aria-hidden="true"
              />
            </button>

            {showDriverDetails && (
              <div className="driver-parameters-card" id="driver-parameters-panel">
            {/* Места */}
            <div className="parameter-row">
              <div className="param-label-group">
                <Users size={16} className="text-muted" />
                <span className="param-title">{t('dash.seats_free')}</span>
              </div>
              <div className="stepper-box">
                <button
                  type="button"
                  className="stepper-btn"
                  onClick={() => setSeats(s => Math.max(1, s - 1))}
                  disabled={seats <= 1}
                  aria-label={t('dash.seats_dec_aria')}
                >
                  <Minus size={14} aria-hidden="true" />
                </button>
                <span className="stepper-value" role="status" aria-live="polite" aria-label={t('dash.seats_count_aria', { count: seats })}>{seats}</span>
                <button
                  type="button"
                  className="stepper-btn"
                  onClick={() => setSeats(s => Math.min(8, s + 1))}
                  disabled={seats >= 8}
                  aria-label={t('dash.seats_inc_aria')}
                >
                  <Plus size={14} aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* Цена за место */}
            <div className="parameter-row">
              <div className="param-label-group">
                <CreditCard size={16} className="text-muted" />
                <span className="param-title">{t('dash.price_per_seat')}</span>
              </div>
              <div className="price-input-wrap">
                <input
                  type="number"
                  aria-label={t('dash.price_per_seat_aria')}
                  min="0"
                  max="9999"
                  step="50"
                  value={price || ''}
                  onChange={e => setPrice(Math.max(0, parseInt(e.target.value) || 0))}
                  placeholder="0"
                  className="price-number-input"
                />
                <span className="currency-label">{t('common.som_upper')}</span>
              </div>
            </div>
              </div>
            )}
          </>
        )}

        <button type="submit" className="primary-btn submit-action-btn">
          <Search size={18} />
          <span>{role === 'driver' ? t('dash.find_passengers') : t('dash.find_driver')}</span>
          <ArrowRight size={16} />
        </button>
      </form>

      {showRoutePreview && (
        <RouteMapPreview
          role={role}
          from={from.trim()}
          to={to.trim()}
          dateLabel={formatDateLabel(date)}
          time={time}
          seats={seats}
          price={price}
          onClose={() => setShowRoutePreview(false)}
          onSearch={() => onSearch(buildSearchPayload())}
        />
      )}

    </div>
  );
}
