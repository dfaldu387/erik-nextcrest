import { describe, expect, it } from 'vitest';
import { parseCsv, toRawCsv } from './csv';

describe('toRawCsv', () => {
  it('keeps cells exactly as read, without formula escaping', () => {
    const table = [
      ['APN', 'Owner'],
      ['04-05-11', '=HYPERLINK("x")'],
    ];
    const csv = toRawCsv(table);
    expect(csv).toBe('APN,Owner\r\n04-05-11,"=HYPERLINK(""x"")"');
    expect(parseCsv(csv)).toEqual(table);
  });

  it('quotes cells with commas, quotes and line breaks so they round-trip', () => {
    const table = [['Name', 'Note'], ['Smith, John', 'line one\nline two']];
    expect(parseCsv(toRawCsv(table))).toEqual(table);
  });
});
