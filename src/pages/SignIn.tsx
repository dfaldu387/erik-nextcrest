import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { signInWithPassword, useAuth } from '@/lib/auth';

export function SignIn() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const destination = (location.state as { from?: string } | null)?.from ?? '/dashboard';

  if (auth.status === 'signed-in') return <Navigate to={destination} replace />;

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setSubmitting(true);
    const failure = await signInWithPassword(email, password);
    setSubmitting(false);
    if (failure) {
      setError(failure);
      return;
    }
    setPassword('');
    navigate(destination, { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-xl font-semibold">Sign in to NextCrest</h1>
        <p className="mt-1 text-sm text-muted-foreground">Use the account your administrator created for you.</p>

        {auth.status === 'unconfigured' ? (
          <p role="alert" className="mt-4 rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            Sign-in is not set up. The database settings are missing from the environment file.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="field w-full"
                disabled={submitting}
              />
            </div>
            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="field w-full"
                disabled={submitting}
              />
            </div>

            {error && (
              <p role="alert" className="rounded-md border border-red-400 bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
                {error}
              </p>
            )}

            <button type="submit" className="btn-primary w-full" disabled={submitting || auth.status === 'loading'}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
