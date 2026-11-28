import type { LandRecord } from '@/data/types';
import { planCampaignExport, type ExportPlan } from '@/lib/campaignExport';
import { supabase } from '@/lib/supabase';
import { getSuppressedPhones } from '@/services/nextcrestData';
import { raiseAlert, resolveAlert } from '@/services/followUpEngine';

// Every marketing export checks the opt-out lists first, so an export never uses a list that is up to an hour old.
export const OPT_OUT_ALERT_KIND = 'opt_out_refresh_failed';

export async function refreshOptOutList(): Promise<{ ok: true; refreshedAt: string } | { ok: false; message: string }> {
  if (!supabase) return { ok: false, message: 'NextCrest is not connected to its database.' };
  const result = await requestOptOutRefresh(supabase);
  // The dashboard warning follows the last check: raised on failure, cleared on success. A failure to record it must not block the export.
  try {
    if (result.ok) await resolveAlert(OPT_OUT_ALERT_KIND);
    else await raiseAlert(OPT_OUT_ALERT_KIND, `Exports are blocked: ${result.message}`);
  } catch {
    // Recording the warning failed; the export result below still reports the real outcome.
  }
  return result;
}

async function requestOptOutRefresh(client: NonNullable<typeof supabase>): Promise<{ ok: true; refreshedAt: string } | { ok: false; message: string }> {
  try {
    const { data, error } = await client.functions.invoke('smartercontact-sync', { body: { action: 'refresh-opt-outs' } });
    if (error) {
      const response = (error as unknown as { context?: Response }).context;
      const details = (await response?.json?.().catch(() => null)) as { error?: string } | null;
      return { ok: false, message: details?.error ?? 'The opt-out list could not be checked. Try the export again.' };
    }
    return { ok: true, refreshedAt: (data as { refreshedAt: string }).refreshedAt };
  } catch {
    return { ok: false, message: 'The opt-out list could not be checked. Try the export again.' };
  }
}

/** The export plan for these records, built from an opt-out list checked just now. */
export async function freshExportPlan(records: LandRecord[]): Promise<{ ok: true; plan: ExportPlan; checkedAt: string } | { ok: false; message: string }> {
  const refreshed = await refreshOptOutList();
  if (!refreshed.ok) return refreshed;
  const phones = await getSuppressedPhones();
  return { ok: true, plan: planCampaignExport(records, phones), checkedAt: refreshed.refreshedAt };
}
