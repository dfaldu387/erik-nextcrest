import { describe, expect, it } from 'vitest';
import { extractPhones, normalizePhone } from './phones';

describe('normalizePhone', () => {
  it('keeps ten digits and drops a leading country code', () => {
    expect(normalizePhone('(832) 457-1487')).toBe('8324571487');
    expect(normalizePhone('+1 832 457 1487')).toBe('8324571487');
  });

  it('rejects numbers that are not ten digits', () => {
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });
});

describe('extractPhones', () => {
  const headers = [
    'Phone', 'Phone (Line Type)', 'Phone (DNC)', 'Phone (DNC Federal)',
    'Alt Phone 1', 'Alt Phone 1 (Line Type)', 'Alt Phone 1 (DNC)', 'Alt Phone 1 (DNC Federal)',
    'Alt Phone 2', 'Alt Phone 2 (Line Type)', 'Owner 1 Full Name',
  ];

  it('reads numbers in column order with line type and DNC flags', () => {
    const cells = ['8324571487', 'Mobile', 'DNC', '', '4258295334', 'Mobile', '', 'DNC Federal', '', '', 'Rettig John'];
    expect(extractPhones(headers, cells)).toEqual([
      { phone: '8324571487', position: 1, lineType: 'Mobile', dnc: true, dncFederal: false },
      { phone: '4258295334', position: 2, lineType: 'Mobile', dnc: true, dncFederal: true },
    ]);
  });

  it('skips blank phone cells and repeats on the same row', () => {
    const cells = ['8324571487', '', '', '', '8324571487', '', '', '', '', '', ''];
    const phones = extractPhones(headers, cells);
    expect(phones.map((p) => p.phone)).toEqual(['8324571487']);
  });

  it('reads Land Portal numbered columns with a Type column', () => {
    const numbered = ['Phone 1', 'Phone 1 Type', 'Phone 1 DNC', 'Phone 2', 'Phone 2 Type', 'Phone 2 DNC'];
    const phones = extractPhones(numbered, ['2516239870', 'Mobile', '', '2514580975', 'Landline', 'DNC']);
    expect(phones).toEqual([
      { phone: '2516239870', position: 1, lineType: 'Mobile', dnc: false, dncFederal: false },
      { phone: '2514580975', position: 2, lineType: 'Landline', dnc: true, dncFederal: false },
    ]);
  });
});
