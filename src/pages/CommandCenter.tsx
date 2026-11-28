import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Ban, CalendarClock, CheckCircle2, Database, Download, Filter, MoreHorizontal, PhoneOff, RefreshCw, Search, Send, Settings, ShieldCheck, Sprout, Upload, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { useActivityQuery, useDashboardSummaryQuery, useInboxCountsQuery, useLeadGroupsQuery, useMarketingSplitQuery } from '@/hooks/useNextCrestData';
import { useAccountScope } from '@/lib/accountScope';
import { greeting } from '@/lib/greeting';
import { DASHBOARD_STALE_MS } from '@/lib/queryClient';
import { daysSince, formatCount, formatDate, formatTime } from '@/lib/format';
import type { LandRecord } from '@/data/types';
import { listImportBatches, searchProperties } from '@/services/nextcrestData';
import { countScheduledFollowUps, isRecentlyTexted, listOpenAlerts, listScheduledFollowUps } from '@/services/followUpEngine';
import { useTouchSummariesQuery } from '@/hooks/useNextCrestData';
import { daysUntil, formatScheduleDate, localDateKey } from '@/lib/followUpSchedule';
import type { DashboardSummary } from '@/services/nextcrestData';

const PANEL = 'card flex min-w-0 flex-col gap-4 p-5';
const TITLE = 'text-[13px] font-semibold text-foreground';
const SUB = 'text-[12px] text-muted-foreground';

const TONE = {
  purple: { bg: 'bg-brand-tint', text: 'text-brand' },
  blue: { bg: 'bg-blue-50', text: 'text-blue' },
  orange: { bg: 'bg-orange-50', text: 'text-warning' },
  green: { bg: 'bg-green-50', text: 'text-success' },
} as const;

// Chart tooltips use the app's dark card colours (the chart library defaults to white).
// The item line inside a tooltip is plain text: it must not repeat the box's background and border.
const TOOLTIP_ITEM_STYLE = { color: 'hsl(var(--foreground))', fontSize: 12, padding: 0 };

const TOOLTIP_STYLE = {
  backgroundColor: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 12,
  color: 'hsl(var(--foreground))',
  fontSize: 12,
};

