import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { desc, eq, asc, gt, and } from 'drizzle-orm';
import { db } from './index.ts';
import {
  aiHealthMessages,
  donorChatUnlocks,
  donors,
  messages,
  screenings,
  threads,
  urgentRequests,
  userSessions,
  users,
} from './schema.ts';
import type {
  AnonymousDonor,
  BloodType,
  ChatMessage,
  ChatThread,
  HealthChatMessage,
  LatLng,
  PaymentReceipt,
  SavedScreeningRecord,
  ScreeningAnswers,
  ScreeningEvaluation,
  UrgentRequest,
  UserProfile,
  UserRole,
} from '../types.ts';
import {
  calculateDistanceKm,
  fuzzCoordinates,
  generateAnonymousHandle,
  sanitizeAvatarUrl,
} from '../utils/bloodLogic.ts';
import {
  createInitialDonors,
  createInitialThreads,
  createInitialUrgentRequests,
} from '../utils/seedDonors.ts';

function isSqlAvailable(): boolean {
  const sqlHost = process.env.SQL_HOST;
  if (!sqlHost || !process.env.SQL_DB_NAME || !process.env.SQL_USER) {
    return false;
  }
  if (sqlHost.startsWith('/')) {
    try {
      return fs.existsSync(path.join(sqlHost, '.s.PGSQL.5432'));
    } catch {
      return false;
    }
  }
  return true;
}

interface StoredUser {
  id: number;
  uid: string;
  email: string;
  passwordHash: string | null;
  displayName: string;
  role: UserRole;
  bloodType: BloodType;
  neighborhood: string;
  authProvider: 'email' | 'google';
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
}

interface StoredSession {
  token: string;
  userId: number;
  expiresAt: string;
}

interface StoredScreening extends SavedScreeningRecord {
  userId: number;
}

interface StoredHealthMsg extends HealthChatMessage {
  userId: number;
}

interface StoredDonorUnlock {
  transactionId: string;
  userId: number;
  donorId: string;
  amountInr: number;
  paymentMethod: string;
  paymentDetails?: string;
  paidAt: string;
}

interface DurableStoreData {
  nextUserId: number;
  users: StoredUser[];
  sessions: StoredSession[];
  revokedTokenJtis: string[];
  screenings: StoredScreening[];
  donors: AnonymousDonor[];
  threads: ChatThread[];
  urgentRequests: UrgentRequest[];
  aiHealthMessages: StoredHealthMsg[];
  unlockedDonors: StoredDonorUnlock[];
}

let memoryStore: DurableStoreData | null = null;
let storeFilePath: string | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function resolveWritableStorePath(): string {
  if (storeFilePath) return storeFilePath;
  const primaryDir = path.join(process.cwd(), 'data');
  try {
    fs.mkdirSync(primaryDir, { recursive: true });
    const testPath = path.join(primaryDir, 'raktsetu-store.json');
    if (fs.existsSync(testPath)) {
      fs.accessSync(testPath, fs.constants.R_OK | fs.constants.W_OK);
    } else {
      fs.accessSync(primaryDir, fs.constants.W_OK);
    }
    storeFilePath = testPath;
    return storeFilePath;
  } catch {
    const tmpPath = path.join(os.tmpdir(), 'raktsetu-store.json');
    storeFilePath = tmpPath;
    return storeFilePath;
  }
}

function buildSeedStore(): DurableStoreData {
  const initialThreads = createInitialThreads();
  initialThreads.push({
    id: 'thread-community-relay',
    donorId: 'community-desk',
    donorHandle: 'RaktSetu Relay Room',
    bloodType: 'B+',
    neighborhood: 'All Accredited Zones',
    requestedBloodType: 'B+',
    urgency: 'routine',
    createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
    messages: [
      {
        id: 'msg-community-1',
        threadId: 'thread-community-relay',
        senderRole: 'donor',
        senderLabel: 'Donor #BP-402',
        text: 'Welcome to the live RaktSetu Relay Room. Recipients and Donors connected in real time can coordinate hospital desk check-ins here.',
        timestamp: new Date(Date.now() - 1000 * 60 * 25).toISOString(),
      },
    ],
  });

  return {
    nextUserId: 1,
    users: [],
    sessions: [],
    revokedTokenJtis: [],
    screenings: [],
    donors: createInitialDonors(),
    threads: initialThreads,
    urgentRequests: createInitialUrgentRequests(),
    aiHealthMessages: [],
    unlockedDonors: [],
  };
}

function loadStore(): DurableStoreData {
  if (memoryStore) return memoryStore;
  const target = resolveWritableStorePath();
  if (fs.existsSync(target)) {
    try {
      const raw = fs.readFileSync(target, 'utf8');
      const parsed = JSON.parse(raw) as Partial<DurableStoreData>;
      const seed = buildSeedStore();
      memoryStore = {
        nextUserId: parsed.nextUserId || 1,
        users: Array.isArray(parsed.users) ? parsed.users : [],
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
        revokedTokenJtis: Array.isArray(parsed.revokedTokenJtis)
          ? parsed.revokedTokenJtis
          : [],
        screenings: Array.isArray(parsed.screenings) ? parsed.screenings : [],
        donors: Array.isArray(parsed.donors) && parsed.donors.length > 0 ? parsed.donors : seed.donors,
        threads: Array.isArray(parsed.threads) && parsed.threads.length > 0 ? parsed.threads : seed.threads,
        urgentRequests: Array.isArray(parsed.urgentRequests) ? parsed.urgentRequests : seed.urgentRequests,
        aiHealthMessages: Array.isArray(parsed.aiHealthMessages) ? parsed.aiHealthMessages : [],
        unlockedDonors: Array.isArray(parsed.unlockedDonors) ? parsed.unlockedDonors : [],
      };
      return memoryStore;
    } catch {
      // Fall through to clean seed
    }
  }
  memoryStore = buildSeedStore();
  void persistStore(memoryStore);
  return memoryStore;
}

function persistStore(store: DurableStoreData): Promise<void> {
  const target = resolveWritableStorePath();
  const payload = JSON.stringify(store, null, 2);
  writeQueue = writeQueue
    .then(async () => {
      await fs.promises.writeFile(target, payload, 'utf8');
    })
    .catch((err) => {
      console.error('Store persist warning:', err);
    });
  return writeQueue;
}

function toUserProfile(u: StoredUser): UserProfile {
  return {
    id: u.id,
    uid: u.uid,
    email: u.email,
    displayName: u.displayName,
    role: u.role === 'donor' ? 'donor' : 'recipient',
    bloodType: u.bloodType || 'B+',
    neighborhood: u.neighborhood || 'Local Zone',
    authProvider: u.authProvider === 'google' ? 'google' : 'email',
    avatarUrl: sanitizeAvatarUrl(u.avatarUrl),
  };
}

let seedPromise: Promise<void> | null = null;

function mapUserRow(row: typeof users.$inferSelect): UserProfile {
  return {
    id: row.id,
    uid: row.uid,
    email: row.email,
    displayName: row.displayName,
    role: row.role === 'donor' ? 'donor' : 'recipient',
    bloodType: (row.bloodType as BloodType) || 'B+',
    neighborhood: row.neighborhood || 'Local Zone',
    authProvider: row.authProvider === 'google' ? 'google' : 'email',
    avatarUrl: sanitizeAvatarUrl(row.avatarUrl),
  };
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derived = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derived.length) return false;
  return crypto.timingSafeEqual(keyBuf, derived);
}

