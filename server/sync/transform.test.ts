import { describe, expect, it } from 'vitest';
import { isOptOutReply, mergeInboxFolders, toInboxDetails, toMessageRow, toSyncRow, type ConversationItem } from './transform.ts';

describe('toMessageRow', () => {
  it('keeps the thread fields and drops attachment links', () => {
    const row = toMessageRow('c1', {
      id: 'm1',
      direction: 'outgoing',
      type: 'sms',
      content: '  Hi, would you take a look?  ',
      createdAt: '2026-11-09T10:38:00-05:00',
      status: 'delivered',
      source: 'campaign',
      fromNumber: '+13369791197',
      toNumber: '+18434758031',
      attachments: [{ url: 'https://files.example/x.jpg' }],
    });
    expect(row).toEqual({
      message_id: 'm1',
      contact_id: 'c1',
      direction: 'outgoing',
      type: 'sms',
      content: 'Hi, would you take a look?',
      status: 'delivered',
      source: 'campaign',
      from_number: '+13369791197',
      to_number: '+18434758031',
      attachment_count: 1,
      created_at: '2026-11-09T10:38:00-05:00',
    });
    expect(JSON.stringify(row)).not.toContain('files.example');
  });

  it('skips items without a direction or time', () => {
    expect(toMessageRow('c1', { id: 'x', direction: 'system', type: 'sms', content: '', createdAt: '2026-11-09T10:00:00Z' })).toBeNull();
    expect(toMessageRow('c1', { id: 'y', direction: 'incoming', type: 'sms', content: 'hi', createdAt: '' })).toBeNull();
  });
});

describe('toInboxDetails', () => {
  it('uses the newest message and maps label ids to names', () => {
    const labelNames = new Map([['l1', 'New MSG'], ['l2', 'R-Sent']]);
    const details = toInboxDetails(
      { direction: 'incoming', type: 'sms', content: '  Sure \n go ahead ', createdAt: '2026-11-25T01:14:00Z' },
      ['l1', 'unknown', 'l2'],
      labelNames,
    );
    expect(details).toEqual({
      last_message: 'Sure go ahead',
      last_message_at: '2026-11-25T01:14:00Z',
      last_direction: 'incoming',
      labels: ['New MSG', 'R-Sent'],
    });
  });

  it('leaves the message empty when there is none', () => {
    expect(toInboxDetails(undefined, [], new Map())).toEqual({ last_message: null, last_message_at: null, last_direction: null, labels: [] });
  });

  it('caps long text at 500 characters', () => {
    const details = toInboxDetails({ direction: 'outgoing', type: 'sms', content: 'x'.repeat(900), createdAt: '2026-11-25T01:00:00Z' }, [], new Map());
    expect(details.last_message?.length).toBe(500);
  });
});

describe('mergeInboxFolders', () => {
  it('lists each conversation once, with every folder it is in', () => {
    const rows = mergeInboxFolders({
      all: [
        { contactId: 'c1', name: 'Dorothy Coen', phone: '+18434758031' },
        { contactId: 'c2', name: 'Mary Cannon', phone: '+17065402233' },
      ],
      unread: [{ contactId: 'c1', name: 'Dorothy Coen', phone: '+18434758031' }],
      opted_out: [{ contactId: 'c2', name: 'Mary Cannon', phone: '+17065402233' }],
    });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.contact_id === 'c1')?.folders).toEqual(['all', 'unread']);
    expect(rows.find((r) => r.contact_id === 'c2')?.folders).toEqual(['all', 'opted_out']);
  });

  it('keeps a usable phone as 10 digits and an unusable one as null', () => {
    const rows = mergeInboxFolders({ all: [{ contactId: 'c1', name: ' A ', phone: '' }, { contactId: 'c2', phone: '+1 (843) 475-8031' }] });
    expect(rows.find((r) => r.contact_id === 'c1')).toMatchObject({ name: 'A', phone: null, email: null });
    expect(rows.find((r) => r.contact_id === 'c2')?.phone).toBe('8434758031');
  });
});

const contact = { contactId: 'c1', name: ' Dorothy Coen ', phone: '+18434758031' };

const outgoing = (createdAt: string, source = 'campaign'): ConversationItem => ({
  direction: 'outgoing',
  type: 'sms',
  content: 'Hi, would you take a look?',
  createdAt,
  source,
});
const incoming = (content: string, createdAt: string, source = 'campaign'): ConversationItem => ({
  direction: 'incoming',
  type: 'sms',
  content,
  createdAt,
  source,
});

describe('isOptOutReply', () => {
  it('matches a stop word on its own, ignoring case and punctuation', () => {
    expect(isOptOutReply('STOP')).toBe(true);
    expect(isOptOutReply('stop.')).toBe(true);
    expect(isOptOutReply(' Opt out! ')).toBe(true);
  });

  it('does not match a stop word inside a longer reply', () => {
    expect(isOptOutReply('Please stop calling my mother')).toBe(false);
    expect(isOptOutReply('What do you know about this land?')).toBe(false);
  });
});

describe('toSyncRow', () => {
  it('returns null for a contact that was never in a campaign', () => {
    const items = [{ direction: 'incoming', type: 'sms', content: 'hi', createdAt: '2026-11-20T10:00:00Z', source: 'direct' }];
    expect(toSyncRow(contact, items)).toBeNull();
  });

  it('ignores call items even when they carry the campaign source', () => {
    const items = [{ direction: 'outgoing', type: 'call', content: '', createdAt: '2026-11-20T10:00:00Z', source: 'campaign' }];
    expect(toSyncRow(contact, items)).toBeNull();
  });

  it('returns null when the phone number is not usable', () => {
    expect(toSyncRow({ ...contact, phone: '123' }, [outgoing('2026-11-20T10:00:00Z')])).toBeNull();
  });

  it('marks a contact contacted, with the newest campaign message as the last contact date', () => {
    const row = toSyncRow(contact, [outgoing('2026-11-20T10:00:00Z'), outgoing('2026-11-24T09:00:00Z')]);
    expect(row).toEqual({
      phone: '8434758031',
      name: 'Dorothy Coen',
      last_campaign_at: '2026-11-24T09:00:00Z',
      replied: false,
      opted_out: false,
    });
  });

  it('marks a reply to a campaign message as replied', () => {
    const row = toSyncRow(contact, [incoming('What do you know about this land?', '2026-11-25T00:30:00Z'), outgoing('2026-11-24T10:28:00Z')]);
    expect(row?.replied).toBe(true);
    expect(row?.opted_out).toBe(false);
  });

  it('flags an opt-out when the reply to a campaign message is a stop word', () => {
    const row = toSyncRow(contact, [incoming('STOP', '2026-11-25T00:30:00Z'), outgoing('2026-11-24T10:28:00Z')]);
    expect(row?.opted_out).toBe(true);
    expect(row?.replied).toBe(true);
  });

  it('does not count a stop word from a direct conversation as a campaign opt-out', () => {
    const row = toSyncRow(contact, [incoming('STOP', '2026-11-25T00:30:00Z', 'direct'), outgoing('2026-11-24T10:28:00Z')]);
    expect(row?.opted_out).toBe(false);
    expect(row?.replied).toBe(false);
  });
});
