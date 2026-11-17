import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateDistanceKm,
  detectPiiWarning,
  evaluateScreening,
  filterAndSortDonors,
  formatCleanHealthText,
  fuzzCoordinates,
  generateAnonymousHandle,
  generateAnonymousSenderLabel,
  getCircleBounds,
  getCompatibleDonorTypes,
  getUserInitials,
  sanitizeAvatarUrl,
  toggleUserRole,
  validateCredentials,
} from './bloodLogic';
import type { AnonymousDonor, ScreeningAnswers } from '../types';

test('blood compatibility matrix returns exact and compatible donors for B+', () => {
  assert.deepEqual(getCompatibleDonorTypes('B+', true), ['B+']);
  assert.deepEqual(getCompatibleDonorTypes('B+', false), ['B+', 'B-', 'O+', 'O-']);
  assert.deepEqual(getCompatibleDonorTypes('O-', false), ['O-']);
});

test('fuzzCoordinates offsets coordinates deterministically within privacy band (0.4km–1.1km)', () => {
  const origin = { lat: 37.7749, lng: -122.4194 };
  const f1 = fuzzCoordinates(origin.lat, origin.lng, 'donor-1');
  const f2 = fuzzCoordinates(origin.lat, origin.lng, 'donor-1');
  assert.deepEqual(f1, f2);
  const dist = calculateDistanceKm(origin, f1);
  assert.ok(dist >= 0.4 && dist <= 1.1, `Expected privacy offset between 0.4 and 1.1 km, got ${dist}`);
});

test('filterAndSortDonors prioritizes exact matches and enforces radius and verified status', () => {
  const center = { lat: 37.7749, lng: -122.4194 };
  const donors: AnonymousDonor[] = [
    {
      id: 'd1',
      anonymousHandle: 'Donor #OP-101',
      bloodType: 'O+',
      approxLocation: { lat: 37.776, lng: -122.418 },
      privacyRadiusMeters: 800,
      neighborhood: 'Civic Center Zone',
      availabilityWindow: 'Available today',
      screeningStatus: 'verified',
      donationCount: 4,
      lastActiveMinutesAgo: 5,
    },
    {
      id: 'd2',
      anonymousHandle: 'Donor #BP-102',
      bloodType: 'B+',
      approxLocation: { lat: 37.785, lng: -122.41 },
      privacyRadiusMeters: 800,
      neighborhood: 'Nob Hill Zone',
      availabilityWindow: 'Available in 30m',
      screeningStatus: 'verified',
      donationCount: 7,
      lastActiveMinutesAgo: 2,
    },
    {
      id: 'd3',
      anonymousHandle: 'Donor #BP-103',
      bloodType: 'B+',
      approxLocation: { lat: 37.779, lng: -122.415 },
      privacyRadiusMeters: 800,
      neighborhood: 'SoMa Zone',
      availabilityWindow: 'Pending',
      screeningStatus: 'deferred',
      donationCount: 1,
      lastActiveMinutesAgo: 12,
    },
    {
      id: 'd4',
      anonymousHandle: 'Donor #AP-104',
      bloodType: 'A+',
      approxLocation: { lat: 37.775, lng: -122.42 },
      privacyRadiusMeters: 800,
      neighborhood: 'Mission Zone',
      availabilityWindow: 'Available',
      screeningStatus: 'verified',
      donationCount: 2,
      lastActiveMinutesAgo: 1,
    },
  ];

  const compatible = filterAndSortDonors(donors, center, 'B+', 10, false);
  assert.equal(compatible.length, 2);
  assert.equal(compatible[0].id, 'd2'); // Exact B+ match ranked ahead of closer O+
  assert.equal(compatible[1].id, 'd1');

  const exactOnly = filterAndSortDonors(donors, center, 'B+', 10, true);
  assert.equal(exactOnly.length, 1);
  assert.equal(exactOnly[0].id, 'd2');
});

