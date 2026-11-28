// Scheduled follow-up dates ("Follow Up On"). A date is due on the day itself or earlier, and upcoming within the next 7 days.

export const UPCOMING_DAYS = 7;

export type ScheduleBucket = 'due' | 'upcoming' | 'later';

/** Local calendar date as YYYY-MM-DD, so "today" matches the user's day, not UTC. */
export function localDateKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Whole days from today to the follow-up date (negative when overdue). Both sides are calendar dates, not times. */
export function daysUntil(followUpOn: string, today: string = localDateKey()): number {
  const [ty, tm, td] = today.split('-').map(Number);
  const [fy, fm, fd] = followUpOn.split('-').map(Number);
  const todayUtc = Date.UTC(ty, tm - 1, td);
  const dueUtc = Date.UTC(fy, fm - 1, fd);
  return Math.round((dueUtc - todayUtc) / 86_400_000);
}

/** Shows a YYYY-MM-DD date as a calendar day. Parsing it as UTC midnight would show the day before in the Americas. */
export function formatScheduleDate(followUpOn: string): string {
  const [y, m, d] = followUpOn.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export interface SuggestedDate {
  followUpOn: string;
  /** The words in the message that gave the date, shown so a person can check it. */
  phrase: string;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function dayKey(date: Date): string {
  return localDateKey(date);
}

function addCalendarDays(base: Date, days: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
}

/**
 * Reads a follow-up date from an agent's message, e.g. "Erik will call at 12 PM on Friday, September 25", "tomorrow",
 * "in 3 days". Weekdays mean the next such day after the message. Month and day without a year use the next occurrence.
 * Returns null when no date is stated. The result is a suggestion: a person confirms it before it is used.
 */
export function suggestFollowUpDate(text: string, sentAt: Date): SuggestedDate | null {
  const lower = text.toLowerCase();

  const monthDay = lower.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (monthDay) {
    const month = MONTHS.indexOf(monthDay[1].slice(0, 3));
    const day = Number(monthDay[2]);
    if (day >= 1 && day <= 31) {
      let date = new Date(sentAt.getFullYear(), month, day);
      if (date.getMonth() !== month) return null; // e.g. February 30
      if (dayKey(date) < dayKey(sentAt)) date = new Date(sentAt.getFullYear() + 1, month, day);
      const phrase = text.slice(monthDay.index ?? 0, (monthDay.index ?? 0) + monthDay[0].length).trim();
      return { followUpOn: dayKey(date), phrase };
    }
  }

  const weekday = lower.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (weekday) {
    const target = WEEKDAYS.indexOf(weekday[1]);
    let offset = (target - sentAt.getDay() + 7) % 7;
    if (offset === 0) offset = 7; // the same weekday means the next one
    return { followUpOn: dayKey(addCalendarDays(sentAt, offset)), phrase: weekday[1] };
  }

  if (/\btomorrow\b/.test(lower)) {
    return { followUpOn: dayKey(addCalendarDays(sentAt, 1)), phrase: 'tomorrow' };
  }

  const inDays = lower.match(/\bin (\d{1,2}) days?\b/);
  if (inDays) {
    return { followUpOn: dayKey(addCalendarDays(sentAt, Number(inDays[1]))), phrase: inDays[0] };
  }

  return null;
}

export type ChatBookingStatus = 'booked' | 'overdue' | 'handled';

/**
 * Status of a date set in the chat.
 * - 'booked': the date is today or later.
 * - 'handled': one of our messages was sent after the date. Only our side completes a follow-up. A seller's reply does not.
 * - 'overdue': the date has passed and we have not replied since. It stays overdue until someone marks it done.
 * latestOutgoingAt is the newest message we sent; the seller's replies are not passed in here.
 */
export function chatBookingStatus(followUpOn: string, latestOutgoingAt: string | null, today: string = localDateKey()): ChatBookingStatus {
  if (followUpOn >= today) return 'booked';
  if (latestOutgoingAt && localDateKey(new Date(latestOutgoingAt)) > followUpOn) return 'handled';
  return 'overdue';
}

export function scheduleBucket(followUpOn: string, today: string = localDateKey()): ScheduleBucket {
  const days = daysUntil(followUpOn, today);
  if (days <= 0) return 'due';
  if (days <= UPCOMING_DAYS) return 'upcoming';
  return 'later';
}
