import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { loadSettings, saveSettings, settingsSchema } from '@/lib/settings';
import type { Settings as SettingsValues } from '@/lib/settings';

type Errors = Partial<Record<keyof SettingsValues, string>>;

export function Settings() {
  const [values, setValues] = useState<SettingsValues>(() => loadSettings());
  const [saved, setSaved] = useState<SettingsValues>(() => loadSettings());
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<string | null>(null);

  const dirty = JSON.stringify(values) !== JSON.stringify(saved);

  const set = <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setStatus(null);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = settingsSchema.safeParse(values);
    if (!result.success) {
      const next: Errors = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0] as keyof SettingsValues | undefined;
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      setStatus('Fix the highlighted fields to save.');
      return;
    }
    setErrors({});
    const stored = saveSettings(result.data);
    setSaved(result.data);
    setValues(result.data);
    setStatus(stored ? 'Settings saved in this browser.' : 'Settings applied for this session. Browser storage is unavailable.');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Command Center', to: '/dashboard' }, { label: 'Settings' }]}
        title="Settings"
        description="Business rules for follow-ups, re-hits and exports. Each value is checked before it is saved."
      />

      <form onSubmit={onSubmit} noValidate className="space-y-6">
        <Section title="General" description="Organization details and defaults.">
          <Field label="Organization name" error={errors.organizationName}>
            <input
              className="field w-full"
              value={values.organizationName}
              onChange={(e) => set('organizationName', e.target.value)}
              aria-invalid={Boolean(errors.organizationName)}
            />
          </Field>
          <Field label="Time zone" error={errors.timezone}>
            <select className="field w-full" value={values.timezone} onChange={(e) => set('timezone', e.target.value as SettingsValues['timezone'])}>
              <option value="America/Chicago">Central (Chicago)</option>
              <option value="America/New_York">Eastern (New York)</option>
              <option value="America/Los_Angeles">Pacific (Los Angeles)</option>
            </select>
          </Field>
          <Field label="Default state" error={errors.defaultState}>
            <select className="field w-full" value={values.defaultState} onChange={(e) => set('defaultState', e.target.value as SettingsValues['defaultState'])}>
              <option value="TX">Texas</option>
              <option value="NC">North Carolina</option>
              <option value="FL">Florida</option>
            </select>
          </Field>
        </Section>

        <Section title="Marketing rules" description="How often owners are texted and when they become eligible again.">
          <Field label="Days between follow-up texts" error={errors.contactIntervalDays} hint="1 to 60 days">
            <input
              className="field w-full"
              type="number"
              inputMode="numeric"
              min={1}
              max={60}
              value={values.contactIntervalDays}
              onChange={(e) => set('contactIntervalDays', Number(e.target.value))}
              aria-invalid={Boolean(errors.contactIntervalDays)}
            />
          </Field>
          <Field label="Maximum texts before re-hit" error={errors.maxContacts} hint="1 to 10 texts">
            <input
              className="field w-full"
              type="number"
              inputMode="numeric"
              min={1}
              max={10}
              value={values.maxContacts}
              onChange={(e) => set('maxContacts', Number(e.target.value))}
              aria-invalid={Boolean(errors.maxContacts)}
            />
          </Field>
          <Field label="Days until 90-day re-hit" error={errors.rehitDays} hint="30 to 180 days">
            <input
              className="field w-full"
              type="number"
              inputMode="numeric"
              min={30}
              max={180}
              value={values.rehitDays}
              onChange={(e) => set('rehitDays', Number(e.target.value))}
              aria-invalid={Boolean(errors.rehitDays)}
            />
          </Field>
        </Section>

        <div className="sticky bottom-0 flex flex-col gap-3 border-t border-border bg-background/95 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {status ?? (dirty ? 'You have unsaved changes.' : 'All changes saved.')}
          </p>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost" disabled={!dirty} onClick={() => setValues(saved)}>
              Discard
            </button>
            <button type="submit" className="btn-primary" disabled={!dirty}>
              Save settings
            </button>
          </div>
        </div>
      </form>

      <section className="card space-y-2 p-5 text-sm text-muted-foreground" aria-labelledby="processing-heading">
        <h2 id="processing-heading" className="text-base font-semibold text-foreground">
          Data processing
        </h2>
        <p>
          APN matching uses the normalization rule that removes separators only, so leading zeros are kept. Owner names are split with the entity rule: LLCs, trusts,
          corporations and similar names stay whole.
        </p>
        <p>Editable normalization rules and mapping templates need the database.</p>
      </section>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="card space-y-4 p-5">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      {children}
      {error ? (
        <span role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </span>
      ) : (
        hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>
      )}
    </label>
  );
}
