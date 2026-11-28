import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { ImportProgressBar } from '@/components/import/ImportProgressBar';
import { ImportJobProvider } from '@/lib/importJobs';
import { AccessGate } from './AccessGate';
import { Navbar } from './Navbar';
import { Sidebar } from './Sidebar';

export function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <ImportJobProvider>
      <div className="fixed inset-0 overflow-hidden bg-background">
        <div className="flex h-full w-full overflow-hidden bg-card">
          <Sidebar
            collapsed={collapsed}
            mobileOpen={mobileOpen}
            onToggleCollapsed={() => setCollapsed((value) => !value)}
            onNavigate={() => setMobileOpen(false)}
          />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <Navbar onOpenMenu={() => setMobileOpen(true)} />
            <ImportProgressBar />
            <main className="min-h-0 w-full flex-1 space-y-6 overflow-y-auto overflow-x-hidden p-4 md:px-6 md:pb-10 md:pt-6">
              <AccessGate>
                <Outlet />
              </AccessGate>
            </main>
          </div>
        </div>
      </div>
    </ImportJobProvider>
  );
}
