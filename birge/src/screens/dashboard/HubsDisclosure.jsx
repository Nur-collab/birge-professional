import React from 'react';
import { ChevronDown, MapPin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BISHKEK_HUBS, HUB_CATEGORIES } from './bishkekHubs';

export default function HubsDisclosure({
  showHubs,
  onToggleHubs,
  tagTarget,
  onChangeTarget,
  selectedCategory,
  onChangeCategory,
  from,
  to,
  onSelectHub,
}) {
  const { t } = useTranslation();

  return (
    <>
      <button
        type="button"
        className="compact-disclosure"
        onClick={onToggleHubs}
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
                onClick={() => onChangeTarget('from')}
                aria-pressed={tagTarget === 'from'}
              >
                {t('tags.target_from')}
              </button>
              <button
                type="button"
                className={`target-pill ${tagTarget === 'to' ? 'active' : ''}`}
                onClick={() => onChangeTarget('to')}
                aria-pressed={tagTarget === 'to'}
              >
                {t('tags.target_to')}
              </button>
            </div>
          </div>

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
                    onChangeCategory(cat.id);
                  }}
                  aria-pressed={selectedCategory === cat.id}
                >
                  <IconComp size={13} aria-hidden="true" />
                  <span>{t(cat.labelKey)}</span>
                </button>
              );
            })}
          </div>

          <div className="hubs-chips-scroll" role="group" aria-label={t('dash.popular_points')}>
            {BISHKEK_HUBS
              .filter((h) => selectedCategory === 'all' || h.cat === selectedCategory)
              .map((hub) => {
                const isSelected = tagTarget === 'from' ? from === hub.name : to === hub.name;
                return (
                  <button
                    key={hub.name}
                    type="button"
                    className={`hub-chip ${isSelected ? 'selected' : ''}`}
                    onClick={() => onSelectHub(hub.name)}
                    aria-pressed={isSelected}
                  >
                    {hub.name}
                  </button>
                );
              })}
          </div>
        </div>
      )}
    </>
  );
}
