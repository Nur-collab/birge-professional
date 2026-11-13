import { describe, expect, it } from 'vitest';
import { localDateStr } from './date';

describe('localDateStr', () => {
  it('returns a Bishkek ISO date', () => {
    expect(localDateStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('moves by whole days', () => {
    const today = new Date(`${localDateStr()}T00:00:00Z`);
    const tomorrow = new Date(today.getTime() + 86400000);

    expect(localDateStr(1)).toBe(tomorrow.toISOString().slice(0, 10));
    expect(localDateStr(-1)).not.toBe(localDateStr());
  });
});
