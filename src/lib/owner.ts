// Organisation suffixes. Matched as whole words so "Coe" or "Lpham" are not treated as entities.
const ENTITY_PATTERN =
  /\b(LLC|L\.L\.C\.|INC|INC\.|CORP|CORP\.|CORPORATION|TRUST|LP|L\.P\.|LLP|CO|CO\.|COMPANY|LTD|GOVERNMENT|ESTATE)\b/i;

// Entity suffixes that are written in capitals in SmarterContact. Other words are title case.
const UPPERCASE_SUFFIXES = new Set(['LLC', 'LLP', 'LP', 'LTD', 'PLLC', 'LLLP']);

export interface OwnerParts {
  isEntity: boolean;
  first: string;
  last: string;
}

// Entities keep the complete name in First Name so it is never split into a person's name.
export function splitOwner(name: string): OwnerParts {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean) return { isEntity: false, first: '', last: '' };
  if (ENTITY_PATTERN.test(clean)) return { isEntity: true, first: clean, last: '' };

  const parts = clean.split(' ');
  if (parts.length === 1) return { isEntity: false, first: parts[0], last: '' };
  return { isEntity: false, first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

// One word in title case. A hyphen or apostrophe starts a new capital: "SMITH-JONES" -> "Smith-Jones", "O'BRIEN" -> "O'Brien".
function titleWord(word: string): string {
  return word.toLowerCase().replace(/(^|[-'])([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

export function formatPersonName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(titleWord)
    .join(' ');
}

// "SMITH FARMS LLC" -> "Smith Farms LLC". Legal suffixes such as LLC stay in capitals.
export function formatEntityName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const bare = word.replace(/\./g, '').toUpperCase();
      return UPPERCASE_SUFFIXES.has(bare) ? bare : titleWord(word);
    })
    .join(' ');
}

// Applies SmarterContact casing to the output of splitOwner.
export function formatOwnerParts(parts: OwnerParts): OwnerParts {
  if (parts.isEntity) return { ...parts, first: formatEntityName(parts.first) };
  return { ...parts, first: formatPersonName(parts.first), last: formatPersonName(parts.last) };
}
