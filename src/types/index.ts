// User & Auth Types
export type UserRole = 'owner' | 'admin' | 'data_manager' | 'marketing_user' | 'read_only';

export interface User {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

// Property Types
export interface Property {
  id: string;
  createdAt: string;
  updatedAt: string;

  // Identification
  internalId: string;
  source: string;
  originalSourceId?: string;

  // Location
  state: string;
  county?: string;
  city?: string;
  zipCode?: string;
  address?: string;
  latitude?: number;
  longitude?: number;

  // Details
  acreage?: number;
  propertyType?: string;
  landUse?: string;
  zoning?: string;
  propertyStatus?: string;
  legalDescription?: string;
  assessedValue?: number;
  marketValue?: number;
  yearBuilt?: number;

  // Owner
  ownerName?: string;
  ownerType?: string;
  mailingAddress?: string;
  mailingCity?: string;
  mailingState?: string;
  mailingZip?: string;

  // Marketing
  totalContacts: number;
  lastContactedAt?: string;
  nextContactEligibleAt?: string;
  marketingStatus: 'never_contacted' | 'contacted' | 'follow_up_due' | 'responded' | 'opted_out' | 'wrong_number';

  // System
  firstAcquiredAt?: string;
  lastUpdatedByImportAt?: string;
  importBatchId?: string;
  recordQualityScore?: number;
}

export interface PropertyIdentifier {
  id: string;
  propertyId: string;
  identifierType: string;
  identifierValue: string;
  normalizedValue?: string;
  source?: string;
  createdAt: string;
}

export interface PropertyOwner {
  id: string;
  propertyId: string;

  // Individual
  firstName?: string;
  lastName?: string;

  // Business
  companyName?: string;
  businessType?: string;

  // Contact
  phoneNumbers?: string[];
  emailAddresses?: string[];

  ownerSequence?: number;
  createdAt: string;
  updatedAt: string;
}

// Data Purchase Types
export interface DataPurchase {
  id: string;
  createdAt: string;

  datasetName: string;
  sourceProvider: string;

  // Filters
  filterStates?: string[];
  filterCounties?: string[];
  filterCities?: string[];
  filterZips?: string[];
  acreageMin?: number;
  acreageMax?: number;
  ownershipDurationYears?: number;
  customFilters?: Record<string, any>;

  // Results
  originalRecordCount: number;
  importedRecordCount: number;
  duplicateCount: number;
  newPropertyCount: number;

  // Metadata
  purchaseDate: string;
  cost?: number;
  purchasedBy: string;
  importStatus: 'pending' | 'processing' | 'completed' | 'failed';
  sourceFileUrl?: string;
  apiAcquisitionId?: string;
  notes?: string;
}

// Import Types
export interface ImportJob {
  id: string;
  createdAt: string;
  updatedAt: string;

  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  sourceFileName: string;
  sourceFileUrl?: string;
  dataPurchaseId?: string;

  totalRows: number;
  rowsProcessed: number;
  rowsInserted: number;
  rowsUpdated: number;
  rowsSkipped: number;
  rowsFailed: number;

  startedAt?: string;
  completedAt?: string;

  createdBy: string;

  fieldMapping: Record<string, any>;
  importOptions?: Record<string, any>;
}

export interface FieldMapping {
  sourceField: string;
  targetField: string;
  transformer?: string;
  required?: boolean;
}

// Campaign & Marketing Types
export interface Campaign {
  id: string;
  createdAt: string;
  updatedAt: string;

  name: string;
  description?: string;
  source: string;
  sourceId?: string;

  status: 'draft' | 'active' | 'paused' | 'completed';
  createdBy: string;
  metadata?: Record<string, any>;
}

export interface CampaignContact {
  id: string;
  createdAt: string;

  campaignId: string;
  propertyId?: string;

  phoneNumber: string;
  contactSequence?: number;
}

export interface MarketingEvent {
  id: string;
  createdAt: string;

  propertyId: string;
  campaignId?: string;

  eventType: 'message_sent' | 'message_delivered' | 'reply_received' | 'opt_out' | 'wrong_number' | 'other';
  eventDate: string;
  phoneNumber?: string;

  messageReference?: string;
  messageStatus?: string;

  sourcePlatform: string;
  rawSourceData?: Record<string, any>;

  processedAt?: string;
}

// Duplicate Detection Types
export interface DuplicateCandidate {
  id: string;
  createdAt: string;

  propertyId1: string;
  propertyId2: string;

  matchLevel: 1 | 2 | 3;
  matchScore: number;
  matchReasons: string[];
}

export interface DuplicateReview {
  id: string;
  createdAt: string;

  duplicateCandidateId: string;

  reviewedBy: string;
  decision: 'confirmed' | 'rejected' | 'manual_review';
  reviewedAt?: string;
  notes?: string;
}

// Follow-up Types
export interface FollowUpTask {
  id: string;
  createdAt: string;
  updatedAt: string;

  propertyId: string;

  followUpStage: number;
  eligibilityReason?: string;
  exclusionReason?: string;

  nextContactDate?: string;
  lastContactDate?: string;
  contactCount: number;

  status: 'due' | 'upcoming' | 'completed' | 'paused' | 'excluded';
  assignedTo?: string;

  notes?: string;
}

// Suppression Types
export interface OptOut {
  id: string;
  createdAt: string;

  phoneNumber: string;
  propertyId?: string;

  optOutDate: string;
  source: string;
  campaignId?: string;

  reason?: string;
  originalEventId?: string;

  imported: boolean;
  importedBy?: string;
}

export interface WrongNumber {
  id: string;
  createdAt: string;

  phoneNumber: string;
  propertyId?: string;

  wrongNumberDate: string;
  source: string;
  sourceEventId?: string;
  reason?: string;

  createdBy?: string;

  correctedPhoneNumber?: string;
  correctedAt?: string;
}

// List & Filter Types
export interface SavedList {
  id: string;
  createdAt: string;
  updatedAt: string;

  name: string;
  description?: string;

  filters: FilterDefinition;

  isDynamic: boolean;
  recordCount: number;

  createdBy: string;

  campaignHistory?: Record<string, any>;
}

export interface FilterDefinition {
  states?: string[];
  counties?: string[];
  cities?: string[];
  zips?: string[];
  acreageRange?: [number, number];
  apns?: string[];
  owners?: string[];
  ownerType?: string;
  purchaseDateRange?: [string, string];
  datasets?: string[];
  contactCount?: [number, number];
  lastContactedDate?: string;
  nextContactDate?: string;
  marketingStatus?: string[];
  responseStatus?: string[];
  duplicateStatus?: string;
  propertyDataQuality?: [number, number];
  customFilters?: Record<string, any>;
  logic?: 'AND' | 'OR';
}

// API Response Types
export interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
