import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Timestamp,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import type {
  AnonymousDonor,
  BloodType,
  HealthChatMessage,
  SavedScreeningRecord,
  UserProfile,
  UserRole,
} from '../types';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: Array<{
      providerId?: string | null;
      email?: string | null;
    }>;
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testFirestoreConnection();

function formatTimestamp(val: unknown): string {
  if (val && typeof (val as Timestamp).toDate === 'function') {
    return (val as Timestamp).toDate().toISOString();
  }
  if (typeof val === 'string') return val;
  return new Date().toISOString();
}

export async function loadUserFromFirestore(
  uid: string
): Promise<Partial<Pick<UserProfile, 'displayName' | 'role' | 'bloodType' | 'neighborhood' | 'avatarUrl'>> | null> {
  if (!auth.currentUser || auth.currentUser.uid !== uid) return null;
  const path = `users/${uid}`;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return null;
    const data = snap.data() as {
      displayName?: string;
      role?: UserRole;
      bloodType?: BloodType;
      neighborhood?: string;
      avatarUrl?: string;
    };
    return {
      displayName: data.displayName,
      role: data.role === 'donor' ? 'donor' : data.role === 'recipient' ? 'recipient' : undefined,
      bloodType: data.bloodType,
      neighborhood: data.neighborhood,
      avatarUrl: data.avatarUrl,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function syncUserToFirestore(user: UserProfile): Promise<void> {
  if (!auth.currentUser || auth.currentUser.uid !== user.uid) return;
  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  const avatarFields = user.avatarUrl ? { avatarUrl: user.avatarUrl.slice(0, 500) } : {};
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName.slice(0, 64),
        role: user.role,
        bloodType: user.bloodType,
        neighborhood: user.neighborhood.slice(0, 64),
        ...avatarFields,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        displayName: user.displayName.slice(0, 64),
        role: user.role,
        bloodType: user.bloodType,
        neighborhood: user.neighborhood.slice(0, 64),
        ...avatarFields,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function syncRoleToFirestore(uid: string, role: UserRole): Promise<void> {
  if (!auth.currentUser || auth.currentUser.uid !== uid) return;
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      role,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function syncScreeningToFirestore(
  uid: string,
  screening: SavedScreeningRecord,
  donor?: AnonymousDonor | null
): Promise<void> {
  if (!auth.currentUser || auth.currentUser.uid !== uid) return;
  const screeningPath = `users/${uid}/screenings/${screening.id}`;
  try {
    await setDoc(doc(db, 'users', uid, 'screenings', screening.id), {
      userId: uid,
      bloodType: screening.bloodType,
      neighborhood: screening.neighborhood.slice(0, 64),
      availabilityWindow: screening.availabilityWindow.slice(0, 64),
      status: screening.status,
      summary: screening.summary.slice(0, 500),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, screeningPath);
  }

  if (donor) {
    const donorPath = `donors/${donor.id}`;
    try {
      await setDoc(doc(db, 'donors', donor.id), {
        ownerUid: uid,
        anonymousHandle: donor.anonymousHandle.slice(0, 48),
        bloodType: donor.bloodType,
        lat: donor.approxLocation.lat,
        lng: donor.approxLocation.lng,
        privacyRadiusMeters: donor.privacyRadiusMeters,
        neighborhood: donor.neighborhood.slice(0, 64),
        availabilityWindow: donor.availabilityWindow.slice(0, 64),
        screeningStatus: donor.screeningStatus,
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, donorPath);
    }
  }
}

export async function loadScreeningsFromFirestore(
  uid: string
): Promise<SavedScreeningRecord[]> {
  if (!auth.currentUser || auth.currentUser.uid !== uid) return [];
  const path = `users/${uid}/screenings`;
  try {
    const q = query(collection(db, 'users', uid, 'screenings'), where('userId', '==', uid));
    const snap = await getDocs(q);
    const items: SavedScreeningRecord[] = snap.docs.map((d) => {
      const data = d.data() as {
        bloodType: BloodType;
        neighborhood: string;
        availabilityWindow: string;
        status: SavedScreeningRecord['status'];
        summary: string;
        createdAt: unknown;
      };
      return {
        id: d.id,
        bloodType: data.bloodType || 'B+',
        neighborhood: data.neighborhood || 'Local Zone',
        availabilityWindow: data.availabilityWindow || 'Available today',
        status: data.status || 'eligible',
        summary: data.summary || '',
        answersJson: {
          meetsAgeWeight: 'yes',
          lastDonationRecent: 'never_or_over_56',
          recentIllness: 'no',
          takingMedications: 'no',
          recentProcedure: 'no',
          recentSurgery: 'no',
          bloodCondition: 'no',
        },
        createdAt: formatTimestamp(data.createdAt),
      };
    });
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function syncHealthChatToFirestore(
  uid: string,
  entry: HealthChatMessage
): Promise<void> {
  if (!auth.currentUser || auth.currentUser.uid !== uid) return;
  const path = `users/${uid}/healthChats/${entry.id}`;
  try {
    await setDoc(doc(db, 'users', uid, 'healthChats', entry.id), {
      userId: uid,
      role: entry.role,
      text: entry.text.slice(0, 4000),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function loadHealthChatsFromFirestore(
  uid: string
): Promise<HealthChatMessage[]> {
  if (!auth.currentUser || auth.currentUser.uid !== uid) return [];
  const path = `users/${uid}/healthChats`;
  try {
    const q = query(collection(db, 'users', uid, 'healthChats'), where('userId', '==', uid));
    const snap = await getDocs(q);
    const items: HealthChatMessage[] = snap.docs.map((d) => {
      const data = d.data() as {
        role: 'user' | 'assistant';
        text: string;
        createdAt: unknown;
      };
      return {
        id: d.id,
        role: data.role === 'assistant' ? 'assistant' : 'user',
        text: data.text || '',
        createdAt: formatTimestamp(data.createdAt),
      };
    });
    return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}
