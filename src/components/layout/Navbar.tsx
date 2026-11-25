import { useQuery } from '@tanstack/react-query';
import { Bell, CheckSquare, Menu, Monitor, Moon, Plus, Search, Sun } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { DataFreshness } from '@/components/ui/DataFreshness';
import { useAuth, signOut } from '@/lib/auth';
import { applyTheme, getStoredTheme, nextTheme, setStoredTheme } from '@/lib/theme';
import type { ThemeMode } from '@/lib/theme';
import { getDashboardSummary } from '@/services/nextcrestData';

interface NavbarProps {
  onOpenMenu: () => void;
}

const themeIcon: Record<ThemeMode, typeof Sun> = { light: Sun, dark: Moon, system: Monitor };
const themeLabel: Record<ThemeMode, string> = { light: 'Light', dark: 'Dark', system: 'System' };

// Top bar: search on the left; new-import button, task and alert icons, and the account on the right.
export function Navbar({ onOpenMenu }: NavbarProps) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [theme, setTheme] = useState<ThemeMode>(() => getStoredTheme());
  const ThemeIcon = themeIcon[theme];
  const auth = useAuth();

  // Alerts: follow-ups due, from the same database summary the Overview uses.
  const alerts = useQuery({ queryKey: ['dashboard-summary'], queryFn: getDashboardSummary, staleTime: 60_000 });
  const alertCount = alerts.data ? alerts.data.followup_due + alerts.data.wrong_number : 0;

  const initial = auth.status === 'signed-in' ? (auth.session.user.email ?? 'U').charAt(0).toUpperCase() : 'N';

  const onSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const term = query.trim();
    navigate(term ? `/properties?q=${encodeURIComponent(term)}` : '/properties');
  };

  const cycleTheme = () => {
    const next = nextTheme(theme);
    setTheme(next);
    setStoredTheme(next);
    applyTheme(next);
  };

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-border bg-card/90 px-3 backdrop-blur md:px-4">
      <button type="button" onClick={onOpenMenu} className="btn-ghost h-9 w-9 p-0 lg:hidden" aria-label="Open navigation">
        <Menu size={20} aria-hidden="true" />
      </button>

      <form onSubmit={onSearch} role="search" className="relative max-w-xl flex-1">
        <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search APN, owner or county"
          aria-label="Search APN, owner or county"
          className="h-9 w-full rounded-[10px] border border-border bg-card pl-9 pr-11 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">⌘ K</kbd>
      </form>

      <div className="ml-auto flex items-center gap-2">
        <div className="hidden xl:block">
          <DataFreshness />
        </div>
        <Link
          to="/import-export"
          className="hidden h-9 items-center gap-1.5 rounded-[10px] bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground shadow-glow transition-colors hover:opacity-90 sm:inline-flex"
        >
          <Plus size={16} aria-hidden="true" /> New import
        </Link>
        <Link to="/followups" aria-label="Tasks: follow-ups" className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-border bg-card text-foreground hover:bg-muted">
          <CheckSquare size={16} aria-hidden="true" />
        </Link>
        <Link
          to="/followups"
          aria-label={alertCount > 0 ? `Alerts: ${alertCount} need attention` : 'Alerts'}
          className="relative flex h-9 w-9 items-center justify-center rounded-[10px] border border-border bg-card text-foreground hover:bg-muted"
        >
          <Bell size={16} aria-hidden="true" />
          {alertCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
              {alertCount > 99 ? '99+' : alertCount}
            </span>
          )}
        </Link>
        <button
          type="button"
          onClick={cycleTheme}
          className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-border bg-card text-foreground hover:bg-muted"
          aria-label={`Theme: ${themeLabel[theme]}. Click to change.`}
          title={`Theme: ${themeLabel[theme]}`}
        >
          <ThemeIcon size={16} aria-hidden="true" />
        </button>
        {auth.status === 'signed-in' && (
          <div className="ml-1 flex items-center gap-2 rounded-[10px] border border-border bg-card py-1 pl-1 pr-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-bright to-brand text-[12px] font-bold text-white" aria-hidden="true">
              {initial}
            </span>
            <button type="button" onClick={() => void signOut()} className="text-xs font-medium text-muted-foreground hover:text-foreground">
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
