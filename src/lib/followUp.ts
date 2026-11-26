// Follow-up schedule and 90-day re-hit rule (docs/BUSINESS_RULES.md, "Follow-up Eligibility" and "90-Day Re-marketing Cycle").
// The values live in the settings row sc_follow_up_rules (migration 036), which admins change on the Settings page.
// The SQL version is app_marketing_status(). Both read the same row, so they agree.

export interface FollowUpRules {
  /** Days after a contact before a follow-up is due. */
  quietDays: number;
  /** Contacts per cycle; at this count the property waits for the re-hit. */
  maxContacts: number;
  /** Days after the last contact when a property becomes eligible again, whatever its contact count. */
  rehitDays: number;
}

export const DEFAULT_FOLLOW_UP_RULES: FollowUpRules = { quietDays: 7, maxContacts: 3, rehitDays: 90 };

// The defaults, kept as named constants for the tests and for code that does not load the settings.
export const FOLLOW_UP_QUIET_DAYS = DEFAULT_FOLLOW_UP_RULES.quietDays;
export const FOLLOW_UP_MAX_CONTACTS = DEFAULT_FOLLOW_UP_RULES.maxContacts;
export const REHIT_DAYS = DEFAULT_FOLLOW_UP_RULES.rehitDays;

let activeRules: FollowUpRules = { ...DEFAULT_FOLLOW_UP_RULES };

/** Replaces the rules used by followUpDue(). The records loader calls this with the saved settings. */
export function setFollowUpRules(rules: FollowUpRules): void {
  activeRules = { ...rules };
}

export function getFollowUpRules(): FollowUpRules {
  return activeRules;
}

export type DueStage = 'followup_due' | 'rehit_due';

/**
 * Whether a contacted property is due again.
 * - At least rehitDays since the last contact: re-hit due, even after the contact limit.
 * - Fewer than maxContacts contacts and at least quietDays since the last contact: follow-up due.
 * - Otherwise null. Callers decide the contact-count stage.
 * Never-contacted properties and properties without a last-contact date are never due.
 */
export function followUpDue(totalContacts: number, lastContactedAt: string | null, now: Date = new Date()): DueStage | null {
  if (totalContacts <= 0 || !lastContactedAt) return null;
  const last = new Date(lastContactedAt).getTime();
  if (Number.isNaN(last)) return null;
  const days = (now.getTime() - last) / 86_400_000;
  if (days >= activeRules.rehitDays) return 'rehit_due';
  if (totalContacts < activeRules.maxContacts && days >= activeRules.quietDays) return 'followup_due';
  return null;
}
