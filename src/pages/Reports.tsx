import { Download } from 'lucide-react';
import { useMemo } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PageHeader } from '@/components/ui/PageHeader';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/ui/States';
import { useScopedRecords } from '@/hooks/useNextCrestData';
import type { MarketingStatus } from '@/data/types';
import { downloadCsv, toCsv } from '@/lib/csv';
import { formatCount } from '@/lib/format';
import { summarize } from '@/lib/metrics';
import { statusConfig } from '@/components/ui/StatusChip';

const STATUS_COLORS: Record<MarketingStatus, string> = {
  never_marketed: '#94a3b8',
  contacted_1: '#60a5fa',
  contacted_2: '#2563eb',
  contacted_3: '#1e40af',
  followup_due: '#d97706',
  rehit_due: '#7e22ce',
  wrong_number: '#dc2626',
  opted_out: '#334155',
};

const ACRE_BUCKETS = [
  { label: '0–10 ac', min: 0, max: 10 },
  { label: '10–50 ac', min: 10, max: 50 },
  { label: '50–200 ac', min: 50, max: 200 },
  { label: '200+ ac', min: 200, max: Infinity },
];

const tooltipStyle = { borderRadius: 8, fontSize: 12 };

export function Reports() {
  const { data, isPending, isError, refetch } = useScopedRecords();
  const records = useMemo(() => data?.data ?? [], [data]);

  const byCounty = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of records) map.set(`${r.county}, ${r.state}`, (map.get(`${r.county}, ${r.state}`) ?? 0) + 1);
    return [...map.entries()].map(([county, count]) => ({ county, count })).sort((a, b) => b.count - a.count);
  }, [records]);

  const byStatus = useMemo(
    () =>
      (Object.keys(statusConfig) as MarketingStatus[])
        .map((key) => ({ key, name: statusConfig[key].label, value: records.filter((r) => r.status === key).length }))
        .filter((s) => s.value > 0),
    [records],
  );

  const byAcres = useMemo(
    () => ACRE_BUCKETS.map((b) => ({ label: b.label, count: records.filter((r) => r.acres >= b.min && r.acres < b.max).length })),
    [records],
  );

  const byMonth = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of records) {
      const key = r.acquiredAt.slice(0, 7);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, count]) => ({
        month: new Date(`${key}-01T00:00:00`).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        count,
      }));
  }, [records]);

  const header = (
    <PageHeader
      breadcrumbs={[{ label: 'Command Center', to: '/dashboard' }, { label: 'Reports' }]}
      title="Reports"
      description="Portfolio, acquisition and marketing numbers, all counted from the records."
      actions={
        <button
          type="button"
          className="btn-secondary"
          disabled={records.length === 0}
          onClick={() => {
            const s = summarize(records);
            const rows: (string | number)[][] = [
              ['Total records', s.total],
              ['Never marketed', s.neverMarketed],
              ['Follow-up due', s.followUpDue],
              ['Re-hit due', s.rehitDue],
              ['Wrong numbers', s.wrongNumbers],
              ['Opted out', s.optedOut],
              ['Reached 1x or more', s.reachedAtLeast1],
              ['Reached 2x or more', s.reachedAtLeast2],
              ['Reached 3x or more', s.reachedAtLeast3],
              ['Replied', s.responded],
            ];
            downloadCsv(`portfolio_summary_${new Date().toISOString().slice(0, 10)}.csv`, toCsv(['Measure', 'Count'], rows));
          }}
        >
          <Download size={16} aria-hidden="true" /> Export summary
        </button>
      }
    />
  );

  if (isPending) {
    return (
      <div className="space-y-6">
        {header}
        <div className="grid gap-6 lg:grid-cols-2">
          <CardSkeleton rows={6} />
          <CardSkeleton rows={6} />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState message="Reports could not be calculated." onRetry={() => refetch()} />
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <div className="card">
          <EmptyState title="No data to report on" description="Reports fill in once properties are imported." />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Properties by county" subtitle="Records per county">
          <ChartBox>
            <BarChart data={byCounty} layout="vertical" margin={{ left: 8, right: 24 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#94a3b8" strokeOpacity={0.25} />
              <XAxis type="number" tick={{ fontSize: 12 }} stroke="#94a3b8" />
              <YAxis type="category" dataKey="county" width={130} tick={{ fontSize: 12 }} stroke="#94a3b8" />
              <Tooltip cursor={{ fill: 'transparent' }} contentStyle={tooltipStyle} formatter={(v) => [formatCount(Number(v)), 'Records']} />
              <Bar dataKey="count" fill="#0f766e" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ChartBox>
        </Panel>

        <Panel title="Contact status" subtitle="How the portfolio is distributed">
          <ChartBox>
            <PieChart>
              <Pie data={byStatus} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={2}>
                {byStatus.map((s) => (
                  <Cell key={s.key} fill={STATUS_COLORS[s.key]} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => formatCount(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ChartBox>
        </Panel>

        <Panel title="Acreage" subtitle="Records by parcel size">
          <ChartBox>
            <BarChart data={byAcres} margin={{ left: 0, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#94a3b8" strokeOpacity={0.25} />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="#94a3b8" />
              <YAxis tick={{ fontSize: 12 }} stroke="#94a3b8" />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => [formatCount(Number(v)), 'Records']} />
              <Bar dataKey="count" fill="#0f766e" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ChartBox>
        </Panel>

        <Panel title="Properties acquired over time" subtitle="By month of acquisition">
          {byMonth.length === 0 ? (
            <p className="text-sm text-muted-foreground">No acquisition dates recorded.</p>
          ) : (
            <ChartBox>
              <BarChart data={byMonth} margin={{ left: 0, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#94a3b8" strokeOpacity={0.25} />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                <YAxis tick={{ fontSize: 12 }} stroke="#94a3b8" />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => [formatCount(Number(v)), 'Records']} />
                <Bar dataKey="count" fill="#2563eb" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ChartBox>
          )}
        </Panel>
      </div>

      <p className="text-xs text-muted-foreground">
        Date-range, state and campaign filters on reports will work once the database is connected. Figures above cover the records in the database.
      </p>
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="card p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mb-4 text-xs text-muted-foreground">{subtitle}</p>
      {children}
    </section>
  );
}

function ChartBox({ children }: { children: ReactElement }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}
