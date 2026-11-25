import { keepPreviousData, useQuery } from '@tanstack/react-query';
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
} from '@/services/nextcrestData';

export function useRecordsQuery() {
  return useQuery({ queryKey: ['records'], queryFn: getRecords });
}

// One page of properties. keepPreviousData keeps the old page on screen while the next one loads.
export function usePropertiesQuery(query: PropertyQuery) {
  return useQuery({
    queryKey: ['properties', query],
    queryFn: () => searchProperties(query),
    placeholderData: keepPreviousData,
  });
}

export function useDashboardSummaryQuery() {
  return useQuery({ queryKey: ['dashboard-summary'], queryFn: getDashboardSummary });
}

export function usePropertyFilterOptionsQuery() {
  return useQuery({ queryKey: ['property-filter-options'], queryFn: getPropertyFilterOptions, staleTime: 5 * 60_000 });
}

export function useInboxCountsQuery() {
  return useQuery({ queryKey: ['inbox-counts'], queryFn: getInboxCounts });
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
  return useQuery({ queryKey: ['activity'], queryFn: getActivity });
}
