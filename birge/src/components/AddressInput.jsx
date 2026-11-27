import React, { useState, useRef, useEffect, useId } from 'react';
import { MapPin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, tokenStorage } from '../utils/api';

// Список популярных мест Бишкека для автодополнения
const BISHKEK_PLACES = [
    'Жилмассив Ала-Арча',
    'Жилмассив Аламедин-1',
    'Жилмассив Аламедин-2',
    'Жилмассив Джал',
    'Жилмассив Кара-Жыгач',
    'Жилмассив Асанбай',
    'Жилмассив Тунгуч',
    'Жилмассив Восток-5',
    'Жилмассив МКр-7',
    'Жилмассив Южные Магистрали',
    'Жилмассив Ак-Орго',
    'Жилмассив Кок-Жар',
    'ЦУМ (Центр)',
    'Площадь Ала-Тоо',
    'Ошский базар',
    'Дордой Базар',
    'Аэропорт Манас',
    'Западный автовокзал',
    'АУЦА',
    'КНУ им. Баласагына',
    'Политехнический университет',
    'Кыргызско-Российский университет',
    'ГКБ №1 (Скорая)',
    'Национальный госпиталь',
    'ТЦ Бишкек Парк',
    'Парк Панфилова',
    'Проспект Чуй',
    'Пр. Манаса',
    'Улица Ахунбаева',
];

export default function AddressInput({
    value,
    onChange,
    placeholder,
    iconColor = 'var(--primary)',
    name,
    invalid = false,
    describedBy,
}) {
    const { t } = useTranslation();
    const [suggestions, setSuggestions] = useState([]);
    const [showDropdown, setShowDropdown] = useState(false);
    const [highlighted, setHighlighted] = useState(-1);
    const inputRef = useRef(null);
    const dropdownRef = useRef(null);
    const geoTimerRef = useRef(null);
    const listId = useId().replace(/:/g, '');
    const optionId = (index) => `${listId}-option-${index}`;

    useEffect(() => {
        return () => clearTimeout(geoTimerRef.current);
    }, []);

    const handleChange = (e) => {
        const val = e.target.value;
        onChange(val);
        setHighlighted(-1);
        clearTimeout(geoTimerRef.current);
        if (val.length >= 2) {
            const filtered = BISHKEK_PLACES.filter(p =>
                p.toLowerCase().includes(val.toLowerCase())
            ).slice(0, 5);
            setSuggestions(filtered);
            setShowDropdown(filtered.length > 0);

            if (val.trim().length >= 3 && tokenStorage.get() && typeof api.geocodeAddress === 'function') {
                geoTimerRef.current = setTimeout(async () => {
                    try {
                        const remote = await api.geocodeAddress(val.trim(), 5);
                        if (!Array.isArray(remote) || remote.length === 0) return;
                        const remoteLabels = remote.map((r) => r.label).filter(Boolean);
                        const merged = [...new Set([...filtered, ...remoteLabels])].slice(0, 5);
                        setSuggestions(merged);
                        setShowDropdown(merged.length > 0);
                    } catch {
                        // Offline fallback already displayed.
                    }
                }, 300);
            }
        } else {
            setShowDropdown(false);
        }
    };

    const handleSelect = (place) => {
        onChange(place);
        setShowDropdown(false);
        setHighlighted(-1);
        inputRef.current?.blur();
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
            setShowDropdown(false);
            setHighlighted(-1);
            return;
        }
        if (!suggestions.length) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setShowDropdown(true);
            setHighlighted((current) => {
                if (e.key === 'ArrowDown') return current < suggestions.length - 1 ? current + 1 : 0;
                return current > 0 ? current - 1 : suggestions.length - 1;
            });
            return;
        }
        if (e.key === 'Enter' && showDropdown && highlighted >= 0) {
            e.preventDefault();
            handleSelect(suggestions[highlighted]);
        }
    };

    // Закрываем при клике вне
    useEffect(() => {
        const handler = (e) => {
            if (!dropdownRef.current?.contains(e.target) && !inputRef.current?.contains(e.target)) {
                setShowDropdown(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    return (
        <div style={{ position: 'relative', flex: 1 }}>
            <MapPin
                size={18}
                style={{
                    position: 'absolute', left: 13, top: '50%',
                    transform: 'translateY(-50%)', color: iconColor, pointerEvents: 'none', zIndex: 1
                }}
            />
            <input
                ref={inputRef}
                type="text"
                name={name}
                value={value}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                onFocus={() => {
                    if (suggestions.length > 0) setShowDropdown(true);
                }}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={showDropdown}
                aria-controls={showDropdown ? listId : undefined}
                aria-activedescendant={showDropdown && highlighted >= 0 ? optionId(highlighted) : undefined}
                aria-label={placeholder || t('address.default_aria')}
                aria-invalid={invalid ? 'true' : 'false'}
                aria-describedby={describedBy}
                placeholder={placeholder}
                autoComplete="off"
                style={{
                    width: '100%',
                    padding: '13px 12px 13px 42px',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '12px',
                    fontSize: '0.95rem',
                    background: 'var(--bg-card)',
                    color: 'var(--text-main)',
                    outline: 'none',
                    transition: 'border-color 0.2s, background-color 0.2s',
                    boxSizing: 'border-box',
                }}
                onFocusCapture={(e) => { e.target.style.borderColor = iconColor; }}
                onBlur={(e) => { e.target.style.borderColor = 'var(--border-subtle)'; }}
            />

            {showDropdown && (
                <div
                    ref={dropdownRef}
                    id={listId}
                    role="listbox"
                    aria-label={t('address.suggestions_aria')}
                    style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '14px',
                        boxShadow: 'var(--floating-shadow)',
                        zIndex: 999,
                        overflow: 'hidden',
                        marginTop: '4px',
                    }}
                >
                    {suggestions.map((place, i) => (
                        <button
                            key={place}
                            id={optionId(i)}
                            type="button"
                            role="option"
                            tabIndex={-1}
                            aria-selected={highlighted === i}
                            onMouseDown={() => handleSelect(place)}
                            onMouseEnter={() => setHighlighted(i)}
                            onMouseLeave={() => setHighlighted(-1)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px',
                                width: '100%',
                                padding: '11px 14px',
                                border: 'none',
                                background: highlighted === i ? 'var(--bg-subtle)' : 'transparent',
                                textAlign: 'left',
                                cursor: 'pointer',
                                fontSize: '0.9rem',
                                color: 'var(--text-main)',
                                transition: 'background 0.15s',
                                borderBottom: i < suggestions.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                            }}
                        >
                            <MapPin size={14} color={iconColor} />
                            {place}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
