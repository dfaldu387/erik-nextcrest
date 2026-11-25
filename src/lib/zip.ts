// ZIP code helpers for the property filters. Business rule: ZIPs are standardised to 5 digits, with any +4 suffix removed.

// "32066-1234" -> "32066". Returns '' when fewer than 5 digits are present.
export function normalizeZip(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 5 ? digits.slice(0, 5) : '';
}

// Splits "32066, 32068 32066-1234" into unique 5-digit ZIPs, in the order typed.
export function parseZipList(value: string): string[] {
  const zips = value
    .split(/[\s,;]+/)
    .map(normalizeZip)
    .filter(Boolean);
  return [...new Set(zips)];
}
