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
  { id: 'all', label: 'Все', icon: Layers },
  { id: 'center', label: 'Центр', icon: Building2 },
  { id: 'districts', label: 'Районы', icon: Compass },
  { id: 'markets', label: 'Рынки', icon: ShoppingBag },
  { id: 'chuy', label: 'Пригород', icon: Navigation },
];

export default function Dashboard({ onSearch, currentUser, onShowSettings }) {
  const { t } = useTranslation();
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
    if (d === today) return 'Сегодня';
    if (d === tomorrow) return 'Завтра';
    const dt = new Date(d);
    return dt.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' });
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
    if (!from.trim()) newErrors.from = 'Укажите точку отправления';
    if (!to.trim()) newErrors.to = 'Укажите точку назначения';
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setErrors({});

    onSearch(buildSearchPayload());
  };

  return (
    <div className="dashboard screen-content">
      <div className="dashboard-heading">
        <p className="dashboard-kicker">Бишкек · Чуйская область</p>
        <h2 className="dashboard-title">{firstName ? `Куда поедем, ${firstName}?` : 'Куда поедем?'}</h2>
      </div>

      {/* Селектор роли (iOS / Linear Segmented Pill) */}
      <div className="role-switch-container">
        <div className="role-switch" role="group" aria-label="Роль в поездке">
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
            <span>Пассажир</span>
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
            <span>Водитель</span>
          </button>
        </div>
      </div>

      {/* Основная карточка маршрута */}
      <form className="route-form-card" onSubmit={handleSubmit}>
        <div className="form-header">
          <div className="form-header-title">
            <MapPin size={16} className="text-primary" />
            <span>{role === 'driver' ? 'Маршрут' : 'Поиск попутчиков'}</span>
          </div>
          <div className="form-header-actions">
            {role === 'driver' && currentUser && !currentUser.car_model && (
              <button
                type="button"
                className="car-warning-chip"
                onClick={onShowSettings}
                title="Пассажиры не увидят марку и номер машины"
                aria-label="Данные автомобиля не указаны. Пассажиры не увидят марку и номер машины. Открыть настройки"
              >
                <AlertTriangle size={13} aria-hidden="true" />
                <span>Нет авто</span>
              </button>
            )}
            <button
              type="button"
              className="swap-route-btn route-map-btn"
              onClick={() => setShowRoutePreview(true)}
              disabled={!from.trim() || !to.trim()}
              title={from.trim() && to.trim() ? 'Показать маршрут на карте' : 'Сначала укажите откуда и куда'}
              aria-label="Показать маршрут на карте"
            >
              <MapIcon size={17} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="swap-route-btn"
              onClick={handleSwapAddresses}
              title="Поменять местами"
              aria-label="Поменять местами точки отправления и назначения"
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
                placeholder="Откуда едем..."
                iconColor={errors.from ? 'var(--danger)' : 'var(--primary)'}
                name="from"
                invalid={Boolean(errors.from)}
                describedBy={errors.from ? 'dashboard-from-error' : undefined}
              />
              <button
                type="button"
                onClick={handleGeolocate}
                disabled={geoLoading}
                title="Определить мое местоположение"
                aria-label="Определить мое местоположение"
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
                placeholder="Куда направляемся..."
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
            <span>Популярные места</span>
            <span className="compact-disclosure-meta">Быстрый выбор</span>
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
            <div className="section-label">Популярные точки</div>
            <div className="target-toggle" role="group" aria-label="Куда применить популярную точку">
              <button
                type="button"
                className={`target-pill ${tagTarget === 'from' ? 'active' : ''}`}
                onClick={() => setTagTarget('from')}
                aria-pressed={tagTarget === 'from'}
              >
                Откуда
              </button>
              <button
                type="button"
                className={`target-pill ${tagTarget === 'to' ? 'active' : ''}`}
                onClick={() => setTagTarget('to')}
                aria-pressed={tagTarget === 'to'}
              >
                Куда
              </button>
            </div>
          </div>

          {/* Категории */}
          <div className="category-scroll" role="group" aria-label="Категории популярных точек">
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
                  <span>{cat.label}</span>
                </button>
              );
            })}
          </div>

          {/* Список хабов */}
          <div className="hubs-chips-scroll" role="group" aria-label="Популярные точки">
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
              <span>Дата</span>
            </div>
            <div className="date-picker-box">
              <span className="date-display" aria-hidden="true">{formatDateLabel(date)}</span>
              <input
                type="date"
                aria-label="Дата поездки"
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
              <span>Время</span>
            </div>
            <input
              type="time"
              aria-label="Время поездки"
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
                <span>Детали поездки</span>
              </span>
              <span className="driver-summary-value">
                {seats} {seats === 1 ? 'место' : seats < 5 ? 'места' : 'мест'} · {price > 0 ? `${price} сом` : 'бесплатно'}
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
                <span className="param-title">Свободных мест</span>
              </div>
              <div className="stepper-box">
                <button
                  type="button"
                  className="stepper-btn"
                  onClick={() => setSeats(s => Math.max(1, s - 1))}
                  disabled={seats <= 1}
                  aria-label="Уменьшить количество свободных мест"
                >
                  <Minus size={14} aria-hidden="true" />
                </button>
                <span className="stepper-value" role="status" aria-live="polite" aria-label={`Свободных мест: ${seats}`}>{seats}</span>
                <button
                  type="button"
                  className="stepper-btn"
                  onClick={() => setSeats(s => Math.min(8, s + 1))}
                  disabled={seats >= 8}
                  aria-label="Увеличить количество свободных мест"
                >
                  <Plus size={14} aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* Цена за место */}
            <div className="parameter-row">
              <div className="param-label-group">
                <CreditCard size={16} className="text-muted" />
                <span className="param-title">Взнос за место</span>
              </div>
              <div className="price-input-wrap">
                <input
                  type="number"
                  aria-label="Взнос за место, сом"
                  min="0"
                  max="9999"
                  step="50"
                  value={price || ''}
                  onChange={e => setPrice(Math.max(0, parseInt(e.target.value) || 0))}
                  placeholder="0"
                  className="price-number-input"
                />
                <span className="currency-label">СОМ</span>
              </div>
            </div>
              </div>
            )}
          </>
        )}

        <button type="submit" className="primary-btn submit-action-btn">
          <Search size={18} />
          <span>{role === 'driver' ? 'Найти пассажиров по пути' : 'Найти подходящего водителя'}</span>
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

      <style>{`
        .dashboard {
          display: flex;
          flex-direction: column;
          gap: 0.85rem;
        }

        /* Role Switcher */
        .role-switch-container {
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 5px;
          box-shadow: var(--card-shadow);
        }
        .role-switch {
          display: flex;
          background: var(--bg-subtle);
          border-radius: 10px;
          padding: 3px;
          gap: 4px;
        }
        .role-option {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 10px 14px;
          border: none;
          border-radius: 8px;
          background: transparent;
          color: var(--text-muted);
          font-size: 0.88rem;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .role-option:hover {
          color: var(--text-main);
        }
        .role-option.active {
          background: var(--bg-card);
          color: var(--primary);
          box-shadow: 0 1px 4px var(--shadow-soft);
        }

        .form-header-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .car-warning-chip {
          min-height: 38px;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 0 9px;
          border: 1px solid var(--warning-border);
          border-radius: 9px;
          background: var(--warning-soft);
          color: var(--text-main);
          font: inherit;
          font-size: 0.68rem;
          font-weight: 700;
          white-space: nowrap;
          cursor: pointer;
          transition: border-color 0.18s ease, background-color 0.18s ease;
        }
        .car-warning-chip svg {
          color: var(--warning);
          flex-shrink: 0;
        }
        .car-warning-chip:hover { border-color: var(--warning); }

        /* Form */
        .route-form-card {
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          padding: 1.25rem;
          box-shadow: var(--card-shadow);
        }
        .form-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 1rem;
        }
        .form-header-title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.95rem;
          font-weight: 700;
          color: var(--text-main);
        }
        .swap-route-btn {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          border: 1px solid var(--border-subtle);
          background: var(--bg-subtle);
          color: var(--text-muted);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .swap-route-btn:hover {
          background: var(--border-subtle);
          color: var(--text-main);
        }
        .swap-route-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        /* Connected Route */
        .connected-route-card {
          display: flex;
          align-items: stretch;
          gap: 12px;
          background: var(--bg-subtle);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 10px 12px;
          margin-bottom: 1rem;
        }
        .route-track-indicator {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: space-between;
          padding: 14px 0;
          width: 14px;
          flex-shrink: 0;
        }
        .track-node {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          border: 2px solid var(--bg-subtle);
        }
        .origin-node {
          background: var(--primary);
          box-shadow: 0 0 0 2px var(--primary-glow);
        }
        .dest-node {
          background: var(--danger);
          box-shadow: 0 0 0 2px var(--danger-border);
        }
        .track-line {
          width: 2px;
          flex: 1;
          background: var(--border-strong);
          margin: 4px 0;
        }
        .route-inputs-col {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .route-input-cell {
          display: flex;
          align-items: center;
          position: relative;
        }
        .route-input-cell > div {
          flex: 1;
        }
        .inline-geo-btn {
          width: 32px;
          height: 32px;
          border: 1px solid var(--border-subtle);
          border-radius: 8px;
          background: var(--bg-card);
          color: var(--primary);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          margin-left: 6px;
          flex-shrink: 0;
          transition: all 0.2s;
        }
        .inline-geo-btn:hover {
          background: var(--border-subtle);
        }
        .inline-geo-btn:disabled {
          opacity: 0.5;
          cursor: wait;
        }
        .input-err-msg {
          font-size: 0.72rem;
          color: var(--danger);
          margin: 0;
          padding-left: 2px;
        }

        /* Hubs */
        .hubs-section {
          background: var(--bg-subtle);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 12px;
          margin-bottom: 1rem;
        }
        .hubs-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 10px;
        }
        .target-toggle {
          display: flex;
          background: var(--border-subtle);
          border-radius: 6px;
          padding: 2px;
          gap: 2px;
        }
        .target-pill {
          border: none;
          background: transparent;
          font-size: 0.72rem;
          font-weight: 700;
          color: var(--text-muted);
          padding: 3px 8px;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .target-pill.active {
          background: var(--bg-card);
          color: var(--text-main);
          box-shadow: 0 1px 3px var(--shadow-soft);
        }
        .category-scroll {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: 10px;
        }
        .category-pill {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 6px 10px;
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-pill);
          background: var(--bg-card);
          color: var(--text-muted);
          font-size: 0.76rem;
          font-weight: 600;
          cursor: pointer;
          white-space: nowrap;
          transition: all 0.18s;
        }
        .category-pill:hover {
          color: var(--text-main);
          border-color: var(--border-strong);
        }
        .category-pill.active {
          background: var(--primary);
          color: var(--on-primary);
          border-color: var(--primary);
          box-shadow: 0 2px 8px var(--primary-glow);
        }
        .hubs-chips-scroll {
          display: flex;
          gap: 6px;
          overflow-x: auto;
          padding-bottom: 2px;
          scrollbar-width: none;
        }
        .hubs-chips-scroll::-webkit-scrollbar { display: none; }
        .hub-chip {
          white-space: nowrap;
          border: 1px solid var(--border-subtle);
          background: var(--bg-card);
          color: var(--text-main);
          font-size: 0.78rem;
          font-weight: 600;
          padding: 6px 12px;
          border-radius: var(--radius-pill);
          cursor: pointer;
          transition: all 0.18s;
          flex-shrink: 0;
        }
        .hub-chip:hover {
          border-color: var(--primary);
          color: var(--primary);
        }
        .hub-chip.selected {
          background: var(--primary);
          color: var(--on-primary);
          border-color: var(--primary);
          box-shadow: 0 2px 8px var(--primary-glow);
        }

        /* DateTime */
        .datetime-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          margin-bottom: 1rem;
        }
        .datetime-cell {
          background: var(--bg-subtle);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .cell-label {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 0.72rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-muted);
        }
        .date-picker-box {
          position: relative;
          display: flex;
          align-items: center;
          border-radius: 6px;
        }
        .date-picker-box:focus-within {
          outline: 3px solid var(--focus-ring);
          outline-offset: 2px;
        }
        .date-display {
          font-size: 0.94rem;
          font-weight: 700;
          color: var(--text-main);
          cursor: pointer;
        }
        .hidden-native-input {
          position: absolute;
          inset: 0;
          opacity: 0;
          width: 100%;
          height: 100%;
          cursor: pointer;
        }
        .time-native-input {
          border: none;
          background: transparent;
          font-size: 0.94rem;
          font-weight: 700;
          color: var(--text-main);
          outline: none;
          padding: 0;
          cursor: pointer;
        }
        .time-native-input:focus-visible {
          outline: 3px solid var(--focus-ring);
          outline-offset: 2px;
        }

        /* Driver parameters */
        .driver-parameters-card {
          background: var(--bg-subtle);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin-bottom: 1.1rem;
        }
        .parameter-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .param-label-group {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .param-title {
          font-size: 0.86rem;
          font-weight: 600;
          color: var(--text-main);
        }
        .stepper-box {
          display: flex;
          align-items: center;
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          border-radius: 8px;
          padding: 2px;
        }
        .stepper-btn {
          width: 28px;
          height: 28px;
          border: none;
          border-radius: 6px;
          background: transparent;
          color: var(--text-main);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: background 0.15s;
        }
        .stepper-btn:hover:not(:disabled) {
          background: var(--bg-subtle);
        }
        .stepper-btn:disabled {
          opacity: 0.3;
          cursor: not-allowed;
        }
        .stepper-value {
          font-size: 0.95rem;
          font-weight: 800;
          color: var(--text-main);
          min-width: 28px;
          text-align: center;
          font-variant-numeric: tabular-nums;
        }
        .price-input-wrap {
          display: flex;
          align-items: center;
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          border-radius: 8px;
          padding: 4px 8px;
          gap: 6px;
        }
        .price-input-wrap:focus-within {
          outline: 3px solid var(--focus-ring);
          outline-offset: 2px;
        }
        .price-number-input {
          width: 65px;
          border: none;
          background: transparent;
          font-size: 0.95rem;
          font-weight: 800;
          color: var(--text-main);
          text-align: right;
          outline: none;
          font-variant-numeric: tabular-nums;
        }
        .currency-label {
          font-size: 0.72rem;
          font-weight: 800;
          color: var(--text-muted);
          letter-spacing: 0.05em;
        }

        .submit-action-btn {
          margin-top: 0.2rem;
        }

        @keyframes spin {
          100% { transform: rotate(360deg); }
        }
        .spin {
          animation: spin 0.8s linear infinite;
        }
      `}</style>

      <style>{`
        .dashboard { gap: 14px; }
        .dashboard-heading { padding: 3px 2px 1px; }
        .dashboard-kicker {
          display: flex;
          align-items: center;
          gap: 7px;
          margin-bottom: 6px;
          color: var(--text-subtle);
          font-size: 0.64rem;
          font-weight: 800;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }
        .dashboard-kicker::before {
          content: '';
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--primary);
        }
        .dashboard-title {
          color: var(--text-main);
          font-size: clamp(1.5rem, 5vw, 1.8rem);
          font-weight: 800;
          line-height: 1.16;
          letter-spacing: -0.045em;
          text-wrap: balance;
        }

        .role-switch-container {
          padding: 0;
          border: 0;
          background: transparent;
          box-shadow: none;
        }
        .role-switch {
          gap: 4px;
          padding: 4px;
          border: 1px solid var(--border-subtle);
          border-radius: 14px;
          background: var(--bg-subtle);
        }
        .role-option {
          min-height: 44px;
          border-radius: 10px;
          color: var(--text-muted);
          font-size: 0.84rem;
        }
        .role-option.active {
          background: var(--bg-card);
          color: var(--primary);
          box-shadow: 0 1px 2px var(--shadow-soft), 0 8px 16px -12px var(--shadow-soft);
        }

        .compact-disclosure {
          width: 100%;
          min-height: 46px;
          margin-bottom: 16px;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 0 13px;
          border: 1px solid var(--border-subtle);
          border-radius: 14px;
          background: var(--bg-subtle);
          color: var(--text-main);
          font: inherit;
          text-align: left;
          cursor: pointer;
          transition: border-color 0.18s ease, background-color 0.18s ease;
        }
        .compact-disclosure:hover {
          border-color: var(--border-strong);
          background: var(--bg-card);
        }
        .compact-disclosure-main {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
          font-size: 0.82rem;
          font-weight: 700;
        }
        .compact-disclosure-main svg {
          color: var(--primary);
          flex-shrink: 0;
        }
        .compact-disclosure-meta {
          color: var(--text-subtle);
          font-size: 0.7rem;
          font-weight: 600;
          white-space: nowrap;
        }
        .compact-disclosure-chevron {
          margin-left: auto;
          flex-shrink: 0;
          color: var(--text-subtle);
          transition: transform 0.2s ease;
        }
        .compact-disclosure-chevron.open { transform: rotate(180deg); }
        .compact-disclosure[aria-expanded="true"] { margin-bottom: 8px; }
        .driver-summary-value {
          margin-left: auto;
          color: var(--text-muted);
          font-size: 0.74rem;
          font-weight: 700;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .driver-summary-value + .compact-disclosure-chevron { margin-left: 0; }

        .route-form-card {
          padding: 18px;
          border-radius: 24px;
          box-shadow: var(--card-shadow);
        }
        .form-header { margin-bottom: 14px; }
        .form-header-title {
          font-size: 1rem;
          font-weight: 800;
          letter-spacing: -0.02em;
        }
        .form-header-title svg { color: var(--primary); }
        .swap-route-btn {
          width: 38px;
          height: 38px;
          border-radius: 12px;
          background: var(--bg-subtle);
        }

        .connected-route-card {
          gap: 10px;
          margin-bottom: 16px;
          padding: 10px;
          border-radius: 16px;
          background: var(--bg-subtle);
        }
        .route-inputs-col { gap: 8px; }
        .route-track-indicator {
          width: 14px;
          padding: 15px 0;
        }
        .route-track-indicator .track-node {
          width: 9px;
          height: 9px;
          border: 2px solid var(--bg-subtle);
        }
        .origin-node {
          background: var(--primary);
          box-shadow: 0 0 0 3px var(--accent-soft);
        }
        .dest-node {
          background: var(--danger);
          box-shadow: 0 0 0 3px var(--danger-soft);
        }
        .track-line {
          width: 0;
          margin: 3px 0;
          border-left: 1px dashed var(--border-strong);
          background: transparent;
        }
        .inline-geo-btn {
          width: 38px;
          height: 38px;
          margin-left: 8px;
          border-radius: 12px;
          background: var(--bg-card);
        }

        .hubs-section {
          margin-bottom: 16px;
          padding: 14px;
          border-radius: 16px;
          background: var(--bg-subtle);
        }
        .hubs-top { margin-bottom: 12px; }
        .target-toggle {
          padding: 3px;
          border: 1px solid var(--border-subtle);
          border-radius: 10px;
          background: var(--bg-card);
        }
        .target-pill {
          min-height: 28px;
          padding: 3px 9px;
          border-radius: 7px;
        }
        .target-pill.active {
          background: var(--primary);
          color: var(--on-primary);
          box-shadow: none;
        }
        .category-pill {
          min-height: 32px;
          padding: 0 10px;
          border-color: var(--border-subtle);
          background: var(--bg-card);
          color: var(--text-muted);
        }
        .hub-chip {
          min-height: 34px;
          padding: 0 12px;
          border-color: var(--border-subtle);
          background: var(--bg-card);
          color: var(--text-main);
        }
        .category-pill.active,
        .hub-chip.selected {
          border-color: var(--primary);
          background: var(--primary);
          color: var(--on-primary);
          box-shadow: none;
        }
        .hub-chip:hover { border-color: var(--primary); color: var(--primary); }

        .datetime-grid { gap: 10px; margin-bottom: 16px; }
        .datetime-cell {
          gap: 7px;
          padding: 12px;
          border-radius: 16px;
          background: var(--bg-subtle);
        }
        .cell-label {
          color: var(--text-subtle);
          font-size: 0.66rem;
          letter-spacing: 0.1em;
        }
        .date-display,
        .time-native-input {
          color: var(--text-main);
          font-size: 0.9rem;
          font-weight: 800;
        }

        .driver-parameters-card {
          margin-bottom: 18px;
          padding: 14px;
          border-radius: 16px;
          background: var(--bg-subtle);
        }
        .param-title { font-size: 0.82rem; font-weight: 700; }
        .stepper-box,
        .price-input-wrap {
          border-radius: 10px;
          background: var(--bg-card);
        }
        .stepper-btn { width: 30px; height: 30px; border-radius: 8px; }

        .submit-action-btn {
          min-height: 54px;
          border-radius: 16px;
          font-size: 0.92rem;
        }

        [data-theme="dark"] .target-pill.active,
        [data-theme="dark"] .category-pill.active,
        [data-theme="dark"] .hub-chip.selected,
        [data-theme="dark"] .role-option.active {
          color: var(--on-primary);
        }
        [data-theme="dark"] .role-option.active {
          color: var(--primary);
        }
      `}</style>
    </div>
  );
}
