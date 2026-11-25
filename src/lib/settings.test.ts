import { describe, expect, it } from 'vitest';
import { defaultSettings, settingsSchema } from './settings';

describe('settings validation', () => {
  it('accepts the defaults', () => {
    expect(settingsSchema.safeParse(defaultSettings).success).toBe(true);
  });

  it('rejects a re-hit window outside 30 to 180 days', () => {
    const result = settingsSchema.safeParse({ ...defaultSettings, rehitDays: 10 });
    expect(result.success).toBe(false);
  });

  it('rejects a fractional number of contacts', () => {
    expect(settingsSchema.safeParse({ ...defaultSettings, maxContacts: 2.5 }).success).toBe(false);
  });

  it('rejects an empty organisation name', () => {
    expect(settingsSchema.safeParse({ ...defaultSettings, organizationName: '   ' }).success).toBe(false);
  });
});
