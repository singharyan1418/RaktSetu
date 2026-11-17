export type BloodType = 'O-' | 'O+' | 'A-' | 'A+' | 'B-' | 'B+' | 'AB-' | 'AB+';
export type UserRole = 'donor' | 'recipient';

export interface LatLng {
  lat: number;
  lng: number;
}

export type ScreeningStatus = 'verified' | 'pending' | 'deferred';

export interface UserProfile {
  id: number;
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  bloodType: BloodType;
  neighborhood: string;
  authProvider: 'email' | 'google';
  avatarUrl?: string;
}

export interface SavedScreeningRecord {
  id: string;
  bloodType: BloodType;
  neighborhood: string;
  availabilityWindow: string;
  status: 'eligible' | 'temporary_deferral' | 'consult_center';
  summary: string;
  answersJson: ScreeningAnswers;
  createdAt: string;
}

export interface AnonymousDonor {
  id: string;
  ownerUserId?: number | null;
  anonymousHandle: string;
  bloodType: BloodType;
  /** Approximate privacy-blurred coordinates (never exact home address) */
  approxLocation: LatLng;
  privacyRadiusMeters: number;
  neighborhood: string;
  availabilityWindow: string;
  screeningStatus: ScreeningStatus;
  donationCount: number;
  lastActiveMinutesAgo: number;
  distanceKm?: number;
  isExactMatch?: boolean;
}

export interface PaymentReceipt {
  transactionId: string;
  donorId: string;
  donorHandle: string;
  bloodType: BloodType;
  amountInr: number;
  paymentMethod: string;
  paymentDetails?: string;
  paidAt: string;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  senderRole: 'recipient' | 'donor';
  senderLabel: string;
  senderUserId?: number | null;
  text: string;
  timestamp: string;
}

export interface ChatThread {
  id: string;
  donorId: string;
  donorHandle: string;
  bloodType: BloodType;
  neighborhood: string;
  requestedBloodType: BloodType;
  urgency: 'routine' | 'urgent';
  createdAt: string;
  messages: ChatMessage[];
}

export interface UrgentRequest {
  id: string;
  bloodType: BloodType;
  facilityZone: string;
  unitsNeeded: number;
  note: string;
  createdAt: string;
  location: LatLng;
}

export interface ScreeningAnswers {
  meetsAgeWeight: 'yes' | 'no' | '';
  lastDonationRecent: 'never_or_over_56' | 'within_56_days' | '';
  recentIllness: 'no' | 'yes' | '';
  takingMedications: 'no' | 'yes' | '';
  recentProcedure: 'no' | 'yes' | '';
  recentSurgery: 'no' | 'yes' | '';
  bloodCondition: 'no' | 'yes' | '';
}

export interface ScreeningEvaluation {
  status: 'eligible' | 'temporary_deferral' | 'consult_center' | 'incomplete';
  title: string;
  summary: string;
  reasons: string[];
  deferralDays?: number;
  missingFields: string[];
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface HealthChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
}

export interface GmailSummary {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
}

export interface GoogleChatSpace {
  name: string;
  displayName: string;
  spaceType?: string;
}

export interface GoogleChatMessageItem {
  name: string;
  text: string;
  createTime?: string;
  sender?: {
    name?: string;
    displayName?: string;
    type?: string;
  };
}
