import type {
  AnonymousDonor,
  BloodType,
  LatLng,
  ScreeningAnswers,
  ScreeningEvaluation,
  UserRole,
} from '../types';

export const ALL_BLOOD_TYPES: BloodType[] = [
  'B+',
  'B-',
  'O+',
  'O-',
  'A+',
  'A-',
  'AB+',
  'AB-',
];

/**
 * Red blood cell (RBC) compatibility matrix:
 * maps recipient blood type -> compatible donor blood types in priority order.
 */
const RBC_COMPATIBILITY: Record<BloodType, BloodType[]> = {
  'O-': ['O-'],
  'O+': ['O+', 'O-'],
  'A-': ['A-', 'O-'],
  'A+': ['A+', 'A-', 'O+', 'O-'],
  'B-': ['B-', 'O-'],
  'B+': ['B+', 'B-', 'O+', 'O-'],
  'AB-': ['AB-', 'A-', 'B-', 'O-'],
  'AB+': ['AB+', 'AB-', 'A+', 'A-', 'B+', 'B-', 'O+', 'O-'],
};

export function getCompatibleDonorTypes(
  recipientType: BloodType,
  exactOnly = false
): BloodType[] {
  if (exactOnly) {
    return [recipientType];
  }
  return RBC_COMPATIBILITY[recipientType] ?? [recipientType];
}

export function isCompatibleDonor(
  recipientType: BloodType,
  donorType: BloodType,
  exactOnly = false
): boolean {
  return getCompatibleDonorTypes(recipientType, exactOnly).includes(donorType);
}

/**
 * Haversine distance in kilometers between two coordinates.
 */
export function calculateDistanceKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return Math.round(R * c * 10) / 10;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Deterministically offsets donor coordinates by ~450m–950m so exact street
 * addresses are never exposed on the map while keeping proximity accurate.
 */
export function fuzzCoordinates(lat: number, lng: number, seed: string): LatLng {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const normalizedA = ((hash >>> 0) % 1000) / 1000;
  const normalizedB = (((hash >>> 10) ^ hash) >>> 0) % 1000 / 1000;

  const angle = normalizedA * Math.PI * 2;
  const distanceKm = 0.45 + normalizedB * 0.5;
  const latDelta = (distanceKm * Math.cos(angle)) / 111.32;
  const lngDelta =
    (distanceKm * Math.sin(angle)) /
    (111.32 * Math.max(0.2, Math.cos(toRad(lat))));

  return {
    lat: Number((lat + latDelta).toFixed(5)),
    lng: Number((lng + lngDelta).toFixed(5)),
  };
}

/**
 * Computes the geographic bounding box around a center point for a given radius in km.
 */
export function getCircleBounds(
  center: LatLng,
  radiusKm: number
): { north: number; south: number; east: number; west: number } {
  const safeRadiusKm = Math.max(0.5, Math.min(200, radiusKm));
  const latDelta = safeRadiusKm / 111.32;
  const lngDelta =
    safeRadiusKm / (111.32 * Math.max(0.2, Math.cos(toRad(center.lat))));

  return {
    north: Math.min(85, center.lat + latDelta),
    south: Math.max(-85, center.lat - latDelta),
    east: center.lng + lngDelta,
    west: center.lng - lngDelta,
  };
}

export function filterAndSortDonors(
  donors: AnonymousDonor[],
  userCenter: LatLng,
  recipientType: BloodType,
  maxRadiusKm: number,
  exactOnly = false
): AnonymousDonor[] {
  const compatible = getCompatibleDonorTypes(recipientType, exactOnly);

  return donors
    .filter((donor) => donor.screeningStatus === 'verified')
    .filter((donor) => compatible.includes(donor.bloodType))
    .map((donor) => {
      const distanceKm = calculateDistanceKm(userCenter, donor.approxLocation);
      return {
        ...donor,
        distanceKm,
        isExactMatch: donor.bloodType === recipientType,
      };
    })
    .filter((donor) => (donor.distanceKm ?? Infinity) <= maxRadiusKm)
    .sort((a, b) => {
      if (a.isExactMatch !== b.isExactMatch) {
        return a.isExactMatch ? -1 : 1;
      }
      return (a.distanceKm ?? 0) - (b.distanceKm ?? 0);
    });
}

const QUESTION_LABELS: Record<keyof ScreeningAnswers, string> = {
  meetsAgeWeight: 'Age and weight threshold',
  lastDonationRecent: 'Time since last donation',
  recentIllness: 'Recent fever or respiratory illness',
  takingMedications: 'Current antibiotics or blood thinners',
  recentProcedure: 'Recent tattoo, piercing, or dental work',
  recentSurgery: 'Recent major surgery or transfusion',
  bloodCondition: 'Anemia or blood-borne condition history',
};

