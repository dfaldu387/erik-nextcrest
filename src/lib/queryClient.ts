import { QueryClient } from '@tanstack/react-query';

// Shared query client. auth.ts uses it to drop per-user data when the signed-in user changes.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 60_000 },
  },
});

// Query keys whose data belongs to the signed-in user (row-level security returns different rows per user).
export const USER_SCOPED_QUERY_KEYS = ['records', 'properties', 'property-filter-options', 'markets', 'activity', 'my-role', 'role-permissions', 'team-members'] as const;

// Dashboard data changes slowly and its queries are heavy on the database, so it is kept for 5 minutes.
export const DASHBOARD_STALE_MS = 5 * 60_000;
