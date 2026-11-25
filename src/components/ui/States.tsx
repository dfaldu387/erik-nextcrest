import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, CheckCircle2, Inbox } from 'lucide-react';
import type { ReactNode } from 'react';

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-md bg-muted ${className}`} />;
}

export function CardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="card space-y-3 p-5" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-4 w-full" />
      ))}
    </div>
  );
}

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  tone?: 'neutral' | 'success';
}

export function EmptyState({ icon: Icon = Inbox, title, description, action, tone = 'neutral' }: EmptyStateProps) {
  const Glyph = tone === 'success' ? CheckCircle2 : Icon;
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div
        className={`flex h-12 w-12 items-center justify-center rounded-full ${
          tone === 'success'
            ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300'
            : 'bg-muted text-muted-foreground'
        }`}
      >
        <Glyph size={22} aria-hidden="true" />
      </div>
      <h3 className="mt-2 text-base font-semibold text-foreground">{title}</h3>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div role="alert" className="card flex flex-col items-center gap-2 px-6 py-10 text-center">
      <AlertTriangle size={22} className="text-red-600 dark:text-red-400" aria-hidden="true" />
      <h3 className="text-base font-semibold">Something went wrong</h3>
      <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn-secondary mt-2">
          Try again
        </button>
      )}
    </div>
  );
}
