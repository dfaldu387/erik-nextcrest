import { describe, expect, it } from 'vitest';
import { chatBookingStatus, daysUntil, formatScheduleDate, localDateKey, scheduleBucket, suggestFollowUpDate } from './followUpSchedule';

describe('formatScheduleDate', () => {
  it('shows the calendar day it was given, not the day before', () => {
    expect(formatScheduleDate('2026-11-27')).toBe('Nov 27, 2026');
  });
});

describe('scheduleBucket', () => {
  const today = '2026-11-27';

  it('treats today and earlier as due', () => {
    expect(scheduleBucket('2026-11-27', today)).toBe('due');
    expect(scheduleBucket('2026-11-01', today)).toBe('due');
  });

  it('treats the next 7 days as upcoming', () => {
    expect(scheduleBucket('2026-11-28', today)).toBe('upcoming');
    expect(scheduleBucket('2026-12-04', today)).toBe('upcoming');
  });

  it('treats anything further out as later', () => {
    expect(scheduleBucket('2026-12-05', today)).toBe('later');
  });

  it('counts whole calendar days across a month boundary', () => {
    expect(daysUntil('2026-12-01', '2026-11-27')).toBe(4);
    expect(daysUntil('2026-11-20', '2026-11-27')).toBe(-7);
  });
});

describe('suggestFollowUpDate', () => {
  // 2026-09-22 is a Tuesday.
  const tuesday = new Date(2026, 8, 22, 9, 30);

  it('reads a weekday with a month and day', () => {
    const got = suggestFollowUpDate('Erik will give you a call at 12 PM Eastern on Friday, September 25.', tuesday);
    expect(got).toEqual({ followUpOn: '2026-09-25', phrase: 'September 25' });
  });

  it('reads a weekday on its own as the next such day', () => {
    expect(suggestFollowUpDate('Ok let me try on Friday', tuesday)?.followUpOn).toBe('2026-09-25');
  });

  it('treats the same weekday as the following week', () => {
    const friday = new Date(2026, 8, 25, 10, 0);
    expect(suggestFollowUpDate('call me Friday', friday)?.followUpOn).toBe('2026-10-02');
  });

  it('reads tomorrow and in N days', () => {
    expect(suggestFollowUpDate('talk tomorrow?', tuesday)?.followUpOn).toBe('2026-09-23');
    expect(suggestFollowUpDate('check back in 3 days', tuesday)?.followUpOn).toBe('2026-09-25');
  });

  it('uses the next year when a month and day has already passed', () => {
    expect(suggestFollowUpDate('call on January 5', tuesday)?.followUpOn).toBe('2027-01-05');
  });

  it('returns null when no date is stated', () => {
    expect(suggestFollowUpDate('Thanks, that works for me', tuesday)).toBeNull();
    expect(suggestFollowUpDate('may I ask a question', tuesday)).toBeNull();
  });

  it('rejects an impossible day such as February 30', () => {
    expect(suggestFollowUpDate('call on February 30', tuesday)).toBeNull();
  });
});

describe('chatBookingStatus', () => {
  const today = '2026-11-27';

  it('is booked when the date is today or later', () => {
    expect(chatBookingStatus('2026-11-27', null, today)).toBe('booked');
    expect(chatBookingStatus('2026-12-02', '2026-11-20T10:00:00Z', today)).toBe('booked');
  });

  it('is overdue when the date passed and the chat has not moved on', () => {
    // The Kenneth Johnson case: booked for 25 Sep, last message on 22 Sep, today 27 Nov.
    expect(chatBookingStatus('2026-09-25', '2026-09-22T09:08:00Z', today)).toBe('overdue');
    expect(chatBookingStatus('2026-09-25', null, today)).toBe('overdue');
  });

  it('is handled when our team has replied after the date', () => {
    expect(chatBookingStatus('2026-09-25', '2026-10-01T15:00:00Z', today)).toBe('handled');
  });

  it('stays overdue when only the seller has written after the date', () => {
    // The seller replies; the team has not. Only an outgoing message counts, so the caller passes our latest message only.
    expect(chatBookingStatus('2026-09-25', null, today)).toBe('overdue');
    expect(chatBookingStatus('2026-09-25', '2026-09-22T09:08:00Z', today)).toBe('overdue');
  });
});

describe('localDateKey', () => {
  it('formats the local date as YYYY-MM-DD', () => {
    expect(localDateKey(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});
