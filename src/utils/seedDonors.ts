import type { AnonymousDonor, ChatThread, UrgentRequest } from '../types.ts';
import { fuzzCoordinates } from './bloodLogic.ts';

export const DEFAULT_CENTER = { lat: 37.7749, lng: -122.4194 };

export function createInitialDonors(): AnonymousDonor[] {
  const raw: Array<Omit<AnonymousDonor, 'approxLocation'> & { rawLat: number; rawLng: number }> = [
    {
      id: 'donor-bp-01',
      anonymousHandle: 'Donor #BP-402',
      bloodType: 'B+',
      rawLat: 37.7812,
      rawLng: -122.4118,
      privacyRadiusMeters: 750,
      neighborhood: 'Civic Center / Tenderloin Zone',
      availabilityWindow: 'Available now (within 30m)',
      screeningStatus: 'verified',
      donationCount: 9,
      lastActiveMinutesAgo: 3,
    },
    {
      id: 'donor-bp-02',
      anonymousHandle: 'Donor #BP-118',
      bloodType: 'B+',
      rawLat: 37.7615,
      rawLng: -122.4216,
      privacyRadiusMeters: 850,
      neighborhood: 'Mission Dolores Zone',
      availabilityWindow: 'Available today until 9:00 PM',
      screeningStatus: 'verified',
      donationCount: 5,
      lastActiveMinutesAgo: 8,
    },
    {
      id: 'donor-bp-03',
      anonymousHandle: 'Donor #BP-739',
      bloodType: 'B+',
      rawLat: 37.7924,
      rawLng: -122.4352,
      privacyRadiusMeters: 900,
      neighborhood: 'Pacific Heights Zone',
      availabilityWindow: 'Available within 1 hr',
      screeningStatus: 'verified',
      donationCount: 12,
      lastActiveMinutesAgo: 14,
    },
    {
      id: 'donor-bn-01',
      anonymousHandle: 'Donor #BN-204',
      bloodType: 'B-',
      rawLat: 37.7764,
      rawLng: -122.4482,
      privacyRadiusMeters: 800,
      neighborhood: 'USF / Lone Mountain Zone',
      availabilityWindow: 'Available now (within 45m)',
      screeningStatus: 'verified',
      donationCount: 14,
      lastActiveMinutesAgo: 6,
    },
    {
      id: 'donor-on-01',
      anonymousHandle: 'Donor #ON-009',
      bloodType: 'O-',
      rawLat: 37.7689,
      rawLng: -122.4564,
      privacyRadiusMeters: 700,
      neighborhood: 'Inner Sunset / UCSF Zone',
      availabilityWindow: 'Universal donor · Ready today',
      screeningStatus: 'verified',
      donationCount: 21,
      lastActiveMinutesAgo: 2,
    },
    {
      id: 'donor-op-01',
      anonymousHandle: 'Donor #OP-512',
      bloodType: 'O+',
      rawLat: 37.7798,
      rawLng: -122.3948,
      privacyRadiusMeters: 850,
      neighborhood: 'SoMa / South Beach Zone',
      availabilityWindow: 'Available after 5:00 PM',
      screeningStatus: 'verified',
      donationCount: 6,
      lastActiveMinutesAgo: 19,
    },
    {
      id: 'donor-ap-01',
      anonymousHandle: 'Donor #AP-331',
      bloodType: 'A+',
      rawLat: 37.7529,
      rawLng: -122.4139,
      privacyRadiusMeters: 800,
      neighborhood: 'Mission / Bernal North Zone',
      availabilityWindow: 'Available today',
      screeningStatus: 'verified',
      donationCount: 4,
      lastActiveMinutesAgo: 25,
    },
    {
      id: 'donor-abp-01',
      anonymousHandle: 'Donor #ABP-615',
      bloodType: 'AB+',
      rawLat: 37.8012,
      rawLng: -122.4165,
      privacyRadiusMeters: 900,
      neighborhood: 'North Beach / Russian Hill Zone',
      availabilityWindow: 'Platelet & plasma ready',
      screeningStatus: 'verified',
      donationCount: 11,
      lastActiveMinutesAgo: 11,
    },
    {
      id: 'donor-an-01',
      anonymousHandle: 'Donor #AN-807',
      bloodType: 'A-',
      rawLat: 37.7448,
      rawLng: -122.4785,
      privacyRadiusMeters: 950,
      neighborhood: 'Parkside / Sunset Zone',
      availabilityWindow: 'Available tomorrow morning',
      screeningStatus: 'verified',
      donationCount: 8,
      lastActiveMinutesAgo: 32,
    },
  ];

  return raw.map(({ rawLat, rawLng, ...rest }) => ({
    ...rest,
    approxLocation: fuzzCoordinates(rawLat, rawLng, rest.id),
  }));
}

export function createInitialThreads(): ChatThread[] {
  return [
    {
      id: 'thread-bp-402',
      donorId: 'donor-bp-01',
      donorHandle: 'Donor #BP-402',
      bloodType: 'B+',
      neighborhood: 'Civic Center / Tenderloin Zone',
      requestedBloodType: 'B+',
      urgency: 'urgent',
      createdAt: new Date(Date.now() - 1000 * 60 * 14).toISOString(),
      messages: [
        {
          id: 'msg-init-1',
          threadId: 'thread-bp-402',
          senderRole: 'recipient',
          senderLabel: 'Recipient #REQ-19',
          text: 'Hello Donor #BP-402, we have an urgent B+ transfusion request at the Parnassus collection desk. Are you still available within 30 minutes?',
          timestamp: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
        },
        {
          id: 'msg-init-2',
          threadId: 'thread-bp-402',
          senderRole: 'donor',
          senderLabel: 'Donor #BP-402',
          text: 'Yes, I completed my preliminary screening today and am hydrated. Please share the hospital blood bank check-in reference ID when ready.',
          timestamp: new Date(Date.now() - 1000 * 60 * 9).toISOString(),
        },
      ],
    },
  ];
}

export function createInitialUrgentRequests(): UrgentRequest[] {
  return [
    {
      id: 'req-init-1',
      bloodType: 'B+',
      facilityZone: 'UCSF Parnassus Donor Desk',
      unitsNeeded: 2,
      note: 'Scheduled surgical reserve · Accredited hospital blood bank check-in',
      createdAt: new Date(Date.now() - 1000 * 60 * 18).toISOString(),
      location: { lat: 37.7631, lng: -122.4586 },
    },
  ];
}
