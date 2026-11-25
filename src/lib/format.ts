const DAY_MS = 24 * 60 * 60 * 1000;

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

export function formatAcres(value: number): string {
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 1 })} ac`;
}

export function daysSince(iso: string | null, now = Date.now()): number | null {
  if (!iso) return null;
  return Math.floor((now - new Date(iso).getTime()) / DAY_MS);
}

export function daysUntil(iso: string, now = Date.now()): number {
  return Math.ceil((new Date(iso).getTime() - now) / DAY_MS);
}

export function addDays(iso: string | Date, days: number): string {
  return new Date(new Date(iso).getTime() + days * DAY_MS).toISOString();
}
