// Checks the X-SC-Signature header from Smarter Contact, as described in its webhook documentation:
//   X-SC-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" with the signing secret>
// The check uses the raw body bytes, not re-serialized JSON. A delivery is accepted only if its timestamp is
// within two hours, because retries can arrive up to about 90 minutes after the first attempt.

const MAX_AGE_SECONDS = 2 * 60 * 60;

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

export async function verifySignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!header || !secret) return false;

  const parts: Record<string, string> = {};
  for (const piece of header.split(',')) {
    const index = piece.indexOf('=');
    if (index > 0) parts[piece.slice(0, index).trim()] = piece.slice(index + 1).trim();
  }
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1 || !/^\d+$/.test(t)) return false;
  if (Math.abs(nowSeconds - Number(t)) >= MAX_AGE_SECONDS) return false;

  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${rawBody}`));
  const expected = [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return constantTimeEqual(expected, v1);
}
