export type LandPortalState =
  | 'connected'
  | 'rejected'
  | 'error'
  | 'unreachable'
  | 'not-configured'
  | 'unavailable';

export interface LandPortalStatus {
  state: LandPortalState;
  httpStatus?: number;
  checkedAt?: string;
}

// Asks the development server to test the Land Portal key. The key never reaches the browser.
// In a deployed build no such endpoint exists, so the result is 'unavailable'.
export async function checkLandPortal(): Promise<LandPortalStatus> {
  try {
    const response = await fetch('/api/integrations/landportal', { cache: 'no-store' });
    const type = response.headers.get('content-type') ?? '';
    if (!response.ok || !type.includes('application/json')) return { state: 'unavailable' };
    return (await response.json()) as LandPortalStatus;
  } catch {
    return { state: 'unavailable' };
  }
}
