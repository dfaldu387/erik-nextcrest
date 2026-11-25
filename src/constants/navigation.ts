import type { LucideIcon } from 'lucide-react';
import {
  Ban,
  BarChart3,
  Inbox as InboxIcon,
  LayoutDashboard,
  ListFilter,
  ListTodo,
  Megaphone,
  MessageCircle,
  Plug,
  Search,
  ShieldCheck,
  Settings,
  ShoppingCart,
  Table2,
  Upload,
  Users,
} from 'lucide-react';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
}

// Matches the sidebar in the master build prompt, section 4.
export const navigation: NavItem[] = [
  { label: 'Overview', to: '/dashboard', icon: LayoutDashboard },
  { label: 'Properties', to: '/properties', icon: Table2 },
  { label: 'Data Purchases', to: '/purchases', icon: ShoppingCart },
  { label: 'Check Before Buying', to: '/check-before-buying', icon: ShieldCheck },
  { label: 'Search & Buy', to: '/search-buy', icon: Search },
  { label: 'Lists', to: '/lists', icon: ListFilter },
  { label: 'Campaigns', to: '/campaigns', icon: Megaphone },
  { label: 'Follow-ups', to: '/followups', icon: ListTodo },
  { label: 'Responders', to: '/responders', icon: MessageCircle },
  { label: 'Inbox', to: '/inbox', icon: InboxIcon },
  { label: 'Opt-outs', to: '/optouts', icon: Ban },
  { label: 'Data Import', to: '/import-export', icon: Upload },
  { label: 'Integrations', to: '/integrations', icon: Plug },
  { label: 'Reports', to: '/reports', icon: BarChart3 },
  { label: 'Team', to: '/team', icon: Users },
  { label: 'Settings', to: '/settings', icon: Settings },
];
