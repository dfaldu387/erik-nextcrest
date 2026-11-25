import type { LucideIcon } from 'lucide-react';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { InfoTip } from './InfoTip';

type Tone = 'teal' | 'blue' | 'amber' | 'purple' | 'red' | 'slate';

const toneClasses: Record<Tone, string> = {
  teal: 'bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300',
  blue: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  purple: 'bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300',
  red: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
  slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

interface KPICardProps {
  label: string;
  value: string;
  help: string;
  icon: LucideIcon;
  tone: Tone;
  to?: string;
}

export function KPICard({ label, value, help, icon: Icon, tone, to }: KPICardProps) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${toneClasses[tone]}`}>
          <Icon size={20} aria-hidden="true" />
        </div>
        {to && <ChevronRight size={18} className="text-muted-foreground" aria-hidden="true" />}
      </div>
      <div className="mt-4 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
        {label}
        <InfoTip text={help} />
      </div>
      <div className="mt-1 text-3xl font-semibold tabular-nums text-foreground">{value}</div>
    </>
  );

  if (to) {
    return (
      <Link
        to={to}
        className="card block p-5 transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring"
      >
        {body}
      </Link>
    );
  }
  return <div className="card p-5">{body}</div>;
}
