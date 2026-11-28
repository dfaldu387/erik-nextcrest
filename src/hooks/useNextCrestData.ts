import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useAccountScope } from '@/lib/accountScope';
import { DASHBOARD_STALE_MS } from '@/lib/queryClient';
import { getTouchSummaryMap } from '@/services/followUpEngine';
import { getAccountPropertyIds, getLeadGroups, getMarketingSplit, getPropertyFacts, getPropertyLabels, listConversationNotes } from '@/services/nextcrestData';
import {
  getActivity,
  getDashboardSummary,
  getInboxCounts,
  getConversationMessages,
  getInboxFilterOptions,
  getPropertySummaries,
  getMarkets,
  getPropertyFilterOptions,
  getRecords,
  listInbox,
  type InboxQuery,
  type PropertyQuery,
  searchProperties,
  getSuppressedPhones,
} from '@/services/nextcrestData';

export function useRecordsQuery() {
  return useQuery({ queryKey: ['records'], queryFn: getRecords });
}

// SmarterContact labels of the given properties (their linked conversations). Used by the Properties table.
export function usePropertyLabelsQuery(ids: string[]) {
  const key = [...ids].sort().join(',');
  return useQuery({
    queryKey: ['property-labels', key],
    queryFn: () => getPropertyLabels(ids),
    enabled: ids.length > 0,
    placeholderData: keepPreviousData,
  });
}

// Property ids linked to the account chosen in the top bar. Not loaded when no account is chosen.
export function useAccountPropertyIds(accountId: string | null) {
  return useQuery({
    queryKey: ['account-property-ids', accountId],
    queryFn: () => getAccountPropertyIds(accountId as string),
    enabled: accountId !== null,
    staleTime: DASHBOARD_STALE_MS,
  });
}

// The records of the account chosen in the top bar. With no account chosen, every record. Same shape as useRecordsQuery.
export function useScopedRecords() {
  const { accountId } = useAccountScope();
  const records = useRecordsQuery();
  const ids = useAccountPropertyIds(accountId);
  const scoped = useMemo(() => {
    if (!records.data || !accountId) return records.data;
    if (!ids.data) return undefined;
    const allowed = ids.data;
    return { ...records.data, data: records.data.data.filter((r) => allowed.has(r.id)) };
  }, [records.data, ids.data, accountId]);
  return {
    data: scoped,
    isPending: records.isPending || (accountId !== null && ids.isPending),
    isError: records.isError || ids.isError,
    refetch: () => {
      void records.refetch();
      if (accountId) void ids.refetch();
    },
  };
}

// Phones that exports must leave out (opted out in SmarterContact, or on the suppression list). Exports wait for it.
export function useSuppressedPhonesQuery() {
  return useQuery({ queryKey: ['suppressed-phones'], queryFn: getSuppressedPhones, staleTime: 5 * 60_000 });
}

// One page of properties. keepPreviousData keeps the old page on screen while the next one loads.
export function usePropertiesQuery(query: PropertyQuery) {
  return useQuery({
    queryKey: ['properties', query],
    queryFn: () => searchProperties(query),
    placeholderData: keepPreviousData,
  });
}

export function useMarketingSplitQuery() {
  return useQuery({ queryKey: ['marketing-split'], queryFn: getMarketingSplit, staleTime: DASHBOARD_STALE_MS });
}

export function useLeadGroupsQuery() {
  return useQuery({ queryKey: ['lead-groups'], queryFn: getLeadGroups, staleTime: DASHBOARD_STALE_MS });
}

export function useDashboardSummaryQuery() {
  return useQuery({ queryKey: ['dashboard-summary'], queryFn: getDashboardSummary, staleTime: DASHBOARD_STALE_MS });
}

export function usePropertyFilterOptionsQuery() {
  return useQuery({ queryKey: ['property-filter-options'], queryFn: getPropertyFilterOptions, staleTime: 5 * 60_000 });
}

export function useTouchSummariesQuery() {
  return useQuery({ queryKey: ['touch-summaries'], queryFn: getTouchSummaryMap, staleTime: DASHBOARD_STALE_MS });
}

export function useInboxCountsQuery(accountId: string | null = null) {
  return useQuery({ queryKey: ['inbox-counts', accountId], queryFn: () => getInboxCounts(accountId) });
}

export function usePropertySummariesQuery(ids: string[]) {
  return useQuery({
    queryKey: ['property-summaries', [...ids].sort().join(',')],
    queryFn: () => getPropertySummaries(ids),
    enabled: ids.length > 0,
  });
}

export function useConversationMessagesQuery(contactId: string | null) {
  return useQuery({
    queryKey: ['inbox-messages', contactId],
    queryFn: () => getConversationMessages(contactId as string),
    enabled: contactId !== null,
  });
}

export function useInboxFilterOptionsQuery() {
  return useQuery({ queryKey: ['inbox-filter-options'], queryFn: getInboxFilterOptions, staleTime: 5 * 60_000 });
}

export function useInboxQuery(query: InboxQuery) {
  return useQuery({
    queryKey: ['inbox', query],
    queryFn: () => listInbox(query),
    placeholderData: keepPreviousData,
  });
}

export function useMarketsQuery() {
  return useQuery({ queryKey: ['markets'], queryFn: getMarkets });
}

export function useActivityQuery() {
  return useQuery({ queryKey: ['activity'], queryFn: getActivity, staleTime: DASHBOARD_STALE_MS });
}

export function useConversationNotesQuery(contactId: string) {
  return useQuery({ queryKey: ['conversation-notes', contactId], queryFn: () => listConversationNotes(contactId), enabled: contactId !== '' });
}

export function usePropertyFactsQuery(propertyId: string | null) {
  return useQuery({ queryKey: ['property-facts', propertyId], queryFn: () => getPropertyFacts(propertyId as string), enabled: Boolean(propertyId) });
}
