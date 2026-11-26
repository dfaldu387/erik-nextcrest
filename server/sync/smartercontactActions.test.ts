import { describe, expect, it } from 'vitest';
import { checkMark, checkReply, MAX_REPLY_CHARS } from '../../supabase/functions/smartercontact-sync/actions.ts';

const ID = '3f2a9c1e-5b7d-4e8a-9c0f-1a2b3c4d5e6f';

describe('checkReply', () => {
  it('accepts a conversation id and a short text', () => {
    expect(checkReply(ID, 'Thanks, talk soon')).toBeNull();
  });
  it('rejects a bad conversation id', () => {
    expect(checkReply('not-a-uuid', 'hi')).toMatch(/conversation id/);
    expect(checkReply(undefined, 'hi')).toMatch(/conversation id/);
  });
  it('rejects empty and spaces-only text', () => {
    expect(checkReply(ID, '')).toMatch(/empty/);
    expect(checkReply(ID, '   ')).toMatch(/empty/);
  });
  it('rejects text over the limit', () => {
    expect(checkReply(ID, 'x'.repeat(MAX_REPLY_CHARS + 1))).toMatch(/longer/);
    expect(checkReply(ID, 'x'.repeat(MAX_REPLY_CHARS))).toBeNull();
  });
});

describe('checkMark', () => {
  it('accepts one or more conversation ids and a read flag', () => {
    expect(checkMark([ID], true)).toBeNull();
    expect(checkMark([ID], false)).toBeNull();
  });
  it('rejects an empty list, too many ids, bad ids and a missing flag', () => {
    expect(checkMark([], true)).toMatch(/No conversations/);
    expect(checkMark(Array(101).fill(ID), true)).toMatch(/At most 100/);
    expect(checkMark(['bad'], true)).toMatch(/not valid/);
    expect(checkMark([ID], 'yes')).toMatch(/mark read or unread/);
  });
});

import { checkFields, fieldIdsFor } from '../../supabase/functions/smartercontact-sync/actions.ts';

describe('checkFields', () => {
  it('accepts text values for a contact', () => {
    expect(checkFields(ID, { APN: '1007', 'Parcel acres': '66.47' })).toBeNull();
  });
  it('rejects a bad contact id, empty input and non-text values', () => {
    expect(checkFields('nope', { APN: '1' })).toMatch(/not valid/);
    expect(checkFields(ID, {})).toMatch(/No fields/);
    expect(checkFields(ID, { APN: 5 })).toMatch(/must be text/);
    expect(checkFields(ID, { APN: 'x'.repeat(501) })).toMatch(/longer than/);
  });
});

describe('fieldIdsFor', () => {
  it('maps names to ids and reports names the contact does not have', () => {
    const existing = [{ id: 'a1', name: 'APN' }, { id: 'b2', name: 'Email' }];
    expect(fieldIdsFor(existing, { APN: '1007' })).toEqual({ ids: { a1: '1007' } });
    expect(fieldIdsFor(existing, { APN: '1', Bed: '3' })).toEqual({ missing: ['Bed'] });
  });
});