export async function ensureSeededData(): Promise<void> {
  if (!isSqlAvailable()) {
    loadStore();
    return;
  }
  if (seedPromise) return seedPromise;
  seedPromise = (async () => {
    try {
      const existing = await db.select({ id: donors.id }).from(donors).limit(1);
      if (existing.length > 0) return;

      const initialDonors = createInitialDonors();
      for (const d of initialDonors) {
        await db
          .insert(donors)
          .values({
            id: d.id,
            anonymousHandle: d.anonymousHandle,
            bloodType: d.bloodType,
            lat: d.approxLocation.lat,
            lng: d.approxLocation.lng,
            privacyRadiusMeters: d.privacyRadiusMeters,
            neighborhood: d.neighborhood,
            availabilityWindow: d.availabilityWindow,
            screeningStatus: d.screeningStatus,
            donationCount: d.donationCount,
            lastActiveMinutesAgo: d.lastActiveMinutesAgo,
          })
          .onConflictDoNothing();
      }

      const initialThreads = createInitialThreads();
      initialThreads.push({
        id: 'thread-community-relay',
        donorId: 'community-desk',
        donorHandle: 'RaktSetu Relay Room',
        bloodType: 'B+',
        neighborhood: 'All Accredited Zones',
        requestedBloodType: 'B+',
        urgency: 'routine',
        createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
        messages: [
          {
            id: 'msg-community-1',
            threadId: 'thread-community-relay',
            senderRole: 'donor',
            senderLabel: 'Donor #BP-402',
            text: 'Welcome to the live RaktSetu Relay Room. Recipients and Donors connected in real time can coordinate hospital desk check-ins here.',
            timestamp: new Date(Date.now() - 1000 * 60 * 25).toISOString(),
          },
        ],
      });

      for (const t of initialThreads) {
        await db
          .insert(threads)
          .values({
            id: t.id,
            donorId: t.donorId,
            donorHandle: t.donorHandle,
            bloodType: t.bloodType,
            neighborhood: t.neighborhood,
            requestedBloodType: t.requestedBloodType,
            urgency: t.urgency,
            createdAt: new Date(t.createdAt),
          })
          .onConflictDoNothing();

        for (const m of t.messages) {
          await db
            .insert(messages)
            .values({
              id: m.id,
              threadId: t.id,
              senderRole: m.senderRole,
              senderLabel: m.senderLabel,
              text: m.text,
              createdAt: new Date(m.timestamp),
            })
            .onConflictDoNothing();
        }
      }

      const initialRequests = createInitialUrgentRequests();
      for (const r of initialRequests) {
        await db
          .insert(urgentRequests)
          .values({
            id: r.id,
            bloodType: r.bloodType,
            facilityZone: r.facilityZone,
            unitsNeeded: r.unitsNeeded,
            note: r.note,
            lat: r.location.lat,
            lng: r.location.lng,
            createdAt: new Date(r.createdAt),
          })
          .onConflictDoNothing();
      }
    } catch (error) {
      seedPromise = null;
      console.error('Database seed failed:', error);
      throw new Error('Database initialization failed.', { cause: error });
    }
  })();
  return seedPromise;
}

interface SignedSessionPayload {
  jti: string;
  id: number;
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  bloodType: BloodType;
  neighborhood: string;
  authProvider: 'email' | 'google';
  avatarUrl?: string;
  exp: number;
}

function getSessionHmacSecret(): string {
  return (
    process.env.SESSION_SECRET ||
    process.env.GEMINI_API_KEY ||
    'raktsetu-32da896c-d693-4749-b808-e471b49486d8-session-key'
  );
}

function getTokenKey(token: string): string {
  const verified = verifySignedSessionToken(token);
  if (verified?.jti) return verified.jti;
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 32);
}

function signSessionToken(user: UserProfile, expiresAtMs: number): string {
  const payload: SignedSessionPayload = {
    jti: crypto.randomUUID(),
    id: user.id,
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    bloodType: user.bloodType,
    neighborhood: user.neighborhood,
    authProvider: user.authProvider,
    avatarUrl: sanitizeAvatarUrl(user.avatarUrl),
    exp: expiresAtMs,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSessionHmacSecret())
    .update(encoded)
    .digest('base64url');
  return `rs1.${encoded}.${sig}`;
}

