import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/ui/States';

export function NotFound() {
  return (
    <div className="card">
      <EmptyState
        title="Page not found"
        description="The page you are looking for does not exist or has moved."
        action={
          <Link to="/dashboard" className="btn-primary">
            Back to Command Center
          </Link>
        }
      />
    </div>
  );
}
