import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';

// Sends visitors who are not signed in to the sign-in page, then back to the page they asked for.
// When the database settings are missing, pages still open (with empty data) so the Integrations page can show why.
export function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === 'unconfigured' || auth.status === 'signed-in') return <>{children}</>;

  if (auth.status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground" role="status">
        Checking your sign-in…
      </div>
    );
  }

  return <Navigate to="/sign-in" replace state={{ from: location.pathname + location.search }} />;
}
