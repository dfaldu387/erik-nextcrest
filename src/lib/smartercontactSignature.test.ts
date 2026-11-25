import { describe, expect, it } from 'vitest';
import { verifySignature } from '../../server/webhook/signature';

const secret = 'whsec_test_secret';
const body = '{"id":"evt_1","event":"message.received.v1","data":{"content":"STOP"}}';
const now = 1_800_000_000;

// Builds the header the way Smarter Contact does: HMAC-SHA256 of "<t>.<raw body>" with the signing secret.
async function sign(raw: string, t: number, key = secret): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(`${t}.${raw}`));
  const v1 = [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `t=${t},v1=${v1}`;
}

describe('verifySignature', () => {
  it('accepts a correctly signed delivery', async () => {
    expect(await verifySignature(body, await sign(body, now), secret, now)).toBe(true);
  });

  it('accepts a retry up to about 90 minutes after the first attempt', async () => {
    expect(await verifySignature(body, await sign(body, now - 90 * 60), secret, now)).toBe(true);
  });

  it('rejects a delivery older than two hours', async () => {
    expect(await verifySignature(body, await sign(body, now - 3 * 60 * 60), secret, now)).toBe(false);
  });

  it('rejects a changed body', async () => {
    expect(await verifySignature(body.replace('STOP', 'YES'), await sign(body, now), secret, now)).toBe(false);
  });

  it('rejects the wrong secret', async () => {
    expect(await verifySignature(body, await sign(body, now, 'whsec_other'), secret, now)).toBe(false);
  });

  it('rejects a missing header, a missing secret or a malformed header', async () => {
    expect(await verifySignature(body, null, secret, now)).toBe(false);
    expect(await verifySignature(body, await sign(body, now), '', now)).toBe(false);
    expect(await verifySignature(body, 'garbage', secret, now)).toBe(false);
    expect(await verifySignature(body, 't=abc,v1=00', secret, now)).toBe(false);
  });
});
