import { describe, expect, it } from 'vitest';
import { areaForPath } from '@/lib/permissions';

describe('areaForPath', () => {
  it('maps pages to their permission area', () => {
    expect(areaForPath('/dashboard')).toBe('Dashboard');
    expect(areaForPath('/properties/abc')).toBe('Properties');
    expect(areaForPath('/purchases/123')).toBe('Data Purchases and Import');
    expect(areaForPath('/optouts')).toBe('Opt-outs and wrong numbers');
    expect(areaForPath('/team')).toBe('Team and settings');
  });

  it('does not match a page that only shares a prefix', () => {
    expect(areaForPath('/propertiesX')).toBeNull();
  });

  it('leaves unlisted pages open', () => {
    expect(areaForPath('/sign-in')).toBeNull();
  });
});
