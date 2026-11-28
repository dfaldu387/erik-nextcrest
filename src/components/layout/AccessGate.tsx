import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { CardSkeleton } from '@/components/ui/States';
import { areaForPath, usePermissions } from '@/lib/permissions';

/** Shows the page only when the signed-in user's role may open its area. Other pages are shown as normal. */
export function AccessGate({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { loading, error, canAccess } = usePermissions();
  const area = areaForPath(pathname);

  if (!area) return <>{children}</>;
  if (loading) return <CardSkeleton rows={3} />;
  if (error || !canAccess(area)) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">No access</h1>
        <div className="card p-6">
          <p className="text-sm">
            Your role does not include <strong>{area}</strong>. Ask an admin to change your access on the Team page.
          </p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
