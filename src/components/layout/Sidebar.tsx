import { ChevronsLeft, ChevronsRight, Hexagon } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { navigation } from '@/constants/navigation';

interface SidebarProps {
  collapsed: boolean;
  mobileOpen: boolean;
  onToggleCollapsed: () => void;
  onNavigate: () => void;
}

export function Sidebar({ collapsed, mobileOpen, onToggleCollapsed, onNavigate }: SidebarProps) {
  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={onNavigate}
          className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
        />
      )}
      <aside
        aria-label="Primary"
        className={`fixed inset-y-0 left-0 z-40 flex flex-col border-r border-border bg-card transition-[width,transform] duration-200 lg:static lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        } ${collapsed ? 'w-64 lg:w-16' : 'w-64'}`}
      >
        <div className={`flex h-16 items-center gap-3 border-b border-border px-4 ${collapsed ? 'lg:justify-center lg:px-0' : ''}`}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-brand-bright to-brand text-white shadow-glow">
            <Hexagon size={18} aria-hidden="true" />
          </div>
          <div className={`min-w-0 ${collapsed ? 'lg:hidden' : ''}`}>
            <div className="truncate text-[15px] font-bold">NextCrest</div>
            <div className="truncate text-xs text-muted-foreground">Land data management</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {navigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                `flex h-10 items-center gap-3 rounded-[10px] px-3 text-[13px] font-medium transition-colors ${
                  collapsed ? 'lg:justify-center lg:px-0' : ''
                } ${
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`
              }
            >
              <item.icon size={18} className="shrink-0" aria-hidden="true" />
              <span className={collapsed ? 'lg:sr-only' : ''}>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="hidden border-t border-border p-3 lg:block">
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="btn-ghost w-full justify-center"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronsRight size={18} aria-hidden="true" /> : <ChevronsLeft size={18} aria-hidden="true" />}
            <span className={collapsed ? 'sr-only' : ''}>Collapse</span>
          </button>
        </div>
      </aside>
    </>
  );
}