test('evaluateScreening rejects incomplete questionnaires without silent bypass', () => {
  const partial: ScreeningAnswers = {
    meetsAgeWeight: 'yes',
    lastDonationRecent: '',
    recentIllness: 'no',
    takingMedications: 'no',
    recentProcedure: 'no',
    recentSurgery: 'no',
    bloodCondition: 'no',
  };
  const res = evaluateScreening(partial);
  assert.equal(res.status, 'incomplete');
  assert.deepEqual(res.missingFields, ['lastDonationRecent']);
});

test('evaluateScreening detects temporary deferrals, clinical consults, and full eligibility', () => {
  const baseEligible: ScreeningAnswers = {
    meetsAgeWeight: 'yes',
    lastDonationRecent: 'never_or_over_56',
    recentIllness: 'no',
    takingMedications: 'no',
    recentProcedure: 'no',
    recentSurgery: 'no',
    bloodCondition: 'no',
  };
  assert.equal(evaluateScreening(baseEligible).status, 'eligible');

  const tempDeferred = evaluateScreening({
    ...baseEligible,
    lastDonationRecent: 'within_56_days',
    recentProcedure: 'yes',
  });
  assert.equal(tempDeferred.status, 'temporary_deferral');
  assert.equal(tempDeferred.deferralDays, 90);

  const consult = evaluateScreening({
    ...baseEligible,
    bloodCondition: 'yes',
  });
  assert.equal(consult.status, 'consult_center');
});

test('detectPiiWarning flags phone numbers and emails while allowing safe coordination messages', () => {
  assert.equal(detectPiiWarning('Can you meet at UCSF Donor Center at 3pm?'), null);
  assert.ok(detectPiiWarning('Call me at 415-555-0199'));
  assert.ok(detectPiiWarning('Email me at donor@example.com'));
  assert.equal(generateAnonymousHandle('B+', 42), 'Donor #BP-042');
});

test('toggleUserRole switches between donor and recipient cleanly', () => {
  assert.equal(toggleUserRole('donor'), 'recipient');
  assert.equal(toggleUserRole('recipient'), 'donor');
});

test('generateAnonymousSenderLabel formats role-based anonymous handles', () => {
  assert.equal(generateAnonymousSenderLabel('donor', 15, 'B+'), 'Donor #BP-115');
  assert.equal(generateAnonymousSenderLabel('recipient', 15, 'O-'), 'Recipient #REQ-115');
});

test('validateCredentials rejects invalid emails or short passwords', () => {
  assert.equal(validateCredentials('invalid-email', 'secret123').valid, false);
  assert.equal(validateCredentials('user@raktsetu.org', '123').valid, false);
  assert.equal(validateCredentials('user@raktsetu.org', 'secret123').valid, true);
});

test('getCircleBounds computes symmetric geographic bounds scaling with radiusKm', () => {
  const center = { lat: 37.7749, lng: -122.4194 };
  const small = getCircleBounds(center, 5);
  const large = getCircleBounds(center, 25);
  assert.ok(small.north > center.lat && small.south < center.lat);
  assert.ok(small.east > center.lng && small.west < center.lng);
  assert.ok(large.north - large.south > small.north - small.south);
  assert.ok(large.east - large.west > small.east - small.west);
});

test('getUserInitials and sanitizeAvatarUrl safely normalize profile thumbnails', () => {
  assert.equal(getUserInitials('Aarav Sharma', 'aarav@example.com'), 'AS');
  assert.equal(getUserInitials('', 'donor@raktsetu.org'), 'DO');
  assert.equal(sanitizeAvatarUrl('https://example.com/pic.png'), 'https://example.com/pic.png');
  assert.equal(sanitizeAvatarUrl('javascript:alert(1)'), undefined);
  assert.equal(sanitizeAvatarUrl('   '), undefined);
});

test('formatCleanHealthText removes raw markdown asterisks and heading hashes', () => {
  const raw = '### **Direct Answer**\n**Hydrate** well before donating.';
  assert.equal(formatCleanHealthText(raw), 'Direct Answer\nHydrate well before donating.');
});


