import type { LandRecord } from '@/data/types';
import { planCampaignExport, type ExportPlan } from '@/lib/campaignExport';
import { supabase } from '@/lib/supabase';
import { getSuppressedPhones } from '@/services/nextcrestData';

// Every marketing export checks the opt-out lists first, so an export never uses a list that is up to an hour old.
export async function refreshOptOutList(): Promise<{ ok: true; refreshedAt: string } | { ok: false; message: string }> {
  if (!supabase) return { ok: false, message: 'NextCrest is not connected to its database.' };
  try {
    const { data, error } = await supabase.functions.invoke('smartercontact-sync', { body: { action: 'refresh-opt-outs' } });
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
