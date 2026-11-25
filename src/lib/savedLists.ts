import type { ListFilters } from './listFilters';

export interface SavedList {
  id: string;
  name: string;
  filters: ListFilters;
  createdAt: string;
}

// Saved lists live in this browser only until the database is connected.
const STORAGE_KEY = 'nc-saved-lists';

function isSavedList(value: unknown): value is SavedList {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && typeof v.name === 'string' && typeof v.createdAt === 'string' && typeof v.filters === 'object' && v.filters !== null;
}

export function loadSavedLists(): SavedList[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isSavedList) : [];
  } catch {
    return [];
  }
}

export function saveSavedLists(lists: SavedList[]): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lists));
    return true;
  } catch {
    return false;
  }
}
