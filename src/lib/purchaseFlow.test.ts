import { describe, expect, it } from 'vitest';
import { exportRequest, ownedKeysFrom, ownedRecordsFrom, splitByOwned, toSearchResults } from './purchaseFlow';

const rows = [
  { propertyid: 1, fips: '12067', apn: '33-04-11-0000-0000-00601', ownername1full: 'HYDE JIMMY A', situsfullstreetaddress: '2856 W US 27', lotsizeacres: 1.7 },
  { propertyid: 2, fips: '12067', apn: '04-05-11-0000-0000-00201', ownername1full: 'GAMMA RENTALS LLC', situsfullstreetaddress: '', lotsizeacres: null },
  { propertyid: 1, fips: '12067', apn: '33-04-11-0000-0000-00601', ownername1full: 'HYDE JIMMY A', situsfullstreetaddress: '2856 W US 27', lotsizeacres: 1.7 },
  { propertyid: 3, fips: '12067', apn: '', ownername1full: 'NO APN', situsfullstreetaddress: '', lotsizeacres: 5 },
];

const lafayette = () => ({ state: 'FL', county: 'Lafayette' });

describe('toSearchResults', () => {
  it('keeps one result per property ID and maps the fields', () => {
    const results = toSearchResults(rows);
    expect(results.map((r) => r.propertyId)).toEqual(['1', '2', '3']);
    expect(results[0]).toMatchObject({ fips: '12067', apn: '33-04-11-0000-0000-00601', owner: 'HYDE JIMMY A', acres: 1.7 });
    expect(results[1].acres).toBeNull();
  });
});

describe('splitByOwned', () => {
  it('separates parcels already owned in the same county', () => {
    const results = toSearchResults(rows);
    const owned = ownedKeysFrom([{ apn: '33-04-11-0000-0000-00601', state: 'FL', county: 'Lafayette' }]);
    const { fresh, owned: already } = splitByOwned(results, owned, lafayette);
    expect(already.map((r) => r.propertyId)).toEqual(['1']);
    expect(fresh.map((r) => r.propertyId)).toEqual(['2', '3']);
  });

  it('matches APNs written in a different format', () => {
    const results = toSearchResults([{ propertyid: 9, fips: '12067', apn: '33 04 11 0000 0000 00601', lotsizeacres: 1 }]);
    const owned = ownedKeysFrom([{ apn: '33-04-11-0000-0000-00601', state: 'FL', county: 'Lafayette' }]);
    expect(splitByOwned(results, owned, lafayette).owned).toHaveLength(1);
  });

  it('does not treat the same APN in another county as owned', () => {
    const results = toSearchResults([rows[0]]);
    const owned = ownedKeysFrom([{ apn: '33-04-11-0000-0000-00601', state: 'FL', county: 'Bay' }]);
    expect(splitByOwned(results, owned, lafayette).fresh).toHaveLength(1);
  });

  it('checks each result against the county its FIPS code belongs to', () => {
    const results = toSearchResults([
      { propertyid: 5, fips: '12005', apn: 'A-1', lotsizeacres: 1 },
      { propertyid: 6, fips: '12067', apn: 'A-1', lotsizeacres: 1 },
    ]);
    const owned = ownedKeysFrom([{ apn: 'A-1', state: 'FL', county: 'Bay' }]);
    const place = (fips: string) => (fips === '12005' ? { state: 'FL', county: 'Bay' } : { state: 'FL', county: 'Lafayette' });
    const { fresh, owned: already } = splitByOwned(results, owned, place);
    expect(already.map((r) => r.propertyId)).toEqual(['5']);
    expect(fresh.map((r) => r.propertyId)).toEqual(['6']);
  });

  it('treats results with an unknown county as new', () => {
    const results = toSearchResults([{ propertyid: 7, fips: '99999', apn: 'A-1', lotsizeacres: 1 }]);
    const owned = ownedKeysFrom([{ apn: 'A-1', state: 'FL', county: 'Bay' }]);
    expect(splitByOwned(results, owned, () => null).fresh).toHaveLength(1);
  });
});

describe('exportRequest', () => {
  it('lists distinct FIPS codes and the selected property IDs', () => {
    const results = toSearchResults(rows);
    expect(exportRequest(results)).toEqual({ fips: ['12067'], propertyid: ['1', '2', '3'] });
  });
});

describe('ownedRecordsFrom', () => {
  it('builds review records with the parcel identity filled in', () => {
    const [record] = ownedRecordsFrom([{ apn: 'A-1', state: 'FL', county: 'Bay' }]);
    expect(record).toMatchObject({ apn: 'A-1', state: 'FL', county: 'Bay' });
  });
});