function verifySignedSessionToken(token: string): SignedSessionPayload | null {
  if (!token || !token.startsWith('rs1.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, encoded, sig] = parts;
  if (!encoded || !sig) return null;
  try {
    const expectedSig = crypto
      .createHmac('sha256', getSessionHmacSecret())
      .update(encoded)
      .digest('base64url');
    const sigBuf = Buffer.from(sig, 'utf8');
    const expBuf = Buffer.from(expectedSig, 'utf8');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }
    const payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    ) as SignedSessionPayload;
    if (!payload || typeof payload.exp !== 'number' || payload.exp <= Date.now()) {
      return null;
    }
    if (!payload.email || !payload.uid || typeof payload.id !== 'number') {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export async function createSession(
  userId: number,
  userProfile?: UserProfile
): Promise<string> {
  const expiresAtMs = Date.now() + 1000 * 60 * 60 * 24 * 30;
  const expiresAt = new Date(expiresAtMs);

  if (!isSqlAvailable()) {
    const store = loadStore();
    const resolvedUser =
      userProfile ||
      (() => {
        const found = store.users.find((u) => u.id === userId);
        return found ? toUserProfile(found) : undefined;
      })();
    const token = resolvedUser
      ? signSessionToken(resolvedUser, expiresAtMs)
      : crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    store.sessions = store.sessions
      .filter((s) => new Date(s.expiresAt).getTime() > now)
      .slice(-500);
    store.sessions.push({ token, userId, expiresAt: expiresAt.toISOString() });
    await persistStore(store);
    return token;
  }

  try {
    let profile = userProfile;
    if (!profile) {
      const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (rows[0]) profile = mapUserRow(rows[0]);
    }
    const token = profile
      ? signSessionToken(profile, expiresAtMs)
      : crypto.randomBytes(32).toString('hex');
    await db.insert(userSessions).values({
      token,
      userId,
      expiresAt,
    });
    return token;
  } catch (error) {
    console.error('Create session failed:', error);
    throw new Error('Could not create user session.', { cause: error });
  }
}

export async function getUserBySessionToken(token: string): Promise<UserProfile | null> {
  if (!token) return null;
  const store = !isSqlAvailable() ? loadStore() : null;
  const payload = verifySignedSessionToken(token);

  if (store && payload?.jti && store.revokedTokenJtis.includes(payload.jti)) {
    return null;
  }
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex').slice(0, 32);
  if (store && store.revokedTokenJtis.includes(tokenHash)) {
    return null;
  }

  if (!isSqlAvailable() && store) {
    const now = Date.now();
    const session = store.sessions.find(
      (s) => s.token === token && new Date(s.expiresAt).getTime() > now
    );
    if (session) {
      const existingUser = store.users.find((u) => u.id === session.userId);
      if (existingUser) return toUserProfile(existingUser);
    }

    // Re-hydrate user & session from valid signed token after server restart or storage reset
    if (payload) {
      let user =
        store.users.find((u) => u.id === payload.id) ||
        store.users.find((u) => u.uid === payload.uid) ||
        store.users.find((u) => u.email === payload.email.toLowerCase());

      if (!user) {
        const nowIso = new Date().toISOString();
        user = {
          id: payload.id,
          uid: payload.uid,
          email: payload.email.toLowerCase(),
          passwordHash: null,
          displayName: payload.displayName,
          role: payload.role === 'donor' ? 'donor' : 'recipient',
          bloodType: payload.bloodType || 'B+',
          neighborhood: payload.neighborhood || 'Local Zone',
          authProvider: payload.authProvider === 'google' ? 'google' : 'email',
          avatarUrl: sanitizeAvatarUrl(payload.avatarUrl),
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        store.users.push(user);
        if (store.nextUserId <= user.id) {
          store.nextUserId = user.id + 1;
        }
      }
      store.sessions.push({
        token,
        userId: user.id,
        expiresAt: new Date(payload.exp).toISOString(),
      });
      await persistStore(store);
      return toUserProfile(user);
    }

    return null;
  }

  try {
    const rows = await db
      .select({ user: users })
      .from(userSessions)
      .innerJoin(users, eq(userSessions.userId, users.id))
      .where(and(eq(userSessions.token, token), gt(userSessions.expiresAt, new Date())))
      .limit(1);

    if (rows[0]) return mapUserRow(rows[0].user);

    if (payload) {
      const userRows = await db
        .select()
        .from(users)
        .where(eq(users.uid, payload.uid))
        .limit(1);
      if (userRows[0]) {
        return mapUserRow(userRows[0]);
      }
    }
    return null;
  } catch (error) {
    console.error('Get user by session token failed:', error);
    throw new Error('Session lookup failed.', { cause: error });
  }
}

export async function deleteSession(token: string): Promise<void> {
  if (!token) return;
  if (!isSqlAvailable()) {
    const store = loadStore();
    const key = getTokenKey(token);
    if (!store.revokedTokenJtis.includes(key)) {
      store.revokedTokenJtis = [...store.revokedTokenJtis.slice(-1999), key];
    }
    store.sessions = store.sessions.filter((s) => s.token !== token);
    await persistStore(store);
    return;
  }

  try {
    await db.delete(userSessions).where(eq(userSessions.token, token));
  } catch (error) {
    console.error('Delete session failed:', error);
    throw new Error('Could not sign out.', { cause: error });
  }
}

export async function registerOrLoginEmailUser(params: {
  email: string;
  password: string;
  role: UserRole;
  displayName?: string;
  bloodType?: BloodType;
  mode: 'register' | 'login';
}): Promise<{ user: UserProfile; token: string }> {
  const normalizedEmail = params.email.trim().toLowerCase();

  if (!isSqlAvailable()) {
    const store = loadStore();
    const existing = store.users.find((u) => u.email === normalizedEmail);

    if (params.mode === 'login') {
      if (!existing || !existing.passwordHash) {
        throw new Error('INVALID_CREDENTIALS');
      }
      if (!verifyPassword(params.password, existing.passwordHash)) {
        throw new Error('INVALID_CREDENTIALS');
      }
      const token = await createSession(existing.id);
      return { user: toUserProfile(existing), token };
    }

    if (existing) {
      throw new Error('EMAIL_EXISTS');
    }

    const nowIso = new Date().toISOString();
    const created: StoredUser = {
      id: store.nextUserId++,
      uid: `email-${crypto.randomUUID()}`,
      email: normalizedEmail,
      passwordHash: hashPassword(params.password),
      displayName:
        params.displayName?.trim() || normalizedEmail.split('@')[0] || 'RaktSetu Member',
      role: params.role,
      bloodType: params.bloodType || 'B+',
      neighborhood: 'Local Zone',
      authProvider: 'email',
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    store.users.push(created);
    await persistStore(store);
    const token = await createSession(created.id);
    return { user: toUserProfile(created), token };
  }

  try {
    const existingRows = await db
      .select()
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);
    const existing = existingRows[0];

    if (params.mode === 'login') {
      if (!existing || !existing.passwordHash) {
        throw new Error('INVALID_CREDENTIALS');
      }
      if (!verifyPassword(params.password, existing.passwordHash)) {
        throw new Error('INVALID_CREDENTIALS');
      }
      const token = await createSession(existing.id);
      return { user: mapUserRow(existing), token };
    }

    if (existing) {
      throw new Error('EMAIL_EXISTS');
    }

    const uid = `email-${crypto.randomUUID()}`;
    const displayName =
      params.displayName?.trim() || normalizedEmail.split('@')[0] || 'RaktSetu Member';
    const inserted = await db
      .insert(users)
      .values({
        uid,
        email: normalizedEmail,
        passwordHash: hashPassword(params.password),
        displayName,
        role: params.role,
        bloodType: params.bloodType || 'B+',
        neighborhood: 'Local Zone',
        authProvider: 'email',
      })
      .returning();

    const created = inserted[0];
    const token = await createSession(created.id);
    return { user: mapUserRow(created), token };
  } catch (error) {
    if (error instanceof Error && (error.message === 'INVALID_CREDENTIALS' || error.message === 'EMAIL_EXISTS')) {
      throw error;
    }
    console.error('Email auth failed:', error);
    throw new Error('Authentication failed.', { cause: error });
  }
}

export async function upsertGoogleUser(params: {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  avatarUrl?: string;
}): Promise<{ user: UserProfile; token: string }> {
  const normalizedEmail = params.email.trim().toLowerCase();
  const cleanAvatar = sanitizeAvatarUrl(params.avatarUrl);

  if (!isSqlAvailable()) {
    const store = loadStore();
    const nowIso = new Date().toISOString();
    let user =
      store.users.find((u) => u.uid === params.uid) ||
      store.users.find((u) => u.email === normalizedEmail);

    if (user) {
      user.uid = params.uid;
      user.email = normalizedEmail;
      user.displayName = params.displayName || user.displayName;
      user.authProvider = 'google';
      if (cleanAvatar && !user.avatarUrl) {
        user.avatarUrl = cleanAvatar;
      } else if (cleanAvatar) {
        user.avatarUrl = cleanAvatar;
      }
      user.updatedAt = nowIso;
    } else {
      user = {
        id: store.nextUserId++,
        uid: params.uid,
        email: normalizedEmail,
        passwordHash: null,
        displayName:
          params.displayName || normalizedEmail.split('@')[0] || 'RaktSetu Member',
        role: params.role,
        bloodType: 'B+',
        neighborhood: 'Local Zone',
        authProvider: 'google',
        avatarUrl: cleanAvatar,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      store.users.push(user);
    }
    await persistStore(store);
    const token = await createSession(user.id);
    return { user: toUserProfile(user), token };
  }

  try {
    const existingByEmail = await db
      .select()
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    let savedUser: typeof users.$inferSelect;
    if (existingByEmail[0]) {
      const updated = await db
        .update(users)
        .set({
          uid: params.uid,
          displayName: params.displayName || existingByEmail[0].displayName,
          authProvider: 'google',
          ...(cleanAvatar ? { avatarUrl: cleanAvatar } : {}),
          updatedAt: new Date(),
        })
        .where(eq(users.id, existingByEmail[0].id))
        .returning();
      savedUser = updated[0];
    } else {
      const inserted = await db
        .insert(users)
        .values({
          uid: params.uid,
          email: normalizedEmail,
          displayName: params.displayName || normalizedEmail.split('@')[0] || 'RaktSetu Member',
          role: params.role,
          bloodType: 'B+',
          neighborhood: 'Local Zone',
          authProvider: 'google',
          avatarUrl: cleanAvatar ?? null,
        })
        .onConflictDoUpdate({
          target: users.uid,
          set: {
            email: normalizedEmail,
            displayName: params.displayName || 'RaktSetu Member',
            ...(cleanAvatar ? { avatarUrl: cleanAvatar } : {}),
            updatedAt: new Date(),
          },
        })
        .returning();
      savedUser = inserted[0];
    }

    const token = await createSession(savedUser.id);
    return { user: mapUserRow(savedUser), token };
  } catch (error) {
    console.error('Google user upsert failed:', error);
    throw new Error('Could not sync Google account.', { cause: error });
  }
}

export async function getOrCreateDemoUser(): Promise<{ user: UserProfile; token: string }> {
  const demoEmail = 'demo@raktsetu.org';

  if (!isSqlAvailable()) {
    const store = loadStore();
    let demoUser = store.users.find((u) => u.email === demoEmail);
    if (!demoUser) {
      const nowIso = new Date().toISOString();
      demoUser = {
        id: store.nextUserId++,
        uid: 'demo-raktsetu-user',
        email: demoEmail,
        passwordHash: hashPassword('raktsetu-demo-pass'),
        displayName: 'Demo Member',
        role: 'recipient',
        bloodType: 'B+',
        neighborhood: 'Civic Center Zone',
        authProvider: 'email',
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      store.users.push(demoUser);
      await persistStore(store);
    }
    const token = await createSession(demoUser.id);
    return { user: toUserProfile(demoUser), token };
  }

  try {
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.email, demoEmail))
      .limit(1);

    let demoRow = existing[0];
    if (!demoRow) {
      const inserted = await db
        .insert(users)
        .values({
          uid: 'demo-raktsetu-user',
          email: demoEmail,
          passwordHash: hashPassword('raktsetu-demo-pass'),
          displayName: 'Demo Member',
          role: 'recipient',
          bloodType: 'B+',
          neighborhood: 'Civic Center Zone',
          authProvider: 'email',
        })
        .onConflictDoUpdate({
          target: users.email,
          set: { updatedAt: new Date() },
        })
        .returning();
      demoRow = inserted[0];
    }

    const token = await createSession(demoRow.id);
    return { user: mapUserRow(demoRow), token };
  } catch (error) {
    console.error('Demo user init failed:', error);
    throw new Error('Could not start demo session.', { cause: error });
  }
}

export async function updateUserRole(userId: number, role: UserRole): Promise<UserProfile> {
  if (!isSqlAvailable()) {
    const store = loadStore();
    const user = store.users.find((u) => u.id === userId);
    if (!user) throw new Error('User not found.');
    user.role = role;
    user.updatedAt = new Date().toISOString();
    await persistStore(store);
    return toUserProfile(user);
  }

  try {
    const updated = await db
      .update(users)
      .set({ role, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    if (!updated[0]) {
      throw new Error('User not found.');
    }
    return mapUserRow(updated[0]);
  } catch (error) {
    console.error('Update user role failed:', error);
    throw new Error('Could not update role.', { cause: error });
  }
}

export async function updateUserProfile(
  userId: number,
  updates: {
    bloodType?: BloodType;
    neighborhood?: string;
    displayName?: string;
    avatarUrl?: string | null;
  }
): Promise<UserProfile> {
  const hasAvatarUpdate = updates.avatarUrl !== undefined;
  const cleanAvatar =
    updates.avatarUrl === null || updates.avatarUrl === ''
      ? undefined
      : sanitizeAvatarUrl(updates.avatarUrl);

  if (!isSqlAvailable()) {
    const store = loadStore();
    const user = store.users.find((u) => u.id === userId);
    if (!user) throw new Error('User not found.');
    if (updates.bloodType) user.bloodType = updates.bloodType;
    if (updates.neighborhood) user.neighborhood = updates.neighborhood.trim().slice(0, 64);
    if (updates.displayName) user.displayName = updates.displayName.trim().slice(0, 64);
    if (hasAvatarUpdate) {
      user.avatarUrl = cleanAvatar;
    }
    user.updatedAt = new Date().toISOString();
    await persistStore(store);
    return toUserProfile(user);
  }

  try {
    const updated = await db
      .update(users)
      .set({
        ...(updates.bloodType ? { bloodType: updates.bloodType } : {}),
        ...(updates.neighborhood ? { neighborhood: updates.neighborhood.trim().slice(0, 64) } : {}),
        ...(updates.displayName ? { displayName: updates.displayName.trim().slice(0, 64) } : {}),
        ...(hasAvatarUpdate ? { avatarUrl: cleanAvatar ?? null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();
    if (!updated[0]) {
      throw new Error('User not found.');
    }
    return mapUserRow(updated[0]);
  } catch (error) {
    console.error('Update user profile failed:', error);
    throw new Error('Could not update profile.', { cause: error });
  }
}

export async function getUserScreenings(userId: number): Promise<SavedScreeningRecord[]> {
  if (!isSqlAvailable()) {
    const store = loadStore();
    return store.screenings
      .filter((s) => s.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(({ userId: _uid, ...rest }) => rest);
  }

  try {
    const rows = await db
      .select()
      .from(screenings)
      .where(eq(screenings.userId, userId))
      .orderBy(desc(screenings.createdAt));

    return rows.map((r) => ({
      id: r.id,
      bloodType: (r.bloodType as BloodType) || 'B+',
      neighborhood: r.neighborhood,
      availabilityWindow: r.availabilityWindow,
      status: r.status as SavedScreeningRecord['status'],
      summary: r.summary,
      answersJson: r.answersJson as ScreeningAnswers,
      createdAt: r.createdAt.toISOString(),
    }));
  } catch (error) {
    console.error('Get screenings failed:', error);
    throw new Error('Could not load saved screening records.', { cause: error });
  }
}

export async function saveScreeningAndOptionalDonor(params: {
  userId: number;
  bloodType: BloodType;
  neighborhood: string;
  availabilityWindow: string;
  evaluation: ScreeningEvaluation;
  answers: ScreeningAnswers;
  publishDonor: boolean;
  lat: number;
  lng: number;
}): Promise<{ screening: SavedScreeningRecord; donor: AnonymousDonor | null }> {
  const screeningId = `scr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const status: SavedScreeningRecord['status'] =
    params.evaluation.status === 'eligible'
      ? 'eligible'
      : params.evaluation.status === 'temporary_deferral'
        ? 'temporary_deferral'
        : 'consult_center';

  if (!isSqlAvailable()) {
    const store = loadStore();
    const record: StoredScreening = {
      id: screeningId,
      userId: params.userId,
      bloodType: params.bloodType,
      neighborhood: params.neighborhood.trim().slice(0, 64),
      availabilityWindow: params.availabilityWindow.trim().slice(0, 64),
      status,
      summary: params.evaluation.summary,
      answersJson: params.answers,
      createdAt: new Date().toISOString(),
    };
    store.screenings.unshift(record);

    let createdDonor: AnonymousDonor | null = null;
    if (params.publishDonor && params.evaluation.status === 'eligible') {
      const existingDonorIndex = store.donors.findIndex(
        (d) => d.ownerUserId === params.userId
      );
      const existingDonor =
        existingDonorIndex >= 0 ? store.donors[existingDonorIndex] : null;
      const donorId = existingDonor?.id || `donor-live-${Date.now()}`;
      const seq = 100 + (Math.floor(Date.now() / 1000) % 899);
      const approx = fuzzCoordinates(params.lat, params.lng, donorId);
      const handle =
        existingDonor && existingDonor.bloodType === params.bloodType
          ? existingDonor.anonymousHandle
          : generateAnonymousHandle(params.bloodType, seq);
      createdDonor = {
        id: donorId,
        ownerUserId: params.userId,
        anonymousHandle: handle,
        bloodType: params.bloodType,
        approxLocation: approx,
        privacyRadiusMeters: 800,
        neighborhood: params.neighborhood.trim().slice(0, 64),
        availabilityWindow: params.availabilityWindow.trim().slice(0, 64),
        screeningStatus: 'verified',
        donationCount: existingDonor?.donationCount ?? 1,
        lastActiveMinutesAgo: 0,
      };
      if (existingDonorIndex >= 0) {
        store.donors.splice(existingDonorIndex, 1);
      }
      store.donors.unshift(createdDonor);
    }

    await persistStore(store);
    const { userId: _uid, ...publicScreening } = record;
    return { screening: publicScreening, donor: createdDonor };
  }

  try {
    const insertedScreening = await db
      .insert(screenings)
      .values({
        id: screeningId,
        userId: params.userId,
        bloodType: params.bloodType,
        neighborhood: params.neighborhood.trim().slice(0, 64),
        availabilityWindow: params.availabilityWindow.trim().slice(0, 64),
        status,
        summary: params.evaluation.summary,
        answersJson: params.answers,
      })
      .returning();

    let createdDonor: AnonymousDonor | null = null;
    if (params.publishDonor && params.evaluation.status === 'eligible') {
      const existingDonorRows = await db
        .select()
        .from(donors)
        .where(eq(donors.userId, params.userId))
        .limit(1);
      const existingDonor = existingDonorRows[0];

      const donorId = existingDonor?.id || `donor-live-${Date.now()}`;
      const seq = 100 + (Math.floor(Date.now() / 1000) % 899);
      const approx = fuzzCoordinates(params.lat, params.lng, donorId);
      const handle =
        existingDonor && existingDonor.bloodType === params.bloodType
          ? existingDonor.anonymousHandle
          : generateAnonymousHandle(params.bloodType, seq);

      let d: typeof donors.$inferSelect;
      if (existingDonor) {
        const updatedDonor = await db
          .update(donors)
          .set({
            anonymousHandle: handle,
            bloodType: params.bloodType,
            lat: approx.lat,
            lng: approx.lng,
            neighborhood: params.neighborhood.trim().slice(0, 64),
            availabilityWindow: params.availabilityWindow.trim().slice(0, 64),
            screeningStatus: 'verified',
            lastActiveMinutesAgo: 0,
          })
          .where(eq(donors.id, existingDonor.id))
          .returning();
        d = updatedDonor[0];
      } else {
        const insertedDonor = await db
          .insert(donors)
          .values({
            id: donorId,
            userId: params.userId,
            anonymousHandle: handle,
            bloodType: params.bloodType,
            lat: approx.lat,
            lng: approx.lng,
            privacyRadiusMeters: 800,
            neighborhood: params.neighborhood.trim().slice(0, 64),
            availabilityWindow: params.availabilityWindow.trim().slice(0, 64),
            screeningStatus: 'verified',
            donationCount: 1,
            lastActiveMinutesAgo: 0,
          })
          .returning();
        d = insertedDonor[0];
      }

      createdDonor = {
        id: d.id,
        ownerUserId: d.userId ?? params.userId,
        anonymousHandle: d.anonymousHandle,
        bloodType: d.bloodType as BloodType,
        approxLocation: { lat: d.lat, lng: d.lng },
        privacyRadiusMeters: d.privacyRadiusMeters,
        neighborhood: d.neighborhood,
        availabilityWindow: d.availabilityWindow,
        screeningStatus: 'verified',
        donationCount: d.donationCount,
        lastActiveMinutesAgo: d.lastActiveMinutesAgo,
      };
    }

    const s = insertedScreening[0];
    return {
      screening: {
        id: s.id,
        bloodType: s.bloodType as BloodType,
        neighborhood: s.neighborhood,
        availabilityWindow: s.availabilityWindow,
        status: s.status as SavedScreeningRecord['status'],
        summary: s.summary,
        answersJson: s.answersJson as ScreeningAnswers,
        createdAt: s.createdAt.toISOString(),
      },
      donor: createdDonor,
    };
  } catch (error) {
    console.error('Save screening failed:', error);
    throw new Error('Could not save screening submission.', { cause: error });
  }
}

export async function getAllNetworkState(): Promise<{
  donors: AnonymousDonor[];
  threads: ChatThread[];
  urgentRequests: UrgentRequest[];
}> {
  if (!isSqlAvailable()) {
    const store = loadStore();
    return {
      donors: store.donors,
      threads: store.threads,
      urgentRequests: store.urgentRequests,
    };
  }

  try {
    await ensureSeededData();

    const [donorRows, threadRows, messageRows, requestRows] = await Promise.all([
      db.select().from(donors).orderBy(desc(donors.createdAt)),
      db.select().from(threads).orderBy(desc(threads.createdAt)),
      db.select().from(messages).orderBy(asc(messages.createdAt)),
      db.select().from(urgentRequests).orderBy(desc(urgentRequests.createdAt)),
    ]);

    const messagesByThread = new Map<string, ChatMessage[]>();
    for (const m of messageRows) {
      const list = messagesByThread.get(m.threadId) || [];
      list.push({
        id: m.id,
        threadId: m.threadId,
        senderRole: m.senderRole === 'donor' ? 'donor' : 'recipient',
        senderLabel: m.senderLabel,
        senderUserId: m.senderUserId,
        text: m.text,
        timestamp: m.createdAt.toISOString(),
      });
      messagesByThread.set(m.threadId, list);
    }

    return {
      donors: donorRows.map((d) => ({
        id: d.id,
        ownerUserId: d.userId ?? null,
        anonymousHandle: d.anonymousHandle,
        bloodType: d.bloodType as BloodType,
        approxLocation: { lat: d.lat, lng: d.lng },
        privacyRadiusMeters: d.privacyRadiusMeters,
        neighborhood: d.neighborhood,
        availabilityWindow: d.availabilityWindow,
        screeningStatus: d.screeningStatus as AnonymousDonor['screeningStatus'],
        donationCount: d.donationCount,
        lastActiveMinutesAgo: d.lastActiveMinutesAgo,
      })),
      threads: threadRows.map((t) => ({
        id: t.id,
        donorId: t.donorId,
        donorHandle: t.donorHandle,
        bloodType: t.bloodType as BloodType,
        neighborhood: t.neighborhood,
        requestedBloodType: t.requestedBloodType as BloodType,
        urgency: t.urgency === 'urgent' ? 'urgent' : 'routine',
        createdAt: t.createdAt.toISOString(),
        messages: messagesByThread.get(t.id) || [],
      })),
      urgentRequests: requestRows.map((r) => ({
        id: r.id,
        bloodType: r.bloodType as BloodType,
        facilityZone: r.facilityZone,
        unitsNeeded: r.unitsNeeded,
        note: r.note,
        createdAt: r.createdAt.toISOString(),
        location: { lat: r.lat, lng: r.lng },
      })),
    };
  } catch (error) {
    console.error('Get network state failed:', error);
    throw new Error('Could not load live network data.', { cause: error });
  }
}

export async function ensureLocalDonorsAround(center: LatLng): Promise<AnonymousDonor[]> {
  const regionalSeeds: Array<{
    bloodType: BloodType;
    offsetLat: number;
    offsetLng: number;
    window: string;
    count: number;
  }> = [
    { bloodType: 'B+', offsetLat: 0.012, offsetLng: -0.008, window: 'Available now (within 30m)', count: 6 },
    { bloodType: 'O-', offsetLat: -0.015, offsetLng: 0.014, window: 'Universal donor · Ready today', count: 11 },
    { bloodType: 'O+', offsetLat: 0.008, offsetLng: 0.019, window: 'Available today until 8:00 PM', count: 4 },
    { bloodType: 'A+', offsetLat: -0.011, offsetLng: -0.016, window: 'Available within 1 hr', count: 7 },
  ];

  if (!isSqlAvailable()) {
    const store = loadStore();
    const hasNearby = store.donors.some(
      (d) => calculateDistanceKm(center, d.approxLocation) <= 35
    );
    if (hasNearby) return [];

    const created: AnonymousDonor[] = [];
    for (let i = 0; i < regionalSeeds.length; i++) {
      const item = regionalSeeds[i];
      const id = `donor-local-${Math.round(center.lat * 100)}-${Math.round(center.lng * 100)}-${i}`;
      if (store.donors.some((d) => d.id === id)) continue;
      const approx = fuzzCoordinates(
        center.lat + item.offsetLat,
        center.lng + item.offsetLng,
        id
      );
      const handle = generateAnonymousHandle(item.bloodType, 900 + i);
      const donorObj: AnonymousDonor = {
        id,
        anonymousHandle: handle,
        bloodType: item.bloodType,
        approxLocation: approx,
        privacyRadiusMeters: 800,
        neighborhood: 'Nearby Verified Zone',
        availabilityWindow: item.window,
        screeningStatus: 'verified',
        donationCount: item.count,
        lastActiveMinutesAgo: i * 4 + 2,
      };
      store.donors.unshift(donorObj);
      created.push(donorObj);
    }
    if (created.length > 0) {
      await persistStore(store);
    }
    return created;
  }

  try {
    await ensureSeededData();
    const existingRows = await db.select().from(donors);
    const hasNearby = existingRows.some(
      (d) => calculateDistanceKm(center, { lat: d.lat, lng: d.lng }) <= 35
    );
    if (hasNearby) return [];

    const created: AnonymousDonor[] = [];
    for (let i = 0; i < regionalSeeds.length; i++) {
      const item = regionalSeeds[i];
      const id = `donor-local-${Math.round(center.lat * 100)}-${Math.round(center.lng * 100)}-${i}`;
      const approx = fuzzCoordinates(
        center.lat + item.offsetLat,
        center.lng + item.offsetLng,
        id
      );
      const handle = generateAnonymousHandle(item.bloodType, 900 + i);
      await db
        .insert(donors)
        .values({
          id,
          anonymousHandle: handle,
          bloodType: item.bloodType,
          lat: approx.lat,
          lng: approx.lng,
          privacyRadiusMeters: 800,
          neighborhood: 'Nearby Verified Zone',
          availabilityWindow: item.window,
          screeningStatus: 'verified',
          donationCount: item.count,
          lastActiveMinutesAgo: i * 4 + 2,
        })
        .onConflictDoNothing();

      created.push({
        id,
        anonymousHandle: handle,
        bloodType: item.bloodType,
        approxLocation: approx,
        privacyRadiusMeters: 800,
        neighborhood: 'Nearby Verified Zone',
        availabilityWindow: item.window,
        screeningStatus: 'verified',
        donationCount: item.count,
        lastActiveMinutesAgo: i * 4 + 2,
      });
    }
    return created;
  } catch (error) {
    console.error('Localize donors failed:', error);
    throw new Error('Could not load nearby regional donors.', { cause: error });
  }
}

export async function createOrGetThread(params: {
  donorId: string;
  requestedBloodType?: BloodType;
  urgency?: 'routine' | 'urgent';
  createdByUserId?: number;
}): Promise<{ thread: ChatThread; created: boolean }> {
  if (!isSqlAvailable()) {
    const store = loadStore();
    const existing = store.threads.find((t) => t.donorId === params.donorId);
    if (existing) {
      return { created: false, thread: existing };
    }

    const donor = store.donors.find((d) => d.id === params.donorId);
    if (!donor) throw new Error('DONOR_NOT_FOUND');

    const thread: ChatThread = {
      id: `thread-${donor.id}`,
      donorId: donor.id,
      donorHandle: donor.anonymousHandle,
      bloodType: donor.bloodType,
      neighborhood: donor.neighborhood,
      requestedBloodType: params.requestedBloodType || donor.bloodType,
      urgency: params.urgency === 'urgent' ? 'urgent' : 'routine',
      createdAt: new Date().toISOString(),
      messages: [],
    };
    store.threads.unshift(thread);
    await persistStore(store);
    return { created: true, thread };
  }

  try {
    await ensureSeededData();
    const existingRows = await db
      .select()
      .from(threads)
      .where(eq(threads.donorId, params.donorId))
      .limit(1);

    if (existingRows[0]) {
      const msgs = await db
        .select()
        .from(messages)
        .where(eq(messages.threadId, existingRows[0].id))
        .orderBy(asc(messages.createdAt));

      return {
        created: false,
        thread: {
          id: existingRows[0].id,
          donorId: existingRows[0].donorId,
          donorHandle: existingRows[0].donorHandle,
          bloodType: existingRows[0].bloodType as BloodType,
          neighborhood: existingRows[0].neighborhood,
          requestedBloodType: existingRows[0].requestedBloodType as BloodType,
          urgency: existingRows[0].urgency === 'urgent' ? 'urgent' : 'routine',
          createdAt: existingRows[0].createdAt.toISOString(),
          messages: msgs.map((m) => ({
            id: m.id,
            threadId: m.threadId,
            senderRole: m.senderRole === 'donor' ? 'donor' : 'recipient',
            senderLabel: m.senderLabel,
            senderUserId: m.senderUserId,
            text: m.text,
            timestamp: m.createdAt.toISOString(),
          })),
        },
      };
    }

    const donorRows = await db
      .select()
      .from(donors)
      .where(eq(donors.id, params.donorId))
      .limit(1);
    const donor = donorRows[0];
    if (!donor) {
      throw new Error('DONOR_NOT_FOUND');
    }

    const threadId = `thread-${donor.id}`;
    const inserted = await db
      .insert(threads)
      .values({
        id: threadId,
        donorId: donor.id,
        donorHandle: donor.anonymousHandle,
        bloodType: donor.bloodType,
        neighborhood: donor.neighborhood,
        requestedBloodType: params.requestedBloodType || donor.bloodType,
        urgency: params.urgency === 'urgent' ? 'urgent' : 'routine',
        createdByUserId: params.createdByUserId ?? null,
      })
      .returning();

    const t = inserted[0];
    return {
      created: true,
      thread: {
        id: t.id,
        donorId: t.donorId,
        donorHandle: t.donorHandle,
        bloodType: t.bloodType as BloodType,
        neighborhood: t.neighborhood,
        requestedBloodType: t.requestedBloodType as BloodType,
        urgency: t.urgency === 'urgent' ? 'urgent' : 'routine',
        createdAt: t.createdAt.toISOString(),
        messages: [],
      },
    };
  } catch (error) {
    if (error instanceof Error && error.message === 'DONOR_NOT_FOUND') throw error;
    console.error('Create thread failed:', error);
    throw new Error('Could not open chat channel.', { cause: error });
  }
}

export async function appendChatMessage(params: {
  threadId: string;
  senderUserId?: number | null;
  senderRole: UserRole;
  senderLabel: string;
  text: string;
}): Promise<ChatMessage | null> {
  const msgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  if (!isSqlAvailable()) {
    const store = loadStore();
    const thread = store.threads.find((t) => t.id === params.threadId);
    if (!thread) return null;
    const msg: ChatMessage = {
      id: msgId,
      threadId: params.threadId,
      senderRole: params.senderRole,
      senderLabel: params.senderLabel,
      senderUserId: params.senderUserId ?? null,
      text: params.text.trim().slice(0, 800),
      timestamp: new Date().toISOString(),
    };
    thread.messages.push(msg);
    await persistStore(store);
    return msg;
  }

  try {
    const threadExists = await db
      .select({ id: threads.id })
      .from(threads)
      .where(eq(threads.id, params.threadId))
      .limit(1);
    if (!threadExists[0]) return null;

    const inserted = await db
      .insert(messages)
      .values({
        id: msgId,
        threadId: params.threadId,
        senderUserId: params.senderUserId ?? null,
        senderRole: params.senderRole,
        senderLabel: params.senderLabel,
        text: params.text.trim().slice(0, 800),
      })
      .returning();

    const m = inserted[0];
    return {
      id: m.id,
      threadId: m.threadId,
      senderRole: m.senderRole === 'donor' ? 'donor' : 'recipient',
      senderLabel: m.senderLabel,
      senderUserId: m.senderUserId,
      text: m.text,
      timestamp: m.createdAt.toISOString(),
    };
  } catch (error) {
    console.error('Append chat message failed:', error);
    throw new Error('Could not send message.', { cause: error });
  }
}

export async function createUrgentRequestRecord(params: {
  userId?: number | null;
  bloodType: BloodType;
  facilityZone: string;
  unitsNeeded: number;
  note: string;
  lat: number;
  lng: number;
}): Promise<UrgentRequest> {
  const reqId = `req-${Date.now()}`;

  if (!isSqlAvailable()) {
    const store = loadStore();
    const request: UrgentRequest = {
      id: reqId,
      bloodType: params.bloodType,
      facilityZone: params.facilityZone.trim().slice(0, 80),
      unitsNeeded: Math.max(1, Math.min(10, Number(params.unitsNeeded) || 1)),
      note: (params.note || 'Hospital blood bank check-in required').trim().slice(0, 140),
      createdAt: new Date().toISOString(),
      location: { lat: params.lat, lng: params.lng },
    };
    store.urgentRequests.unshift(request);
    await persistStore(store);
    return request;
  }

  try {
    const inserted = await db
      .insert(urgentRequests)
      .values({
        id: reqId,
        userId: params.userId ?? null,
        bloodType: params.bloodType,
        facilityZone: params.facilityZone.trim().slice(0, 80),
        unitsNeeded: Math.max(1, Math.min(10, Number(params.unitsNeeded) || 1)),
        note: (params.note || 'Hospital blood bank check-in required').trim().slice(0, 140),
        lat: params.lat,
        lng: params.lng,
      })
      .returning();

    const r = inserted[0];
    return {
      id: r.id,
      bloodType: r.bloodType as BloodType,
      facilityZone: r.facilityZone,
      unitsNeeded: r.unitsNeeded,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
      location: { lat: r.lat, lng: r.lng },
    };
  } catch (error) {
    console.error('Create urgent request failed:', error);
    throw new Error('Could not publish urgent blood request.', { cause: error });
  }
}

export async function getAiHealthHistory(userId: number): Promise<HealthChatMessage[]> {
  if (!isSqlAvailable()) {
    const store = loadStore();
    return store.aiHealthMessages
      .filter((m) => m.userId === userId)
      .map(({ userId: _uid, ...rest }) => rest);
  }

  try {
    const rows = await db
      .select()
      .from(aiHealthMessages)
      .where(eq(aiHealthMessages.userId, userId))
      .orderBy(asc(aiHealthMessages.createdAt));

    return rows.map((r) => ({
      id: r.id,
      role: r.role === 'assistant' ? 'assistant' : 'user',
      text: r.text,
      createdAt: r.createdAt.toISOString(),
    }));
  } catch (error) {
    console.error('Get AI health history failed:', error);
    throw new Error('Could not load health chat history.', { cause: error });
  }
}

export async function appendAiHealthMessage(params: {
  userId: number;
  role: 'user' | 'assistant';
  text: string;
}): Promise<HealthChatMessage> {
  const id = `hc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  if (!isSqlAvailable()) {
    const store = loadStore();
    const entry: StoredHealthMsg = {
      id,
      userId: params.userId,
      role: params.role,
      text: params.text,
      createdAt: new Date().toISOString(),
    };
    store.aiHealthMessages.push(entry);
    await persistStore(store);
    const { userId: _uid, ...rest } = entry;
    return rest;
  }

  try {
    const inserted = await db
      .insert(aiHealthMessages)
      .values({
        id,
        userId: params.userId,
        role: params.role,
        text: params.text,
      })
      .returning();
    const row = inserted[0];
    return {
      id: row.id,
      role: row.role === 'assistant' ? 'assistant' : 'user',
      text: row.text,
      createdAt: row.createdAt.toISOString(),
    };
  } catch (error) {
    console.error('Append AI health message failed:', error);
    throw new Error('Could not save health chat message.', { cause: error });
  }
}

function formatPaymentMethodRecord(method: string, details?: string): string {
  const cleanMethod = (method || 'UPI').trim().slice(0, 32) || 'UPI';
  const cleanDetails = details?.trim().slice(0, 64);
  return cleanDetails ? `${cleanMethod} · ${cleanDetails}` : cleanMethod;
}

function parsePaymentMethodRecord(raw: string): {
  paymentMethod: string;
  paymentDetails?: string;
} {
  const parts = raw.split(' · ');
  if (parts.length >= 2) {
    return {
      paymentMethod: parts[0],
      paymentDetails: parts.slice(1).join(' · '),
    };
  }
  return { paymentMethod: raw };
}

function generateTransactionId(): string {
  return `RKT-${Date.now().toString(36).toUpperCase()}-${crypto
    .randomBytes(2)
    .toString('hex')
    .toUpperCase()}`;
}

export async function getUnlockedDonorIds(userId: number): Promise<string[]> {
  if (!isSqlAvailable()) {
    const store = loadStore();
    const paidIds = store.unlockedDonors
      .filter((item) => item.userId === userId)
      .map((item) => item.donorId);
    const ownedIds = store.donors
      .filter((d) => d.ownerUserId === userId)
      .map((d) => d.id);
    return Array.from(new Set([...paidIds, ...ownedIds]));
  }

  try {
    const [unlockRows, ownedRows] = await Promise.all([
      db
        .select({ donorId: donorChatUnlocks.donorId })
        .from(donorChatUnlocks)
        .where(eq(donorChatUnlocks.userId, userId)),
      db
        .select({ id: donors.id })
        .from(donors)
        .where(eq(donors.userId, userId)),
    ]);
    return Array.from(
      new Set([...unlockRows.map((r) => r.donorId), ...ownedRows.map((d) => d.id)])
    );
  } catch (error) {
    console.error('Get unlocked donors failed:', error);
    throw new Error('Could not load unlocked donor chats.', { cause: error });
  }
}

export async function isDonorUnlockedForUser(
  userId: number,
  donorId: string
): Promise<boolean> {
  const unlocked = await getUnlockedDonorIds(userId);
  return unlocked.includes(donorId);
}

export async function getUserPaymentReceipts(userId: number): Promise<PaymentReceipt[]> {
  if (!isSqlAvailable()) {
    const store = loadStore();
    const donorMap = new Map(store.donors.map((d) => [d.id, d]));
    const threadMap = new Map(store.threads.map((t) => [t.donorId, t]));

    return store.unlockedDonors
      .filter((u) => u.userId === userId)
      .sort((a, b) => b.paidAt.localeCompare(a.paidAt))
      .map((u) => {
        const donor = donorMap.get(u.donorId);
        const thread = threadMap.get(u.donorId);
        return {
          transactionId:
            u.transactionId || `RKT-${u.donorId.slice(-6).toUpperCase()}`,
          donorId: u.donorId,
          donorHandle:
            donor?.anonymousHandle ||
            thread?.donorHandle ||
            `Donor #${u.donorId.slice(-4)}`,
          bloodType: (donor?.bloodType || thread?.bloodType || 'B+') as BloodType,
          amountInr: u.amountInr,
          paymentMethod: u.paymentMethod,
          paymentDetails: u.paymentDetails,
          paidAt: u.paidAt,
        };
      });
  }

  try {
    const [unlockRows, donorRows, threadRows] = await Promise.all([
      db
        .select()
        .from(donorChatUnlocks)
        .where(eq(donorChatUnlocks.userId, userId))
        .orderBy(desc(donorChatUnlocks.paidAt)),
      db.select().from(donors),
      db.select().from(threads),
    ]);

    const donorMap = new Map(donorRows.map((d) => [d.id, d]));
    const threadMap = new Map(threadRows.map((t) => [t.donorId, t]));

    return unlockRows.map((row) => {
      const donor = donorMap.get(row.donorId);
      const thread = threadMap.get(row.donorId);
      const parsed = parsePaymentMethodRecord(row.paymentMethod);
      return {
        transactionId: row.id.startsWith('RKT-')
          ? row.id
          : `RKT-${row.donorId.slice(-6).toUpperCase()}`,
        donorId: row.donorId,
        donorHandle:
          donor?.anonymousHandle ||
          thread?.donorHandle ||
          `Donor #${row.donorId.slice(-4)}`,
        bloodType: (donor?.bloodType || thread?.bloodType || 'B+') as BloodType,
        amountInr: row.amountInr,
        paymentMethod: parsed.paymentMethod,
        paymentDetails: parsed.paymentDetails,
        paidAt: row.paidAt.toISOString(),
      };
    });
  } catch (error) {
    console.error('Get payment receipts failed:', error);
    throw new Error('Could not load payment receipts.', { cause: error });
  }
}

export async function unlockDonorChatForUser(params: {
  userId: number;
  donorId: string;
  amountInr: number;
  paymentMethod?: string;
  paymentDetails?: string;
}): Promise<{
  unlockedDonorIds: string[];
  receipt: PaymentReceipt;
}> {
  const method = (params.paymentMethod || 'UPI').trim().slice(0, 32) || 'UPI';
  const cleanDetails = params.paymentDetails?.trim().slice(0, 64) || undefined;
  const amount = Math.max(50, Math.round(params.amountInr || 50));

  if (!isSqlAvailable()) {
    const store = loadStore();
    const donor = store.donors.find((d) => d.id === params.donorId);
    const thread = store.threads.find((t) => t.donorId === params.donorId);
    if (!donor && !thread) throw new Error('DONOR_NOT_FOUND');

    const donorHandle =
      donor?.anonymousHandle ||
      thread?.donorHandle ||
      `Donor #${params.donorId.slice(-4)}`;
    const bloodType = (donor?.bloodType || thread?.bloodType || 'B+') as BloodType;

    const existing = store.unlockedDonors.find(
      (u) => u.userId === params.userId && u.donorId === params.donorId
    );
    if (existing) {
      return {
        unlockedDonorIds: await getUnlockedDonorIds(params.userId),
        receipt: {
          transactionId:
            existing.transactionId || `RKT-${existing.donorId.slice(-6).toUpperCase()}`,
          donorId: existing.donorId,
          donorHandle,
          bloodType,
          amountInr: existing.amountInr,
          paymentMethod: existing.paymentMethod,
          paymentDetails: existing.paymentDetails,
          paidAt: existing.paidAt,
        },
      };
    }

    const paidAt = new Date().toISOString();
    const transactionId = generateTransactionId();
    store.unlockedDonors.push({
      transactionId,
      userId: params.userId,
      donorId: params.donorId,
      amountInr: amount,
      paymentMethod: method,
      paymentDetails: cleanDetails,
      paidAt,
    });
    await persistStore(store);
    return {
      unlockedDonorIds: await getUnlockedDonorIds(params.userId),
      receipt: {
        transactionId,
        donorId: params.donorId,
        donorHandle,
        bloodType,
        amountInr: amount,
        paymentMethod: method,
        paymentDetails: cleanDetails,
        paidAt,
      },
    };
  }

  try {
    await ensureSeededData();
    const [donorRows, threadRows] = await Promise.all([
      db
        .select()
        .from(donors)
        .where(eq(donors.id, params.donorId))
        .limit(1),
      db
        .select()
        .from(threads)
        .where(eq(threads.donorId, params.donorId))
        .limit(1),
    ]);
    const donor = donorRows[0];
    const thread = threadRows[0];
    if (!donor && !thread) throw new Error('DONOR_NOT_FOUND');

    const donorHandle =
      donor?.anonymousHandle ||
      thread?.donorHandle ||
      `Donor #${params.donorId.slice(-4)}`;
    const bloodType = (donor?.bloodType || thread?.bloodType || 'B+') as BloodType;

    const existing = await db
      .select()
      .from(donorChatUnlocks)
      .where(
        and(
          eq(donorChatUnlocks.userId, params.userId),
          eq(donorChatUnlocks.donorId, params.donorId)
        )
      )
      .limit(1);

    if (existing[0]) {
      const parsed = parsePaymentMethodRecord(existing[0].paymentMethod);
      return {
        unlockedDonorIds: await getUnlockedDonorIds(params.userId),
        receipt: {
          transactionId: existing[0].id.startsWith('RKT-')
            ? existing[0].id
            : `RKT-${existing[0].donorId.slice(-6).toUpperCase()}`,
          donorId: existing[0].donorId,
          donorHandle,
          bloodType,
          amountInr: existing[0].amountInr,
          paymentMethod: parsed.paymentMethod,
          paymentDetails: parsed.paymentDetails,
          paidAt: existing[0].paidAt.toISOString(),
        },
      };
    }

    const transactionId = generateTransactionId();
    const storedMethod = formatPaymentMethodRecord(method, cleanDetails);
    const inserted = await db
      .insert(donorChatUnlocks)
      .values({
        id: transactionId,
        userId: params.userId,
        donorId: params.donorId,
        amountInr: amount,
        paymentMethod: storedMethod,
      })
      .returning();

    const row = inserted[0];
    const parsed = parsePaymentMethodRecord(row.paymentMethod);
    return {
      unlockedDonorIds: await getUnlockedDonorIds(params.userId),
      receipt: {
        transactionId: row.id,
        donorId: row.donorId,
        donorHandle,
        bloodType,
        amountInr: row.amountInr,
        paymentMethod: parsed.paymentMethod,
        paymentDetails: parsed.paymentDetails,
        paidAt: row.paidAt.toISOString(),
      },
    };
  } catch (error) {
    if (error instanceof Error && error.message === 'DONOR_NOT_FOUND') throw error;
    console.error('Unlock donor chat failed:', error);
    throw new Error('Could not complete donor chat unlock.', { cause: error });
  }
}

export async function getThreadDonorId(threadId: string): Promise<string | null> {
  if (!isSqlAvailable()) {
    const store = loadStore();
    return store.threads.find((t) => t.id === threadId)?.donorId ?? null;
  }
  try {
    const rows = await db
      .select({ donorId: threads.donorId })
      .from(threads)
      .where(eq(threads.id, threadId))
      .limit(1);
    return rows[0]?.donorId ?? null;
  } catch {
    return null;
  }
}


