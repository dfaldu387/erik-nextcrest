// Reads phone numbers, line types and Do Not Call flags from a purchase file. Works on any column layout that
// names its phone columns "Phone", "Phone 2", "Alt Phone 1" and so on, as Land Portal exports do.

export interface PhoneLink {
  phone: string; // normalized 10-digit US number
  position: number; // 1 = first number on the row
  lineType: string | null;
  dnc: boolean;
  dncFederal: boolean;
}

const PHONE_HEADER = /^(Phone|Phone \d+|Alt Phone \d+)$/i;

// Keeps the ten digits of a US number. Eleven digits starting with 1 lose the country code. Anything else is rejected.
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  if (digits.length === 10) return digits;
  return null;
}

function cellOf(headers: string[], cells: string[], name: string): string {
  const index = headers.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
  return index >= 0 ? (cells[index] ?? '').trim() : '';
}

// Reads every phone column for one row, in column order, skipping blanks and repeats.
export function extractPhones(headers: string[], cells: string[]): PhoneLink[] {
  const out: PhoneLink[] = [];
  const seen = new Set<string>();
  headers.forEach((header) => {
    const name = header.trim();
    if (!PHONE_HEADER.test(name)) return;
    const phone = normalizePhone(cellOf(headers, cells, name));
    if (!phone || seen.has(phone)) return;
    seen.add(phone);

    const lineType = cellOf(headers, cells, `${name} (Line Type)`) || cellOf(headers, cells, `${name} Type`) || null;
    const dncFederal = cellOf(headers, cells, `${name} (DNC Federal)`) !== '';
    const dnc =
      dncFederal ||
      ['(DNC)', '(DNC Litigator)', '(DNC Complainers)'].some((suffix) => cellOf(headers, cells, `${name} ${suffix}`) !== '') ||
      cellOf(headers, cells, `${name} DNC`) !== '';

    out.push({ phone, position: out.length + 1, lineType, dnc, dncFederal });
  });
  return out;
}