export function CommandCenter() {
  const summaryQuery = useDashboardSummaryQuery();
  const leadQuery = useLeadGroupsQuery();
  const splitQuery = useMarketingSplitQuery();
  const activity = useActivityQuery();
  const imports = useQuery({ queryKey: ['import-batches'], queryFn: () => listImportBatches(4), staleTime: DASHBOARD_STALE_MS });
  const touches = useTouchSummariesQuery();
  // The account chosen in the top bar. SmarterContact numbers and property lists follow it; land totals and lead groups are shared.
  const { accountId, accounts } = useAccountScope();
  const accountLabel = accounts.find((a) => a.id === accountId)?.label ?? '';
  const followUps = useQuery({
    queryKey: ['dashboard-followups', accountId],
    queryFn: () => searchProperties({ search: '', status: 'followup_due', state: '', county: '', sort: 'last', dir: 'asc', page: 1, pageSize: 6, accountId }),
    staleTime: DASHBOARD_STALE_MS,
  });
  // Properties texted in the last 8 days are in the automatic campaign, so they are not shown for a manual follow-up.
  const dueRows = (followUps.data?.rows ?? []).filter((r) => !isRecentlyTexted(touches.data?.[r.id]?.lastOutgoingAt));
  const recent = useQuery({
    queryKey: ['dashboard-recent-contacts', accountId],
    queryFn: () => searchProperties({ search: '', status: '', state: '', county: '', sort: 'last', dir: 'desc', page: 1, pageSize: 4, accountId }),
    staleTime: DASHBOARD_STALE_MS,
  });
  const alerts = useQuery({ queryKey: ['app-alerts'], queryFn: listOpenAlerts });
  const scheduleCounts = useQuery({ queryKey: ['follow-up-schedule-counts'], queryFn: countScheduledFollowUps });
  const dueFollowUps = useQuery({ queryKey: ['follow-up-schedule-due'], queryFn: () => listScheduledFollowUps('due', 6) });
  const upcomingFollowUps = useQuery({ queryKey: ['follow-up-schedule-upcoming'], queryFn: () => listScheduledFollowUps('upcoming', 6) });
  const inboxCounts = useInboxCountsQuery(accountId);

  if (summaryQuery.isPending) {
    return (
      <div className="space-y-6">
        <Header />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="card h-28 animate-pulse p-5" aria-hidden="true" />
          ))}
        </div>
      </div>
    );
  }

  if (summaryQuery.isError) {
    return (
      <div className="space-y-6">
        <Header />
        <ErrorState message="We could not load the dashboard. Check your connection and try again." onRetry={() => summaryQuery.refetch()} />
      </div>
    );
  }

  const s: DashboardSummary = summaryQuery.data;
  const pct = (n: number) => (s.total ? `${Math.round((n / s.total) * 100)}%` : '—');
  const marketedPercent = s.total ? Math.round(((s.total - s.never_marketed) / s.total) * 100) : 0;
  const suppressed = s.wrong_number + s.opted_out;

  const counties = s.counties
    .map((c) => ({
      key: `${c.state}-${c.county}`,
      label: c.county || c.state,
      state: c.state,
      county: c.county,
      records: c.records,
      texted: c.texted,
      notTexted: c.records - c.texted,
      share: c.records ? Math.round((c.texted / c.records) * 100) : 0,
    }))
    .sort((a, b) => b.records - a.records);

  const statusSlices = [
    { name: 'Never marketed', value: s.never_marketed, fill: '#CBD5E1' },
    { name: 'Contacted', value: s.contacted, fill: '#60A5FA' },
    { name: 'Re-hit due', value: s.rehit_due, fill: '#7C3AED' },
    { name: 'Follow-up due', value: s.followup_due, fill: '#F97316' },
    { name: 'Suppressed', value: suppressed, fill: '#EF4444' },
  ];

  const progress = [
    { stage: 'All', count: s.total },
    { stage: '1x+', count: s.reached_1 },
    { stage: '2x+', count: s.reached_2 },
    { stage: '3x+', count: s.reached_3 },
    { stage: 'Replied', count: s.responded },
  ];

  const attention = [
    s.followup_due > 0 && {
      key: 'followup',
      icon: CalendarClock,
      tone: 'orange' as const,
      title: `${formatCount(s.followup_due)} records need a follow-up`,
      detail: 'Contacted, no reply yet, and due for the next text.',
      to: '/followups',
      action: 'Open queue',
    },
    s.rehit_due > 0 && {
      key: 'rehit',
      icon: RefreshCw,
      tone: 'purple' as const,
      title: `${formatCount(s.rehit_due)} records ready to re-hit`,
      detail: 'Last contacted 90 or more days ago.',
      to: '/followups?tab=rehit',
      action: 'Review',
    },
    s.wrong_number > 0 && {
      key: 'wrong',
      icon: PhoneOff,
      tone: 'blue' as const,
      title: `${formatCount(s.wrong_number)} wrong numbers to review`,
      detail: 'Excluded from campaigns until a corrected number is verified.',
      to: '/properties?status=wrong_number',
      action: 'View',
    },
  ].filter(Boolean) as { key: string; icon: LucideIcon; tone: 'orange' | 'purple' | 'blue'; title: string; detail: string; to: string; action: string }[];

  const loadedAt = new Date(summaryQuery.dataUpdatedAt).toISOString();
  const topMarkets = counties.slice(0, 3);

  return (
    <div className="space-y-6">
      <Header onRefresh={() => summaryQuery.refetch()} refreshing={summaryQuery.isFetching} />

      {(alerts.data ?? []).map((alert) => (
        <div key={alert.id} role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-amber-400 bg-amber-50 px-4 py-3 text-[13px] text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <span className="flex items-center gap-2">
            <AlertTriangle size={16} aria-hidden="true" />
            {alert.message}
          </span>
          <Link to="/lists" className="font-semibold underline">Open exports</Link>
        </div>
      ))}

      {/* All-accounts figures. Hidden when one account is chosen, so only that account's data shows. */}
      {/* Scheduled follow-ups: dated by "Follow Up On", due on the day or earlier */}
      {!accountId && (
      <section aria-labelledby="scheduled-heading" className={PANEL}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="scheduled-heading" className={TITLE}>Scheduled follow-ups</h2>
            <p className={SUB}>
              {formatCount(scheduleCounts.data?.due ?? 0)} due today or earlier · {formatCount(scheduleCounts.data?.upcoming ?? 0)} in the next 7 days
            </p>
          </div>
        </div>
        {dueFollowUps.isError || upcomingFollowUps.isError ? (
          <ErrorState message="Scheduled follow-ups could not be loaded." onRetry={() => { dueFollowUps.refetch(); upcomingFollowUps.refetch(); }} />
        ) : (dueFollowUps.data ?? []).length + (upcomingFollowUps.data ?? []).length === 0 ? (
          <EmptyState title="Nothing scheduled" description="Set a follow-up date on a property and it appears here when it is due." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {[
              { label: 'Due', rows: dueFollowUps.data ?? [] },
              { label: 'Upcoming', rows: upcomingFollowUps.data ?? [] },
            ].map((group) => (
              <div key={group.label} className="space-y-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</h3>
                {group.rows.length === 0 ? (
                  <p className="text-[12px] text-muted-foreground">None</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {group.rows.map((row) => {
                      const days = daysUntil(row.followUpOn, localDateKey());
                      return (
                        <li key={row.propertyId} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                          <span className="min-w-0 truncate">
                            <Link to={`/properties/${row.propertyId}`} className="font-medium hover:underline">{row.ownerName || '—'}</Link>
                            <span className="text-muted-foreground"> · {row.county}, {row.state}</span>
                          </span>
                          <span className={`shrink-0 text-[12px] ${days < 0 ? 'font-semibold text-red-600' : 'text-muted-foreground'}`}>
                            {days === 0 ? 'Today' : days < 0 ? `${-days} day${days === -1 ? '' : 's'} overdue` : formatScheduleDate(row.followUpOn)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
      )}

      {/* The selected SmarterContact account's conversations. Shown only when one account is chosen in the top bar. */}
      {accountId && (
        <section aria-label={`SmarterContact conversations for ${accountLabel}`} className="space-y-3">
          <div>
            <h2 className="text-base font-semibold">SmarterContact · {accountLabel}</h2>
            <p className="text-xs text-muted-foreground">Conversations in this account only. Change the account in the top bar.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <KpiCard title="All conversations" value={formatCount(inboxCounts.data?.all ?? 0)} caption="Every conversation in this account" icon={Send} tone="purple" to="/inbox" />
            <KpiCard title="Unread" value={formatCount(inboxCounts.data?.unread ?? 0)} caption="Not opened yet" icon={Send} tone="blue" to="/inbox" />
            <KpiCard title="Awaiting reply" value={formatCount(inboxCounts.data?.awaiting_reply ?? 0)} caption="Waiting for the contact to answer" icon={CalendarClock} tone="orange" to="/inbox" />
            <KpiCard title="Unreplied" value={formatCount(inboxCounts.data?.unreplied ?? 0)} caption="The contact wrote and nobody replied" icon={Send} tone="orange" to="/inbox" />
            <KpiCard title="Missed calls" value={formatCount(inboxCounts.data?.missed_calls ?? 0)} caption="Calls that were not answered" icon={PhoneOff} tone="blue" to="/inbox" />
            <KpiCard title="Opted out" value={formatCount(inboxCounts.data?.opted_out ?? 0)} caption="Asked not to be texted" icon={Ban} tone="purple" to="/inbox" />
          </div>
        </section>
      )}

      {!accountId && (
      <>
      {/* Row 1: four equal KPI cards */}
      <section aria-label="Key numbers" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Total properties" value={formatCount(s.total)} caption={accountId ? 'All land records, all accounts' : `Last loaded ${formatTime(loadedAt)}`} icon={Database} tone="purple" to="/properties" />
        <KpiCard title="Never marketed" value={formatCount(s.never_marketed)} caption={`${pct(s.never_marketed)} of properties`} icon={Sprout} tone="blue" to="/properties?status=never_marketed" />
        <KpiCard title="Follow-up due" value={formatCount(s.followup_due)} caption={`${pct(s.followup_due)} of properties`} icon={CalendarClock} tone="orange" to="/followups" />
        <KpiCard title="Responded" value={formatCount(s.responded)} caption={`${pct(s.responded)} of properties`} icon={CheckCircle2} tone="green" to="/responders" />
      </section>

      {/* Lead groups from the SmarterContact labels. Each property is counted once, in the first group that applies. */}
      <section aria-label="Lead groups" className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">Responders and lead groups</h2>
          <p className="text-xs text-muted-foreground">
            From SmarterContact labels. Follow-up dates are not available yet, so scheduled follow-ups come from the follow-up labels.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <KpiCard title="Nurture" value={formatCount(leadQuery.data?.nurture ?? 0)} caption="Positive responses that need comping" icon={Sprout} tone="green" to="/responders" />
          <KpiCard title="Scheduled follow-up" value={formatCount(leadQuery.data?.scheduled_followup ?? 0)} caption="Sellers who asked to be contacted later" icon={CalendarClock} tone="orange" to="/followups" />
          <KpiCard title="Excluded from marketing" value={formatCount(leadQuery.data?.excluded ?? 0)} caption="Not interested, disqualified or wrong number" icon={Ban} tone="purple" to="/responders" />
        </div>
      </section>

      {/* Never marketed vs previously marketed, from the full outbound message history. */}
      <section aria-label="Marketing history" className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">Marketing history</h2>
          <p className="text-xs text-muted-foreground">
            {formatCount(splitQuery.data?.conversations_read_in_full ?? 0)} of {formatCount(splitQuery.data?.conversations_total ?? 0)} conversations have been read in full. The counts are complete when this reaches all of them.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <KpiCard title="Never marketed" value={formatCount(splitQuery.data?.never_marketed ?? 0)} caption="No outbound text and no campaign contact" icon={Sprout} tone="blue" to="/properties?status=never_marketed" />
          <KpiCard title="Previously marketed" value={formatCount(splitQuery.data?.previously_marketed ?? 0)} caption="Has an outbound text or a campaign contact" icon={Send} tone="orange" to="/properties" />
        </div>
      </section>

      {/* Row 2: county chart, status donut, markets */}
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-[1.4fr_1fr_1.6fr]">
        <section className={`${PANEL} md:col-span-2 xl:col-span-1`} aria-labelledby="county-heading">
          <div className="flex items-start justify-between">
            <div>
              <h2 id="county-heading" className={TITLE}>Marketing by county</h2>
              <p className={SUB}>Properties texted and not yet texted</p>
            </div>
            <button type="button" aria-label="County options" className="rounded-md p-1 text-muted-foreground hover:bg-muted">
              <MoreHorizontal size={16} aria-hidden="true" />
            </button>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[26px] font-bold tabular-nums text-foreground">{formatCount(s.total)}</span>
            <span className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-success">{marketedPercent}% marketed</span>
          </div>
          <div className="flex items-center gap-4 text-[12px] text-foreground/80">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brand" aria-hidden="true" />Texted</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-blue" aria-hidden="true" />Not yet texted</span>
          </div>
          {counties.length === 0 ? (
            <EmptyState title="No counties yet" description="Counties appear once properties are imported." />
          ) : (
            <div className="h-56" role="img" aria-label={`Texted and not yet texted properties in ${counties.length} counties`}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={counties} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap="30%">
                  <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#EEF0F4" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#94A3B8' }} />
                  <YAxis tickLine={false} axisLine={false} width={44} tick={{ fontSize: 11, fill: '#94A3B8' }} allowDecimals={false} />
                  <Tooltip
                    cursor={{ fill: 'hsl(var(--muted))' }}
                    formatter={(value, name) => [formatCount(Number(value)), name === 'texted' ? 'Texted' : 'Not yet texted']}
                    contentStyle={TOOLTIP_STYLE}
                    itemStyle={TOOLTIP_ITEM_STYLE}
                  />
                  <Bar dataKey="notTexted" stackId="c" fill="#3B82F6" />
                  <Bar dataKey="texted" stackId="c" fill="#8B5CF6" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section className={PANEL} aria-labelledby="status-heading">
          <div className="flex items-start justify-between">
            <div>
              <h2 id="status-heading" className={TITLE}>Marketing status</h2>
              <p className={SUB}>Each property counted once</p>
            </div>
            <button type="button" aria-label="Status options" className="rounded-md p-1 text-muted-foreground hover:bg-muted">
              <MoreHorizontal size={16} aria-hidden="true" />
            </button>
          </div>
          {s.total === 0 ? (
            <EmptyState title="No data yet" description="The breakdown fills in once properties are imported." />
          ) : (
            <>
              <div className="relative mx-auto h-44 w-44" role="img" aria-label={`${formatCount(s.total)} properties by marketing status`}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusSlices} dataKey="value" nameKey="name" innerRadius={58} outerRadius={80} paddingAngle={2} stroke="none">
                      {statusSlices.map((slice) => (
                        <Cell key={slice.name} fill={slice.fill} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => formatCount(Number(value))} contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} wrapperStyle={{ zIndex: 20 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-bold tabular-nums">{formatCount(s.total)}</span>
                  <span className="text-[11px] text-muted-foreground">Properties</span>
                </div>
              </div>
              <ul className="space-y-2.5 text-[12px]">
                {statusSlices.map((slice) => (
                  <li key={slice.name} className="flex items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: slice.fill }} aria-hidden="true" />
                    <span className="flex-1 text-foreground/80">{slice.name}</span>
                    <span className="tabular-nums text-muted-foreground">{formatCount(slice.value)}</span>
                    <span className="w-10 text-right font-medium tabular-nums text-foreground">{pct(slice.value)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className={`${PANEL} md:col-span-2 xl:col-span-1`} aria-labelledby="markets-heading">
          <div className="flex items-start justify-between">
            <div>
              <h2 id="markets-heading" className={TITLE}>Markets</h2>
              <p className={SUB}>Largest counties by records</p>
            </div>
            <Link to="/purchases" className="text-[12px] font-semibold text-brand hover:underline">View all →</Link>
          </div>
          {topMarkets.length === 0 ? (
            <EmptyState title="No markets yet" description="Markets appear once a county has properties." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
              {topMarkets.map((m) => (
                <Link key={m.key} to={`/properties?state=${m.state}&county=${m.county}`} className="group rounded-[12px] border border-border p-3 transition-shadow hover:shadow-md">
                  <p className="text-[13px] font-semibold text-foreground">{m.county || 'No county'}, {m.state}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">{formatCount(m.records)} records</p>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={m.share} aria-valuemin={0} aria-valuemax={100} aria-label={`${m.county} contacted`}>
                    <div className="h-full rounded-full bg-gradient-to-r from-brand-bright to-brand" style={{ width: `${m.share}%` }} />
                  </div>
                  <p className="mt-1.5 text-[11px] text-muted-foreground tabular-nums">{m.share}% texted</p>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Row 3: contact progress, attention, follow-up queue */}
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-[1fr_1fr_2fr]">
        <section className={PANEL} aria-labelledby="progress-heading">
          <h2 id="progress-heading" className={TITLE}>Contact progress</h2>
          <div className="flex items-end gap-2">
            <span className="text-[26px] font-bold tabular-nums">{formatCount(s.reached_1)}</span>
            <span className="pb-1 text-[12px] text-muted-foreground">properties texted at least once</span>
          </div>
          {s.total === 0 ? (
            <EmptyState title="No data yet" description="Progress shows once properties are imported and texted." />
          ) : (
            <div className="h-40" role="img" aria-label="Properties by how many times they were texted">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={progress} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barCategoryGap="28%">
                  <XAxis dataKey="stage" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#94A3B8' }} />
                  <Tooltip cursor={{ fill: 'hsl(var(--muted))' }} formatter={(value) => [formatCount(Number(value)), 'Properties']} contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} />
                  <Bar dataKey="count" fill="#8B5CF6" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <ul className="space-y-2 text-[12px]">
            {progress.map((p) => (
              <li key={p.stage} className="flex items-center justify-between">
                <span className="text-foreground/80">{p.stage === 'All' ? 'All properties' : `Texted ${p.stage}`}</span>
                <span className="tabular-nums text-muted-foreground">{formatCount(p.count)} · {pct(p.count)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className={PANEL} aria-labelledby="attention-heading">
          <div className="flex items-start justify-between">
            <div>
              <h2 id="attention-heading" className={TITLE}>Needs your attention</h2>
              <p className={SUB}>Things waiting on you today</p>
            </div>
          </div>
          {s.total === 0 ? (
            <EmptyState title="No data yet" description="Import a purchased file to start." action={<Link to="/import-export" className="btn-primary">Import a file</Link>} />
          ) : attention.length === 0 ? (
            <EmptyState tone="success" title="All caught up" description="Nothing is waiting on you right now." />
          ) : (
            <ul className="space-y-3">
              {attention.map((item) => {
                const Icon = item.icon;
                const tone = TONE[item.tone];
                return (
                  <li key={item.key} className="flex items-start gap-3">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] ${tone.bg} ${tone.text}`} aria-hidden="true">
                      <Icon size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-foreground">{item.title}</p>
                      <p className="text-[11px] text-muted-foreground">{item.detail}</p>
                    </div>
                    <Link to={item.to} className="shrink-0 text-[12px] font-semibold text-brand hover:underline">{item.action}</Link>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-auto rounded-[10px] bg-muted/60 p-3 text-[11px] text-muted-foreground">
            {formatCount(suppressed)} numbers are suppressed and excluded from every export.
          </div>
        </section>

        <section className={`${PANEL} md:col-span-2 xl:col-span-1`} aria-labelledby="queue-heading">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="queue-heading" className={TITLE}>Follow-up queue</h2>
              <p className={SUB}>Longest waiting first · {formatCount(s.followup_due)} due</p>
            </div>
            <div className="flex items-center gap-2">
              <Link to="/followups" className="inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-border px-2.5 text-[12px] font-medium hover:bg-muted">
                <Filter size={13} aria-hidden="true" /> Filter
              </Link>
              <Link to="/lists" className="inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-border px-2.5 text-[12px] font-medium hover:bg-muted">
                <Download size={13} aria-hidden="true" /> Export
              </Link>
              <Link to="/settings" className="inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-border px-2.5 text-[12px] font-medium hover:bg-muted">
                <Settings size={13} aria-hidden="true" /> Marketing settings
              </Link>
            </div>
          </div>
          {followUps.isPending ? (
            <Skeleton className="h-40 w-full" />
          ) : followUps.isError ? (
            <ErrorState message="The follow-up queue could not be loaded." onRetry={() => followUps.refetch()} />
          ) : dueRows.length === 0 ? (
            <EmptyState tone="success" title="All caught up" description="No follow-ups are due right now." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-[12px]">
                <caption className="sr-only">Properties due for follow-up</caption>
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="py-2 pr-3 font-semibold">Owner</th>
                    <th scope="col" className="py-2 pr-3 font-semibold">County</th>
                    <th scope="col" className="py-2 pr-3 font-semibold">Status</th>
                    <th scope="col" className="py-2 pr-3 text-right font-semibold">Texted</th>
                    <th scope="col" className="py-2 pr-3 font-semibold">Last texted</th>
                    <th scope="col" className="py-2 text-right font-semibold"><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody>
                  {dueRows.map((r) => (
                    <tr key={r.id} className="border-b border-border last:border-0 transition-colors hover:bg-muted/60">
                      <td className="py-2.5 pr-3">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[10px] font-bold text-brand" aria-hidden="true">
                            {initialsOf(r.ownerName)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-foreground">{r.ownerName || '—'}</p>
                            <p className="font-mono text-[11px] text-muted-foreground">{r.apn}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 pr-3 text-foreground/80">{r.county}, {r.state}</td>
                      <td className="py-2.5 pr-3">
                        <span className="inline-flex rounded-full border border-warning/40 bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-warning">Follow-up due</span>
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{r.timesContacted}</td>
                      <td className="py-2.5 pr-3 text-muted-foreground">{lastTextedLabel(r)}</td>
                      <td className="py-2.5 text-right">
                        <Link to={`/properties/${r.id}`} className="inline-flex items-center gap-1 font-semibold text-brand hover:underline">
                          Open <ArrowRight size={12} aria-hidden="true" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* Row 4: quick actions, recently texted, imports, activity */}
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        <section className={PANEL} aria-labelledby="quick-heading">
          <h2 id="quick-heading" className={TITLE}>Quick actions</h2>
          <ul className="space-y-2">
            {[
              { label: 'Import data', hint: 'Upload a purchased file', to: '/import-export', icon: Upload },
              { label: 'Export SMS list', hint: 'Campaign-ready list', to: '/lists', icon: Send },
              { label: 'Exclusion file', hint: 'Check before you buy', to: '/check-before-buying', icon: ShieldCheck },
              { label: 'Check properties', hint: 'Search every parcel', to: '/properties', icon: Search },
            ].map((action) => (
              <li key={action.label}>
                <Link to={action.to} className="flex items-center gap-3 rounded-[10px] px-2 py-2 transition-colors hover:bg-brand-tint">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-brand-tint text-brand">
                    <action.icon size={15} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-foreground">{action.label}</span>
                    <span className="block text-[11px] text-muted-foreground">{action.hint}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className={PANEL} aria-labelledby="recent-heading">
          <div className="flex items-start justify-between">
            <h2 id="recent-heading" className={TITLE}>Recently texted</h2>
            <Link to="/followups" className="text-[12px] font-semibold text-brand hover:underline">All →</Link>
          </div>
          {recent.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : (recent.data?.rows ?? []).length === 0 ? (
            <EmptyState title="Nothing texted yet" description="Contacts appear here once texting starts." />
          ) : (
            <ul className="space-y-3">
              {(recent.data?.rows ?? []).map((r) => (
                <li key={r.id} className="flex items-center gap-3">
                  <DateBlock iso={r.lastContactedAt} />
                  <div className="min-w-0 flex-1">
                    <Link to={`/properties/${r.id}`} className="block truncate text-[13px] font-medium hover:underline">{r.ownerName || '—'}</Link>
                    <p className="truncate text-[11px] text-muted-foreground">{r.county}, {r.state} · {r.timesContacted}× texted</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={PANEL} aria-labelledby="imports-heading">
          <h2 id="imports-heading" className={TITLE}>Recent imports</h2>
          {imports.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : imports.isError ? (
            <p className="text-[12px] text-muted-foreground">Import history could not be loaded.</p>
          ) : (imports.data ?? []).length === 0 ? (
            <EmptyState title="No imports yet" description="Each purchase file you save appears here." />
          ) : (
            <ul className="space-y-3">
              {(imports.data ?? []).map((b) => (
                <li key={b.id} className="flex items-start gap-3">
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${b.status === 'completed' ? 'border-brand bg-brand text-white' : 'border-slate-300'}`} aria-hidden="true">
                    {b.status === 'completed' && <CheckCircle2 size={11} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-[11px] text-foreground">{b.filename}</p>
                    <p className="text-[11px] text-muted-foreground">{formatCount(b.committed_rows)} new · {formatTime(b.created_at)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={PANEL} aria-labelledby="activity-heading">
          <div className="flex items-center justify-between">
            <h2 id="activity-heading" className={TITLE}>Recent activity</h2>
            {(activity.data?.data ?? []).length > 0 && (
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-success">
                <span className="h-2 w-2 rounded-full bg-success" aria-hidden="true" /> Live
              </span>
            )}
          </div>
          {activity.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : activity.isError ? (
            <p className="text-[12px] text-muted-foreground">Activity could not be loaded.</p>
          ) : (activity.data?.data ?? []).length === 0 ? (
            <EmptyState title="No activity yet" description="Texting, imports and exports appear here as they happen." />
          ) : (
            <ul className="space-y-3">
              {(activity.data?.data ?? []).map((event) => (
                <li key={event.id} className="text-[12px]">
                  <span className="font-semibold text-foreground">{event.user}</span> <span className="text-muted-foreground">{event.action}</span>
                  <time className="block text-[11px] text-muted-foreground" dateTime={event.at}>{formatTime(event.at)}</time>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      </>
      )}
    </div>
  );
}

function KpiCard({ title, value, caption, icon: Icon, tone, to }: { title: string; value: string; caption: string; icon: LucideIcon; tone: keyof typeof TONE; to: string }) {
  const t = TONE[tone];
  return (
    <Link to={to} className="card flex flex-col gap-3 p-5 transition-shadow duration-200 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[12px] font-semibold text-foreground/80">{title}</h2>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${t.bg} ${t.text}`} aria-hidden="true">
          <Icon size={17} />
        </span>
      </div>
      <span className="text-[26px] font-bold leading-none tabular-nums text-foreground">{value}</span>
      <p className="text-[11px] text-muted-foreground">{caption}</p>
    </Link>
  );
}

function DateBlock({ iso }: { iso: string | null }) {
  const date = iso ? new Date(iso) : null;
  return (
    <div className="flex w-11 shrink-0 flex-col items-center rounded-[10px] bg-muted py-1.5" aria-hidden="true">
      <span className="text-[9px] font-semibold uppercase text-muted-foreground">
        {date ? date.toLocaleDateString('en-US', { weekday: 'short' }) : '—'}
      </span>
      <span className="text-[15px] font-bold tabular-nums text-foreground">{date ? date.getDate() : '—'}</span>
    </div>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  return parts
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('');
}

function lastTextedLabel(r: LandRecord): ReactNode {
  const days = daysSince(r.lastContactedAt);
  return days === null ? 'Never' : `${formatDate(r.lastContactedAt)} (${days}d ago)`;
}

// Page heading with the greeting and the main actions.
function Header({ onRefresh, refreshing }: { onRefresh?: () => void; refreshing?: boolean }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-[12px] text-muted-foreground">
          Workspace <span aria-hidden="true">/</span> <span className="font-medium text-foreground">Overview</span>
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">{greeting()}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Land data management · where things stand today.</p>
      </div>
      {onRefresh && (
        <button type="button" className="btn-secondary" onClick={onRefresh} disabled={refreshing}>
          <RefreshCw size={15} aria-hidden="true" className={refreshing ? 'animate-spin' : ''} /> Refresh
        </button>
      )}
    </div>
  );
}

