export type DatabaseStatus =
  | { state: 'not-configured' }
  | { state: 'unreachable'; reason: string }
  | { state: 'tables-missing' }
  | { state: 'connected' };

const TIMEOUT_MS = 8000;

// Reads the browser-safe settings only. Secret and service-role keys are never used here.
export async function checkDatabase(): Promise<DatabaseStatus> {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!url || !key) return { state: 'not-configured' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${url}/rest/v1/profiles?select=id&limit=1`, {
      headers: { apikey: key },
      signal: controller.signal,
    });
    if (response.status === 404) return { state: 'tables-missing' };
    if (response.ok) return { state: 'connected' };
    return { state: 'unreachable', reason: `HTTP ${response.status}` };
  } catch (error) {
    const reason = error instanceof Error && error.name === 'AbortError' ? 'timed out' : 'network error';
    return { state: 'unreachable', reason };
  } finally {
    clearTimeout(timer);
  }
}
