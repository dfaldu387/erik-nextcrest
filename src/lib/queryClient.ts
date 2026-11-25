import { QueryClient } from '@tanstack/react-query';

// Shared query client. auth.ts uses it to drop per-user data when the signed-in user changes.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 60_000 },
  },
});

// Query keys whose data belongs to the signed-in user (row-level security returns different rows per user).
export const USER_SCOPED_QUERY_KEYS = ['records', 'properties', 'property-filter-options', 'markets', 'activity'] as const;
