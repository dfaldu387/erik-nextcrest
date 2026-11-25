import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LandPortalError,
  createExport,
  filterProperties,
  getExportStatus,
  getFilterValues,
  splitFilters,
  toLegacyRow,
  toPropertyFields,
} from './landportal';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('toPropertyFields', () => {
  it('maps the standard property fields onto NextCrest property fields', () => {
    const fields = toPropertyFields({
      propertyid: 40444727,
      apn: '2011-B-0002',
      situsfullstreetaddress: '204 TOM WATSON AVE',
      situscity: 'IDEAL',
      situszip5: '31041',
      situsstate: 'GA',
      situscounty: 'Macon',
      legaldescription: 'LOT 3 AND NORTH HALF OF LOT 4 105 X 175',
      ownername1full: 'NELSON BRYANT',
      mailingfullstreetaddress: 'PO BOX 112',
    });

    expect(fields).toEqual({
      source: 'land_portal',
      originalSourceId: '40444727',
      state: 'GA',
      county: 'Macon',
      city: 'IDEAL',
      zipCode: '31041',
      address: '204 TOM WATSON AVE',
      legalDescription: 'LOT 3 AND NORTH HALF OF LOT 4 105 X 175',
      ownerName: 'NELSON BRYANT',
      mailingAddress: 'PO BOX 112',
    });
  });

  it('leaves out fields the account does not have, rather than setting them to null', () => {
    const fields = toPropertyFields({ propertyid: 1, situsstate: 'FL' });
    expect(fields).toEqual({ source: 'land_portal', originalSourceId: '1', state: 'FL' });
    expect('address' in fields).toBe(false);
  });

  it('builds the owner name from first and last name when the full name is missing', () => {
    const fields = toPropertyFields({ propertyid: 2, owner1firstname: 'BRYANT', owner1lastname: 'NELSON' });
    expect(fields.ownerName).toBe('BRYANT NELSON');
  });

  it('treats blank strings as missing', () => {
    const fields = toPropertyFields({ propertyid: 3, situsfullstreetaddress: '   ', ownername1full: '' });
    expect('address' in fields).toBe(false);
    expect('ownerName' in fields).toBe(false);
  });
});

describe('V2 conversions', () => {
  it('moves the county list out of the filters and keeps the other filters as a list', () => {
    const split = splitFilters({
      fips: { operator: 'condition', comparison: 'is', value: ['12067', '12077'] },
      vacant: { operator: 'boolean', value: true },
    });
    expect(split.fips).toEqual(['12067', '12077']);
    expect(split.list).toEqual([{ key: 'vacant', operator: 'boolean', value: true }]);
  });

  it('renames the V2 row fields to the names the search screen reads', () => {
    expect(
      toLegacyRow({
        property_id: 40444727,
        fips: '12067',
        apn: '31-06-14',
        owner_full_name: 'NELSON BRYANT',
        street_address: '204 TOM WATSON AVE',
        lot_size_acres: 5.2,
      }),
    ).toEqual({
      propertyid: 40444727,
      fips: '12067',
      apn: '31-06-14',
      ownername1full: 'NELSON BRYANT',
      situsfullstreetaddress: '204 TOM WATSON AVE',
      lotsizeacres: 5.2,
    });
  });
});

describe('Land Portal calls', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads every page of a filter search and returns the total count', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          data: { count: 3, next_page_token: 'page2', properties: [{ property_id: 1, fips: '12067', apn: 'A' }] },
          meta: { requests_left: 9 },
        }),
      )
      .mockResolvedValueOnce(json({ data: { count: 3, next_page_token: '', properties: [{ property_id: 2, fips: '12067', apn: 'B' }] } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await filterProperties({ filters: { fips: { value: ['12067'] }, vacant: { operator: 'boolean', value: true } } });

    expect(fetchMock.mock.calls[0][0]).toBe('/api/landportal/filter-data?page_size=100');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/landportal/filter-data?page_size=100&page_token=page2');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      fips: ['12067'],
      filters: [{ key: 'vacant', operator: 'boolean', value: true }],
    });
    expect(result.data.count).toBe(3);
    expect(result.data.properties.map((p) => p.apn)).toEqual(['A', 'B']);
    expect(result.meta.requests_left).toBe(9);
  });

  it('turns county values into a plain list of names', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ data: { key: 'situscity', type: 'county', values: { MAYO: 'MAYO', BRANFORD: 'BRANFORD' } } })));

    const result = await getFilterValues('situscity', '12067');

    expect(result.data.situscity).toEqual(['BRANFORD', 'MAYO']);
  });

  it('keeps dictionary values as a code-to-label map', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ data: { key: 'vacantflag', type: 'dictionary', values: { B: 'Bank Owned' } } })));

    const result = await getFilterValues('vacantflag');

    expect(result.data.vacantflag).toEqual({ B: 'Bank Owned' });
  });

  it('creates a CSV export from property IDs and reports the rows left', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ data: { export_id: 'exp_1', status: 'queued' }, meta: { rows_left: 4800 } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await createExport(['12067'], [40444727, 40444728]);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ export_type: 'property_csv', property_ids: [40444727, 40444728] });
    expect(result.data).toEqual({ task_id: 'exp_1', export_tokens_left: 4800, message: '' });
  });

  it('maps an export status to the fields the screen uses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json({ data: { export_id: 'exp_1', status: 'completed', download_url: 'https://files.example/x.csv', total_rows: 12, error_message: '' } }),
      ),
    );

    const result = await getExportStatus('exp_1');

    expect(result.data).toEqual({ task_id: 'exp_1', status: 'completed', file_url: 'https://files.example/x.csv', rows: 12, error_message: undefined });
  });

  it('throws a LandPortalError with the API message on a failed response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json({ error: { code: 'forbidden', message: 'Export row balance is too low' } }, 403)),
    );

    const error = await createExport(['12067'], [1]).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LandPortalError);
    expect((error as LandPortalError).status).toBe(403);
    expect((error as LandPortalError).message).toBe('Export row balance is too low');
  });

  it('throws when the proxy answers with something other than JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Not found</html>', { status: 404 })));

    await expect(getFilterValues('vacantflag')).rejects.toBeInstanceOf(LandPortalError);
  });
});
