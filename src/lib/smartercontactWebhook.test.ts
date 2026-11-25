import { describe, expect, it } from 'vitest';
import { classify, normalizePhone, parseEvent } from '../../server/webhook/classify';

describe('parseEvent', () => {
  it('reads a reply in the data envelope', () => {
    const event = parseEvent({
      id: 'evt_1',
      type: 'message.received.v1',
      data: { phone: '+1 (832) 457-1487', message: 'Yes, interested' },
    });
    expect(event).toMatchObject({ eventId: 'evt_1', eventType: 'message.received.v1', phone: '8324571487', text: 'Yes, interested' });
  });

  it('reads the phone from a nested contact object', () => {
    const event = parseEvent({ event_id: 'evt_2', event: 'message.received', data: { contact: { phone: '8324571487' }, text: 'STOP' } });
    expect(event?.phone).toBe('8324571487');
  });

  it('rejects a body without an event ID or with the wrong shape', () => {
    expect(parseEvent({ type: 'message.received.v1' })).toBeNull();
    expect(parseEvent('not an object')).toBeNull();
    expect(parseEvent(null)).toBeNull();
  });

  it('leaves the phone empty when it is missing or not a US number', () => {
    expect(parseEvent({ id: 'evt_3', type: 'message.received.v1', data: { message: 'hi' } })?.phone).toBeNull();
    expect(parseEvent({ id: 'evt_4', type: 'message.received.v1', data: { phone: '123' } })?.phone).toBeNull();
  });
});

describe('classify', () => {
  const reply = (text: string, phone = '8324571487') => ({ eventId: 'e', eventType: 'message.received.v1', phone, text, status: '', reason: '' });

  it('treats a stop word as an opt-out, ignoring case and punctuation', () => {
    expect(classify(reply('STOP'))).toEqual({ action: 'opt_out', phone: '8324571487' });
    expect(classify(reply('  unsubscribe! '))).toEqual({ action: 'opt_out', phone: '8324571487' });
    expect(classify(reply('opt out.'))).toEqual({ action: 'opt_out', phone: '8324571487' });
  });

  it('does not treat a sentence that contains a stop word as an opt-out', () => {
    expect(classify(reply('Please stop by my office tomorrow'))).toEqual({ action: 'reply', phone: '8324571487' });
    expect(classify(reply('Yes we like your quote on land'))).toEqual({ action: 'reply', phone: '8324571487' });
  });

  it('records an ordinary reply', () => {
    expect(classify(reply('41.3 acres yes'))).toEqual({ action: 'reply', phone: '8324571487' });
  });

  it('records an opt-out event type directly', () => {
    expect(classify({ eventId: 'e', eventType: 'contact.opted_out.v1', phone: '8324571487', text: '', status: '', reason: '' })).toEqual({ action: 'opt_out', phone: '8324571487' });
  });

  it('ignores other event types', () => {
    expect(classify({ eventId: 'e', eventType: 'campaign.created.v1', phone: null, text: '', status: '', reason: '' })).toEqual({ action: 'ignore' });
  });

  it('cannot suppress a number it does not have', () => {
    expect(classify(reply('STOP', null as unknown as string))).toEqual({ action: 'reply', phone: null });
  });
});

describe('normalizePhone', () => {
  it('keeps ten digits and drops a leading country code', () => {
    expect(normalizePhone('+1 832-457-1487')).toBe('8324571487');
    expect(normalizePhone('12345')).toBeNull();
  });
});

describe('message.received.v1 sample from Smarter Contact', () => {
  const sample = {
    id: 'evt_0199b7c2-4d1e-7a3f-9b5c-2e8d6f1a0c34',
    event: 'message.received.v1',
    created_at: '2026-10-01T15:04:05.000Z',
    email: 'owner@example.com',
    data: {
      account_id: '8a7b6c5d-4e3f-4a2b-9c1d-0e9f8a7b6c5d',
      message_id: '5e4d3c2b-1a09-4f8e-8d7c-6b5a49382716',
      contact_id: '3f2a9c1e-5b7d-4e8a-9c0f-1a2b3c4d5e6f',
      from_number: '+15551234567',
      to_number: '+15557654321',
      source: 'campaign',
      type: 'mms',
      content: 'Yes, still interested',
      attachments: [{ index: 0, content_type: 'image/jpeg', url: 'https://example.com/photo.jpg' }],
    },
  };

  it('reads the event ID, type, sender number and reply text', () => {
    expect(parseEvent(sample)).toMatchObject({
      eventId: 'evt_0199b7c2-4d1e-7a3f-9b5c-2e8d6f1a0c34',
      eventType: 'message.received.v1',
      phone: '5551234567',
      text: 'Yes, still interested',
    });
  });

  it('classifies a normal reply as a reply', () => {
    const event = parseEvent(sample);
    expect(event && classify(event)).toEqual({ action: 'reply', phone: '5551234567' });
  });

  it('classifies a STOP reply as an opt-out for the sender', () => {
    const event = parseEvent({ ...sample, data: { ...sample.data, content: 'STOP' } });
    expect(event && classify(event)).toEqual({ action: 'opt_out', phone: '5551234567' });
  });
});

describe('redactPayload', () => {
  it('removes the owner email and attachment links, keeping the reply and IDs', async () => {
    const { redactPayload } = await import('../../server/webhook/classify');
    const out = redactPayload({
      id: 'evt_1',
      email: 'owner@example.com',
      data: { from_number: '+15551234567', content: 'STOP', contact_id: 'c1', attachments: [{ index: 0, url: 'https://x/signed' }] },
    }) as Record<string, unknown>;
    expect(out).not.toHaveProperty('email');
    expect(JSON.stringify(out)).not.toContain('signed');
    expect((out.data as Record<string, unknown>).content).toBe('STOP');
    expect((out.data as Record<string, unknown>).contact_id).toBe('c1');
  });
});

describe('message.delivery_status.v1 sample from Smarter Contact', () => {
  const delivery = {
    id: 'evt_9b1d6f0e-2c3a-4f5b-8d7e-6a5b4c3d2e1f',
    event: 'message.delivery_status.v1',
    created_at: '2026-10-01T15:05:10.000Z',
    email: 'owner@example.com',
    data: {
      account_id: '8a7b6c5d-4e3f-4a2b-9c1d-0e9f8a7b6c5d',
      message_id: '7c6b5a49-3827-4165-9f8e-7d6c5b4a3928',
      contact_id: '3f2a9c1e-5b7d-4e8a-9c0f-1a2b3c4d5e6f',
      status: 'undelivered',
      reason: 'spam',
      source: 'api',
      from_number: '+15557654321',
      to_number: '+15551234567',
    },
  };

  it('takes the contact from the recipient number, not our sending number', () => {
    expect(parseEvent(delivery)).toMatchObject({ eventType: 'message.delivery_status.v1', phone: '5551234567', status: 'undelivered', reason: 'spam' });
  });

  it('logs a delivery report for review without suppressing the number', () => {
    const event = parseEvent(delivery);
    expect(event && classify(event)).toEqual({ action: 'delivery', phone: '5551234567', status: 'undelivered', reason: 'spam' });
  });
});
