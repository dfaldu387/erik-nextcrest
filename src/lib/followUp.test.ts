import { describe, expect, it } from 'vitest';
import { FOLLOW_UP_MAX_CONTACTS, FOLLOW_UP_QUIET_DAYS, REHIT_DAYS, followUpDue } from './followUp';
import { toMarketingStatus } from './propertyRecords';

const NOW = new Date('2026-11-26T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

describe('followUpDue', () => {
  it('has the rule constants from the business rules', () => {
    expect(FOLLOW_UP_QUIET_DAYS).toBe(7);
    expect(FOLLOW_UP_MAX_CONTACTS).toBe(3);
    expect(REHIT_DAYS).toBe(90);
  });

  it('is due for a follow-up after the quiet period, while under the contact limit', () => {
    expect(followUpDue(1, daysAgo(7), NOW)).toBe('followup_due');
    expect(followUpDue(2, daysAgo(30), NOW)).toBe('followup_due');
  });

  it('is not due inside the quiet period', () => {
    expect(followUpDue(1, daysAgo(6.9), NOW)).toBeNull();
  });

  it('is not a follow-up once the contact limit is reached, until the 90-day re-hit', () => {
    expect(followUpDue(3, daysAgo(30), NOW)).toBeNull();
  });

  it('is re-hit due at 90 days, even after the contact limit', () => {
    expect(followUpDue(3, daysAgo(90), NOW)).toBe('rehit_due');
    expect(followUpDue(1, daysAgo(120), NOW)).toBe('rehit_due');
  });

  it('is never due when never contacted or when the last date is missing', () => {
    expect(followUpDue(0, daysAgo(200), NOW)).toBeNull();
    expect(followUpDue(2, null, NOW)).toBeNull();
    expect(followUpDue(2, 'not a date', NOW)).toBeNull();
  });
});

describe('toMarketingStatus with the follow-up schedule', () => {
  it('shows follow-up due and re-hit due statuses', () => {
    expect(toMarketingStatus('contacted', 1, daysAgo(8), NOW)).toBe('followup_due');
    expect(toMarketingStatus('contacted', 3, daysAgo(91), NOW)).toBe('rehit_due');
  });

  it('keeps the contact stage when nothing is due yet', () => {
    expect(toMarketingStatus('contacted', 1, daysAgo(2), NOW)).toBe('contacted_1');
    expect(toMarketingStatus('contacted', 3, daysAgo(30), NOW)).toBe('contacted_3');
  });

  it('never queues responders, opted-out or wrong-number properties', () => {
    expect(toMarketingStatus('responded', 2, daysAgo(120), NOW)).toBe('contacted_2');
    expect(toMarketingStatus('opted_out', 1, daysAgo(120), NOW)).toBe('opted_out');
    expect(toMarketingStatus('wrong_number', 1, daysAgo(120), NOW)).toBe('wrong_number');
  });

  it('keeps never-contacted properties out of the queue', () => {
    expect(toMarketingStatus('never_contacted', 0, daysAgo(200), NOW)).toBe('never_marketed');
  });
});