export function evaluateScreening(answers: ScreeningAnswers): ScreeningEvaluation {
  const missingFields = (Object.keys(QUESTION_LABELS) as Array<keyof ScreeningAnswers>).filter(
    (key) => !answers[key]
  );

  if (missingFields.length > 0) {
    return {
      status: 'incomplete',
      title: 'Questionnaire Incomplete',
      summary: 'Please answer every preliminary screening question before submitting.',
      reasons: missingFields.map((field) => `Missing response: ${QUESTION_LABELS[field]}`),
      missingFields,
    };
  }

  const consultReasons: string[] = [];
  const tempDeferralReasons: string[] = [];
  let maxDeferralDays = 0;

  if (answers.meetsAgeWeight === 'no') {
    consultReasons.push(
      'Donors typically must be at least 18 years old (or 16-17 with consent in some regions) and weigh at least 50 kg (110 lbs).'
    );
  }

  if (answers.bloodCondition === 'yes') {
    consultReasons.push(
      'Reported history of anemia, low hemoglobin, or a chronic blood condition requires in-person clinical evaluation by a blood center physician.'
    );
  }

  if (answers.lastDonationRecent === 'within_56_days') {
    tempDeferralReasons.push(
      'Whole blood donations require at least 56 days (8 weeks) between donations to replenish iron stores.'
    );
    maxDeferralDays = Math.max(maxDeferralDays, 56);
  }

  if (answers.recentIllness === 'yes') {
    tempDeferralReasons.push(
      'Wait until you have been completely symptom-free and fever-free for at least 14 days before donating.'
    );
    maxDeferralDays = Math.max(maxDeferralDays, 14);
  }

  if (answers.takingMedications === 'yes') {
    tempDeferralReasons.push(
      'Active courses of antibiotics or anticoagulant medications require a temporary deferral until cleared by a screening nurse.'
    );
    maxDeferralDays = Math.max(maxDeferralDays, 14);
  }

  if (answers.recentProcedure === 'yes') {
    tempDeferralReasons.push(
      'Recent tattoos, piercings, or invasive dental procedures typically carry a 90-day waiting window unless verified under sterile licensing rules.'
    );
    maxDeferralDays = Math.max(maxDeferralDays, 90);
  }

  if (answers.recentSurgery === 'yes') {
    tempDeferralReasons.push(
      'Major surgery or receiving a blood transfusion carries a temporary deferral (often 6 months) to protect donor recovery and recipient safety.'
    );
    maxDeferralDays = Math.max(maxDeferralDays, 180);
  }

  if (consultReasons.length > 0) {
    return {
      status: 'consult_center',
      title: 'Clinical Center Review Required',
      summary:
        'Based on your self-reported responses, please consult a licensed blood collection center directly before registering as an active donor.',
      reasons: [...consultReasons, ...tempDeferralReasons],
      missingFields: [],
    };
  }

  if (tempDeferralReasons.length > 0) {
    return {
      status: 'temporary_deferral',
      title: 'Temporary Deferral Recommended',
      summary: `You may become eligible after an estimated ${maxDeferralDays}-day waiting period. A blood bank nurse will confirm final eligibility on site.`,
      reasons: tempDeferralReasons,
      deferralDays: maxDeferralDays,
      missingFields: [],
    };
  }

  return {
    status: 'eligible',
    title: 'Preliminary Screening Passed',
    summary:
      'Your self-reported answers meet initial pre-donation guidelines. Final hemoglobin, blood pressure, and medical clearance occur at the collection center.',
    reasons: [
      'No recent infection, fever, or antibiotic deferral flags reported.',
      'Donation interval, procedure window, and baseline readiness criteria met.',
    ],
    missingFields: [],
  };
}

/**
 * Checks whether a chat message accidentally includes PII (email, phone number, or street address cue)
 * so the UI can warn the user before exposing personal identity.
 */
export function detectPiiWarning(text: string): string | null {
  const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const phoneRegex = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/;
  if (emailRegex.test(text)) {
    return 'Avoid sharing personal email addresses to protect donor anonymity.';
  }
  if (phoneRegex.test(text)) {
    return 'Avoid sharing phone numbers here; coordinate via an accredited hospital blood bank desk instead.';
  }
  return null;
}

export function generateAnonymousHandle(bloodType: BloodType, suffixNumber: number): string {
  const cleanType = bloodType.replace('+', 'P').replace('-', 'N');
  return `Donor #${cleanType}-${String(suffixNumber).padStart(3, '0')}`;
}

export function generateAnonymousSenderLabel(role: UserRole, userId: number, bloodType: BloodType): string {
  const cleanType = bloodType.replace('+', 'P').replace('-', 'N');
  const code = String(100 + (userId % 900)).padStart(3, '0');
  return role === 'donor' ? `Donor #${cleanType}-${code}` : `Recipient #REQ-${code}`;
}

export function toggleUserRole(role: UserRole): UserRole {
  return role === 'donor' ? 'recipient' : 'donor';
}

export function validateCredentials(
  email: string,
  password: string
): { valid: boolean; error?: string } {
  const trimmedEmail = email.trim().toLowerCase();
  if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    return { valid: false, error: 'Please enter a valid email address.' };
  }
  if (!password || password.length < 6) {
    return { valid: false, error: 'Password must be at least 6 characters.' };
  }
  return { valid: true };
}

export function getUserInitials(displayName?: string, email?: string): string {
  const source = (displayName || '').trim() || (email || '').split('@')[0] || 'RS';
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export function sanitizeAvatarUrl(rawUrl?: string | null): string | undefined {
  if (!rawUrl) return undefined;
  const trimmed = rawUrl.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > 500) return undefined;
  if (/^https?:\/\/\S+$/i.test(trimmed)) {
    return trimmed;
  }
  if (/^data:image\/(?:png|jpeg|jpg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/i.test(trimmed)) {
    return trimmed;
  }
  return undefined;
}

export function formatCleanHealthText(raw: string): string {
  return raw
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .trim();
}

