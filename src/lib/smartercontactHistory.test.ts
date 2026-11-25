import { describe, expect, it } from 'vitest';
import { parseSmarterContactHistory, splitCampaigns, toIsoDate } from './smartercontactHistory';

const HEADER =
  'Date Added,Phone,First name,Last name,Email,Campaigns,Property Address,Property City,Property State,Property Zip,APN,Parcel county,Parcel acres,Parcel state,Owner Full Name';

describe('toIsoDate', () => {
  it('converts M/D/YYYY to ISO', () => {
    expect(toIsoDate('7/29/2026')).toBe('2026-07-29');
    expect(toIsoDate('11/9/2026')).toBe('2026-11-09');
  });

  it('rejects anything else', () => {
    expect(toIsoDate('2026-07-29')).toBeNull();
    expect(toIsoDate('13/1/2026')).toBeNull();
    expect(toIsoDate('')).toBeNull();
  });
});

describe('splitCampaigns', () => {
  it('splits on pipes and drops blanks and repeats', () => {
    expect(splitCampaigns('AL Baldwin 07/26|AL Baldwin REHIT| AL Baldwin 07/26 |')).toEqual([
      'AL Baldwin 07/26',
      'AL Baldwin REHIT',
    ]);
  });
});

describe('parseSmarterContactHistory', () => {
  it('reads one row per contact with its campaigns, phone and date', () => {
    const text = [
      HEADER,
      '7/29/2026,+12515104816,John,Barbato,,"AL Baldwin 07/26 10YR|AL Baldwin REHIT",Avenida Alberto,,,,60-05-16-0-000-011.001,Baldwin,0.16,AL,Barbato John',
    ].join('\n');
    const { rows, error } = parseSmarterContactHistory(text);
    expect(error).toBeNull();
    expect(rows).toEqual([
      {
        apn: '60-05-16-0-000-011.001',
        state: 'AL',
        county: 'Baldwin',
        owner: 'Barbato John',
        phone: '+12515104816',
        date_added: '2026-07-29',
        campaigns: ['AL Baldwin 07/26 10YR', 'AL Baldwin REHIT'],
      },
    ]);
  });

  it('keeps a row with a blank phone', () => {
    const text = [HEADER, '7/12/2026,,A,B,,"C",,,,,52-08-25,Baldwin,1,AL,Owner'].join('\n');
    expect(parseSmarterContactHistory(text).rows[0].phone).toBe('');
  });

  it('refuses a file that is not a campaign export', () => {
    const text = 'Name,Amount\nA,1';
    const { rows, error } = parseSmarterContactHistory(text);
    expect(rows).toEqual([]);
    expect(error).toMatch(/not a SmarterContact campaign export/);
  });

  it('refuses a file with only a header', () => {
    expect(parseSmarterContactHistory(HEADER).error).toMatch(/at least one contact row/);
  });
});
