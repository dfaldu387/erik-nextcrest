import { z } from 'zod';

export const settingsSchema = z.object({
  organizationName: z.string().trim().min(1, 'Enter an organization name.').max(120, 'Keep this under 120 characters.'),
  timezone: z.enum(['America/Chicago', 'America/New_York', 'America/Los_Angeles']),
  defaultState: z.enum(['TX', 'NC', 'FL']),
  contactIntervalDays: z.number().int('Use a whole number of days.').min(1, 'Minimum is 1 day.').max(60, 'Maximum is 60 days.'),
  maxContacts: z.number().int('Use a whole number.').min(1, 'Minimum is 1.').max(10, 'Maximum is 10.'),
  rehitDays: z.number().int('Use a whole number of days.').min(30, 'Minimum is 30 days.').max(180, 'Maximum is 180 days.'),
});

export type Settings = z.infer<typeof settingsSchema>;

export const defaultSettings: Settings = {
  organizationName: 'NextCrest',
  timezone: 'America/Chicago',
  defaultState: 'TX',
  contactIntervalDays: 7,
  maxContacts: 3,
  rehitDays: 90,
};

// Saved in this browser until the database is connected.
const STORAGE_KEY = 'nc-settings';

export function loadSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSettings;
    const parsed = settingsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : defaultSettings;
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: Settings): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}
