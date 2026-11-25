import type { LucideIcon } from 'lucide-react';
import { Ban, BadgeCheck, CircleDashed, Clock, Phone, PhoneOff, RefreshCw } from 'lucide-react';
import type { MarketingStatus } from '@/data/types';

interface StatusConfig {
  label: string;
  icon: LucideIcon;
  classes: string;
}

// Colour is always paired with an icon and text label (never colour alone).
export const statusConfig: Record<MarketingStatus, StatusConfig> = {
  never_marketed: {
    label: 'Never marketed',
    icon: CircleDashed,
    classes: 'bg-slate-100 text-slate-700 ring-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-600',
  },
  contacted_1: {
    label: 'Contacted 1x',
    icon: Phone,
    classes: 'bg-blue-50 text-blue-800 ring-blue-300 dark:bg-blue-950 dark:text-blue-200 dark:ring-blue-800',
  },
  contacted_2: {
    label: 'Contacted 2x',
    icon: Phone,
    classes: 'bg-blue-100 text-blue-900 ring-blue-400 dark:bg-blue-900 dark:text-blue-100 dark:ring-blue-700',
  },
  contacted_3: {
    label: 'Contacted 3x+',
    icon: Phone,
    classes: 'bg-blue-200 text-blue-950 ring-blue-500 dark:bg-blue-800 dark:text-blue-50 dark:ring-blue-600',
  },
  followup_due: {
    label: 'Follow up due',
    icon: Clock,
    classes: 'bg-amber-50 text-amber-800 ring-amber-400 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-700',
  },
  rehit_due: {
    label: 'Re-hit due (90d)',
    icon: RefreshCw,
    classes: 'bg-purple-50 text-purple-800 ring-purple-400 dark:bg-purple-950 dark:text-purple-200 dark:ring-purple-700',
  },
  wrong_number: {
    label: 'Wrong number',
    icon: PhoneOff,
    classes: 'bg-red-50 text-red-800 ring-red-400 dark:bg-red-950 dark:text-red-200 dark:ring-red-700',
  },
  opted_out: {
    label: 'Opted out',
    icon: Ban,
    classes: 'bg-slate-800 text-white ring-slate-900 dark:bg-slate-200 dark:text-slate-900 dark:ring-slate-300',
  },
};

// Used for the duplicate checker's "already owned" result.
export const ownedChipClasses =
  'bg-green-50 text-green-800 ring-green-400 dark:bg-green-950 dark:text-green-200 dark:ring-green-700';

interface StatusChipProps {
  status: MarketingStatus;
}

export function StatusChip({ status }: StatusChipProps) {
  const { label, icon: Icon, classes } = statusConfig[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${classes}`}
    >
      <Icon size={12} aria-hidden="true" />
      {label}
    </span>
  );
}

export function OwnedChip() {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${ownedChipClasses}`}
    >
      <BadgeCheck size={12} aria-hidden="true" />
      Already owned
    </span>
  );
}
