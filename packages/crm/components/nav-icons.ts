import {
  BarChart3, BellRing, DoorOpen, BriefcaseBusiness, CalendarCheck, CalendarClock, ClipboardCheck, Database,
  Grid2X2, HandCoins, House, Inbox, KanbanSquare, ListChecks, Mail, Plug, Send, Settings, Sparkles, Upload, UserRoundSearch, Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { IconKey } from '@/lib/application/app-navigation';

export const NAV_ICONS: Record<IconKey, LucideIcon> = {
  today: CalendarCheck,
  people: Users,
  deals: HandCoins,
  inbox: Inbox,
  omnix: Sparkles,
  pipeline: KanbanSquare,
  transactions: BriefcaseBusiness,
  properties: House,
  approvals: ClipboardCheck,
  alerts: BellRing,
  tasks: ListChecks,
  insights: BarChart3,
  nurture: CalendarClock,
  campaigns: Mail,
  mailers: Send,
  connections: Plug,
  data: Database,
  settings: Settings,
  review: UserRoundSearch,
  import: Upload,
  workspaces: Grid2X2,
  openhouse: DoorOpen,
};

