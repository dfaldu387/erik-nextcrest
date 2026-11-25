import type { ReactNode } from 'react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/ui/PageHeader';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/ui/States';
import { StatusChip } from '@/components/ui/StatusChip';
import { useRecordsQuery } from '@/hooks/useNextCrestData';
import type { LandRecord, MarketingStatus } from '@/data/types';
import { normalizePhone } from '@/lib/campaignExport';
import { daysSince, formatAcres, formatDate } from '@/lib/format';
import { buildMarkets } from '@/lib/metrics';
import { splitOwner } from '@/lib/owner';

const TABS = [
  'Overview',
  'Ownership',
  'Location',
  'Data sources',
  'Acquisition',
  'Marketing',
  'Responses',
  'Follow-ups',
  'Notes',
  'Audit',
] as const;
type Tab = (typeof TABS)[number];

const NOT_RECORDED = 'Not recorded';

const followUpText: Record<MarketingStatus, string> = {
  never_marketed: 'Not in a follow-up sequence yet.',
  contacted_1: 'Contacted once. Waiting for the next follow-up window.',
  contacted_2: 'Contacted twice. Waiting for the next follow-up window.',
  contacted_3: 'Contact limit reached. Eligible for re-hit after 90 days.',
  followup_due: 'Due for follow-up.',
  rehit_due: 'Due for the 90-day re-hit.',
  wrong_number: 'Excluded: wrong number on file.',
  opted_out: 'Excluded: owner opted out.',
};

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="divide-y divide-border rounded-md border border-border">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4 px-4 py-2.5 text-sm">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="text-right font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card space-y-3 p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function PropertyDetail() {
  const { id = '' } = useParams();
  const { data, isPending, isError, refetch } = useRecordsQuery();
  const [tab, setTab] = useState<Tab>('Overview');

  if (isPending) {
    return (
      <div className="space-y-6">
        <PageHeader title="Property" description="Loading the property record." />
        <CardSkeleton rows={5} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Property" description="Could not load this property." />
        <ErrorState message="The property could not be loaded." onRetry={() => refetch()} />
      </div>
    );
  }

  const record = data.data.find((r) => r.id === id);
  if (!record) {
    return (
      <div className="space-y-6">
        <PageHeader
          breadcrumbs={[{ label: 'Properties', to: '/properties' }, { label: 'Not found' }]}
          title="Property not found"
          description="This property is not in your database."
        />
        <div className="card">
          <EmptyState
            title="No property with this ID"
            description="It may have been merged or removed. Go back to the property list to find it."
            action={
              <Link to="/properties" className="btn-primary">
                Back to properties
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  const dataset = buildMarkets(data.data).find((m) => m.state === record.state && m.county === record.county);

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Properties', to: '/properties' }, { label: record.apn }]}
        title={record.ownerName}
        description={`APN ${record.apn} · ${record.county} County, ${record.state} · ${formatAcres(record.acres)}`}
        actions={<StatusChip status={record.status} />}
      />

      <div role="tablist" aria-label="Property sections" className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={t === tab}
            onClick={() => setTab(t)}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium ${
              t === tab ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="space-y-6">
        {tab === 'Overview' && <OverviewTab record={record} dataset={dataset?.name} />}
        {tab === 'Ownership' && <OwnershipTab record={record} />}
        {tab === 'Location' && <LocationTab record={record} />}
        {tab === 'Data sources' && <SourcesTab record={record} datasetId={dataset?.id} datasetName={dataset?.name} />}
        {tab === 'Acquisition' && <AcquisitionTab record={record} datasetId={dataset?.id} datasetName={dataset?.name} />}
        {tab === 'Marketing' && <MarketingTab record={record} />}
        {tab === 'Responses' && <ResponsesTab record={record} />}
        {tab === 'Follow-ups' && <FollowUpsTab record={record} />}
        {tab === 'Notes' && (
          <div className="card">
            <EmptyState title="No notes yet" description="Notes are saved once the database is connected." />
          </div>
        )}
        {tab === 'Audit' && (
          <div className="card">
            <EmptyState
              title="No audit history yet"
              description="Changes to this property will be logged here once the database and sign-in are connected."
            />
          </div>
        )}
      </div>
    </div>
  );
}

function OverviewTab({ record, dataset }: { record: LandRecord; dataset: string | undefined }) {
  const days = daysSince(record.lastContactedAt);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title="Key facts">
        <Facts
          rows={[
            ['Owner', record.ownerName],
            ['Owner type', record.ownerType],
            ['APN', <span key="apn" className="font-mono text-xs">{record.apn}</span>],
            ['County', `${record.county}, ${record.state}`],
            ['Acres', formatAcres(record.acres)],
            ['Dataset', dataset ?? NOT_RECORDED],
          ]}
        />
      </Panel>
      <Panel title="Activity timeline">
        <ol className="space-y-3 text-sm">
          <li className="flex gap-3">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
            <span>
              <span className="font-medium">Acquired</span> <span className="text-muted-foreground">{formatDate(record.acquiredAt)}</span>
            </span>
          </li>
          {record.lastContactedAt ? (
            <li className="flex gap-3">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500" aria-hidden="true" />
              <span>
                <span className="font-medium">
                  Last texted ({record.timesContacted}x total)
                </span>{' '}
                <span className="text-muted-foreground">
                  {formatDate(record.lastContactedAt)}
                  {days !== null && ` · ${days} days ago`}
                </span>
              </span>
            </li>
          ) : (
            <li className="text-muted-foreground">Never texted.</li>
          )}
          {record.responded && (
            <li className="flex gap-3">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-green-600" aria-hidden="true" />
              <span className="font-medium">Owner replied</span>
            </li>
          )}
        </ol>
      </Panel>
    </div>
  );
}

function OwnershipTab({ record }: { record: LandRecord }) {
  const owner = splitOwner(record.ownerName);
  const phone = normalizePhone(record.phone);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title="Owner">
        <Facts
          rows={[
            ['Full name', record.ownerName],
            ['Owner type', record.ownerType],
            ['First name (for SmarterContact)', owner.first || NOT_RECORDED],
            ['Last name (for SmarterContact)', owner.isEntity ? 'Not used for entities' : owner.last || NOT_RECORDED],
            ['Phone on file', phone ? record.phone : NOT_RECORDED],
            ['Mailing address', NOT_RECORDED],
            ['Email', NOT_RECORDED],
          ]}
        />
      </Panel>
      <p className="text-sm text-muted-foreground lg:col-span-2">
        Entities such as LLCs, trusts and corporations keep their full name in First Name. They are never split into a first and last name.
      </p>
    </div>
  );
}

function LocationTab({ record }: { record: LandRecord }) {
  return (
    <Panel title="Location">
      <Facts
        rows={[
          ['State', record.state],
          ['County', record.county],
          ['ZIP', record.zip],
          ['APN / parcel ID', <span key="apn" className="font-mono text-xs">{record.apn}</span>],
          ['Street address', 'Not recorded (most land has no street address)'],
          ['Latitude / longitude', NOT_RECORDED],
          ['Zoning and land use', NOT_RECORDED],
        ]}
      />
    </Panel>
  );
}

function SourcesTab({
  record,
  datasetId,
  datasetName,
}: {
  record: LandRecord;
  datasetId: string | undefined;
  datasetName: string | undefined;
}) {
  return (
    <Panel title="Data sources">
      <Facts
        rows={[
          ['Source', 'Land Portal'],
          ['Original source record ID', NOT_RECORDED],
          [
            'Dataset',
            datasetId && datasetName ? (
              <Link key="ds" to={`/purchases/${datasetId}`} className="text-primary hover:underline">
                {datasetName}
              </Link>
            ) : (
              NOT_RECORDED
            ),
          ],
          ['First acquired', formatDate(record.acquiredAt)],
        ]}
      />
    </Panel>
  );
}

function AcquisitionTab({
  record,
  datasetId,
  datasetName,
}: {
  record: LandRecord;
  datasetId: string | undefined;
  datasetName: string | undefined;
}) {
  return (
    <Panel title="Acquisition history">
      {datasetId && datasetName ? (
        <ul className="divide-y divide-border text-sm">
          <li className="flex items-center justify-between gap-4 py-3">
            <div className="min-w-0">
              <Link to={`/purchases/${datasetId}`} className="block truncate font-mono text-xs text-primary hover:underline">
                {datasetName}
              </Link>
              <p className="text-xs text-muted-foreground">Added {formatDate(record.acquiredAt)}</p>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">Cost: {NOT_RECORDED}</span>
          </li>
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No dataset is linked to this property.</p>
      )}
    </Panel>
  );
}

function MarketingTab({ record }: { record: LandRecord }) {
  return (
    <Panel title="Marketing history">
      <Facts
        rows={[
          ['Times texted', String(record.timesContacted)],
          ['Last texted', formatDate(record.lastContactedAt)],
          ['Campaigns', record.timesContacted > 0 ? 'Recorded in contact history' : 'None'],
          ['Message-by-message timeline', 'Available once SmarterContact history is connected'],
        ]}
      />
    </Panel>
  );
}

function ResponsesTab({ record }: { record: LandRecord }) {
  return (
    <Panel title="Responses">
      <Facts
        rows={[
          ['Replied', record.responded ? 'Yes' : 'No reply recorded'],
          ['Response classification', NOT_RECORDED],
          ['Reply text', NOT_RECORDED],
        ]}
      />
    </Panel>
  );
}

function FollowUpsTab({ record }: { record: LandRecord }) {
  return (
    <Panel title="Follow-ups">
      <Facts
        rows={[
          ['Status', <StatusChip key="s" status={record.status} />],
          ['What this means', followUpText[record.status]],
          ['Assigned to', record.assignedTo ?? 'Unassigned'],
        ]}
      />
    </Panel>
  );
}
