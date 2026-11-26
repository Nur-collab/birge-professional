import { afterEach, describe, expect, it } from 'vitest';
import i18n, { resources } from './i18n';

describe('i18n dictionaries and language switching', () => {
    afterEach(async () => {
        await i18n.changeLanguage('ru');
    });

    it('keeps identical non-empty key sets across ru and ky translations', () => {
        const ruEntries = resources.ru.translation;
        const kyEntries = resources.ky.translation;
        const ruKeys = Object.keys(ruEntries).sort();
        const kyKeys = Object.keys(kyEntries).sort();

        expect(kyKeys).toEqual(ruKeys);

        for (const key of ruKeys) {
            if (key === 'review.rating.0') continue;
            expect(ruEntries[key], `Empty ru translation for ${key}`).toBeTruthy();
            expect(kyEntries[key], `Empty ky translation for ${key}`).toBeTruthy();
        }
        expect(kyEntries['review.ok']).not.toBe(kyEntries['review.good']);
    });

    it('updates <html lang> when switching between ru and ky', async () => {
        await i18n.changeLanguage('ky');
        expect(document.documentElement.lang).toBe('ky');
        expect(i18n.t('dash.find_driver')).toBe('Ылайыктуу айдоочуну табуу');

        await i18n.changeLanguage('ru');
        expect(document.documentElement.lang).toBe('ru');
    });
});
