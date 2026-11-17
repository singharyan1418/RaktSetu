import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, Modality, ThinkingLevel, type LiveServerMessage } from '@google/genai';
import { adminAuth } from './src/lib/firebase-admin.ts';
import {
  appendAiHealthMessage,
  appendChatMessage,
  createOrGetThread,
  createSession,
  createUrgentRequestRecord,
  deleteSession,
  ensureLocalDonorsAround,
  getAiHealthHistory,
  getAllNetworkState,
  getOrCreateDemoUser,
  getThreadDonorId,
  getUnlockedDonorIds,
  getUserBySessionToken,
  getUserPaymentReceipts,
  getUserScreenings,
  isDonorUnlockedForUser,
  registerOrLoginEmailUser,
  saveScreeningAndOptionalDonor,
  unlockDonorChatForUser,
  updateUserProfile,
  updateUserRole,
  upsertGoogleUser,
} from './src/db/repository.ts';
import type {
  BloodType,
  GroundingSource,
  ScreeningAnswers,
  UserProfile,
  UserRole,
} from './src/types.ts';
import {
  evaluateScreening,
  generateAnonymousSenderLabel,
  validateCredentials,
} from './src/utils/bloodLogic.ts';
import { DEFAULT_CENTER } from './src/utils/seedDonors.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';
const SESSION_COOKIE_NAME = 'raktsetu_session';

function createGeminiClient(apiVersion?: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      ...(apiVersion ? { apiVersion } : {}),
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatGeminiError(err: unknown, fallbackMessage: string): string {
  const raw = err instanceof Error ? err.message : String(err || '');
  if (!raw) return fallbackMessage;
  try {
    const parsed = JSON.parse(raw) as {
      error?: { code?: number; status?: string; message?: string };
      message?: string;
    };
    const inner = parsed.error;
    if (inner?.status === 'RESOURCE_EXHAUSTED' || inner?.code === 429) {
      return 'AI request rate limit reached right now. Please wait a few seconds and try again.';
    }
    if (inner?.status === 'UNAVAILABLE' || inner?.code === 503) {
      return 'AI service is temporarily busy. Please retry in a moment.';
    }
    if (inner?.message) {
      return inner.message;
    }
  } catch {
    // Not raw JSON
  }
  if (/RESOURCE_EXHAUSTED|429/i.test(raw)) {
    return 'AI request rate limit reached right now. Please wait a few seconds and try again.';
  }
  if (/UNAVAILABLE|503|high demand/i.test(raw)) {
    return 'AI service is temporarily busy. Please retry in a moment.';
  }
  return raw.length > 220 ? fallbackMessage : raw;
}

function isRetryableGeminiError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || '');
  return /503|UNAVAILABLE|429|RESOURCE_EXHAUSTED|500|INTERNAL|high demand|fetch failed|ECONNRESET/i.test(
    msg
  );
}

async function generateTextWithFallback(
  ai: GoogleGenAI,
  params: {
    contents: Parameters<GoogleGenAI['models']['generateContent']>[0]['contents'];
    systemInstruction: string;
    thinkingLevel?: ThinkingLevel;
  }
) {
  const delays = [0, 450, 1000];
  let lastError: unknown;

  for (let i = 0; i < delays.length; i++) {
    if (delays[i] > 0) await sleep(delays[i]);
    try {
      return await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: params.contents,
        config: {
          ...(params.thinkingLevel
            ? { thinkingConfig: { thinkingLevel: params.thinkingLevel } }
            : {}),
          systemInstruction: params.systemInstruction,
        },
      });
    } catch (err) {
      lastError = err;
      if (!isRetryableGeminiError(err)) {
        throw err;
      }
    }
  }

  // Fallback to Gemini Flash Lite when gemini-4-hydrogen is overloaded/rate-limited
  try {
    return await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents: params.contents,
      config: {
        systemInstruction: params.systemInstruction,
      },
    });
  } catch (fallbackErr) {
    throw fallbackErr || lastError;
  }
}

function parseCookies(cookieHeader?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = decodeURIComponent(part.slice(idx + 1).trim());
      out[k] = v;
    }
  }
  return out;
}

function getSessionCookieOptions(req: Request) {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const isHttps =
    req.secure ||
    (typeof forwardedProto === 'string' && forwardedProto.split(',')[0].trim() === 'https') ||
    isProduction;
  return {
    httpOnly: true,
    sameSite: (isHttps ? 'none' : 'lax') as 'none' | 'lax',
    secure: isHttps,
    path: '/',
  };
}

function setSessionCookie(req: Request, res: Response, token: string) {
  res.cookie(SESSION_COOKIE_NAME, token, {
    ...getSessionCookieOptions(req),
    maxAge: 1000 * 60 * 60 * 24 * 30,
  });
}

function extractHeaderSessionToken(req: Request): string | null {
  const raw = req.headers['x-session-token'];
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (Array.isArray(raw) && raw[0]?.trim()) return raw[0].trim();
  return null;
}

interface AuthedRequest extends Request {
  currentUser?: UserProfile;
  sessionToken?: string;
}

async function resolveUserFromRequest(
  req: Request
): Promise<{ user: UserProfile; token: string } | null> {
  const headerToken = extractHeaderSessionToken(req);
  if (headerToken) {
    const user = await getUserBySessionToken(headerToken);
    if (user) return { user, token: headerToken };
  }

  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = cookies[SESSION_COOKIE_NAME];
  if (cookieToken) {
    const user = await getUserBySessionToken(cookieToken);
    if (user) return { user, token: cookieToken };
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const idToken = authHeader.slice('Bearer '.length).trim();
    if (idToken) {
      try {
        const decoded = await adminAuth.verifyIdToken(idToken);
        const synced = await upsertGoogleUser({
          uid: decoded.uid,
          email: decoded.email || `${decoded.uid}@google.user`,
          displayName: decoded.name || decoded.email?.split('@')[0] || 'Google User',
          role: 'recipient',
          avatarUrl: decoded.picture,
        });
        return { user: synced.user, token: synced.token };
      } catch {
        return null;
      }
    }
  }

  return null;
}

async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const resolved = await resolveUserFromRequest(req);
    if (!resolved) {
      res.status(401).json({ error: 'Authentication required. Please sign in.' });
      return;
    }
    req.currentUser = resolved.user;
    req.sessionToken = resolved.token;
    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    res.status(500).json({ error: 'Unable to verify authentication session.' });
  }
}

const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/api/config', (_req, res) => {
  res.json({
    mapsApiKey:
      process.env.VITE_GOOGLE_MAPS_API_KEY ||
      process.env.GOOGLE_MAPS_API_KEY ||
      '',
  });
});

// Authentication & Account Routes
app.get('/api/auth/me', async (req, res) => {
  try {
    const resolved = await resolveUserFromRequest(req);
    if (!resolved) {
      res.json({
        user: null,
        screenings: [],
        unlockedDonorIds: [],
        paymentReceipts: [],
        sessionToken: null,
      });
      return;
    }
    setSessionCookie(req, res, resolved.token);
    const [savedScreenings, unlockedDonorIds, paymentReceipts] = await Promise.all([
      getUserScreenings(resolved.user.id),
      getUnlockedDonorIds(resolved.user.id),
      getUserPaymentReceipts(resolved.user.id),
    ]);
    res.json({
      user: resolved.user,
      screenings: savedScreenings,
      unlockedDonorIds,
      paymentReceipts,
      sessionToken: resolved.token,
    });
  } catch (err) {
    console.error('GET /api/auth/me error:', err);
    res.status(500).json({ error: 'Could not verify session.' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, role, displayName, bloodType } = req.body as {
      email?: string;
      password?: string;
      role?: UserRole;
      displayName?: string;
      bloodType?: BloodType;
    };

    const check = validateCredentials(email || '', password || '');
    if (!check.valid) {
      res.status(400).json({ error: check.error });
      return;
    }

    const userRole: UserRole = role === 'donor' ? 'donor' : 'recipient';
    const result = await registerOrLoginEmailUser({
      email: email!,
      password: password!,
      role: userRole,
      displayName,
      bloodType,
      mode: 'register',
    });

    setSessionCookie(req, res, result.token);
    const [savedScreenings, unlockedDonorIds] = await Promise.all([
      getUserScreenings(result.user.id),
      getUnlockedDonorIds(result.user.id),
    ]);
    res.status(201).json({
      user: result.user,
      screenings: savedScreenings,
      unlockedDonorIds,
      sessionToken: result.token,
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'EMAIL_EXISTS') {
      res.status(409).json({
        error: 'An account with this email already exists. Please sign in instead.',
      });
      return;
    }
    console.error('Register error:', err);
    res.status(500).json({ error: 'Account creation failed.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, role } = req.body as {
      email?: string;
      password?: string;
      role?: UserRole;
    };

    const check = validateCredentials(email || '', password || '');
    if (!check.valid) {
      res.status(400).json({ error: check.error });
      return;
    }

    const result = await registerOrLoginEmailUser({
      email: email!,
      password: password!,
      role: role === 'donor' ? 'donor' : 'recipient',
      mode: 'login',
    });

    let activeUser = result.user;
    let activeToken = result.token;
    if (role && (role === 'donor' || role === 'recipient') && activeUser.role !== role) {
      activeUser = await updateUserRole(activeUser.id, role);
      activeToken = await createSession(activeUser.id, activeUser);
    }

    setSessionCookie(req, res, activeToken);
    const [savedScreenings, unlockedDonorIds] = await Promise.all([
      getUserScreenings(activeUser.id),
      getUnlockedDonorIds(activeUser.id),
    ]);
    res.json({
      user: activeUser,
      screenings: savedScreenings,
      unlockedDonorIds,
      sessionToken: activeToken,
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'INVALID_CREDENTIALS') {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }
    console.error('Login error:', err);
    res.status(500).json({ error: 'Sign in failed.' });
  }
});

app.post('/api/auth/google', async (req, res) => {
  try {
    const { idToken, role, avatarUrl } = req.body as {
      idToken?: string;
      role?: UserRole;
      avatarUrl?: string;
    };
    if (!idToken) {
      res.status(400).json({ error: 'Missing Google ID token.' });
      return;
    }

    const decoded = await adminAuth.verifyIdToken(idToken);
    const userRole: UserRole = role === 'donor' ? 'donor' : 'recipient';
    const result = await upsertGoogleUser({
      uid: decoded.uid,
      email: decoded.email || `${decoded.uid}@google.user`,
      displayName: decoded.name || decoded.email?.split('@')[0] || 'Google User',
      role: userRole,
      avatarUrl: decoded.picture || avatarUrl,
    });

    setSessionCookie(req, res, result.token);
    const [savedScreenings, unlockedDonorIds] = await Promise.all([
      getUserScreenings(result.user.id),
      getUnlockedDonorIds(result.user.id),
    ]);
    res.json({
      user: result.user,
      screenings: savedScreenings,
      unlockedDonorIds,
      sessionToken: result.token,
    });
  } catch (err) {
    console.error('Google auth error:', err);
    res.status(401).json({ error: 'Could not verify Google authentication token.' });
  }
});

app.post('/api/auth/demo', async (req, res) => {
  try {
    const result = await getOrCreateDemoUser();
    setSessionCookie(req, res, result.token);
    const [savedScreenings, unlockedDonorIds] = await Promise.all([
      getUserScreenings(result.user.id),
      getUnlockedDonorIds(result.user.id),
    ]);
    res.json({
      user: result.user,
      screenings: savedScreenings,
      unlockedDonorIds,
      sessionToken: result.token,
    });
  } catch (err) {
    console.error('Demo auth error:', err);
    res.status(500).json({ error: 'Could not initialize demo session.' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    const cookies = parseCookies(req.headers.cookie);
    const cookieToken = cookies[SESSION_COOKIE_NAME];
    const headerToken = extractHeaderSessionToken(req);
    if (cookieToken) {
      await deleteSession(cookieToken);
    }
    if (headerToken && headerToken !== cookieToken) {
      await deleteSession(headerToken);
    }
    res.clearCookie(SESSION_COOKIE_NAME, getSessionCookieOptions(req));
    res.json({ ok: true });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ error: 'Sign out failed.' });
  }
});

app.patch('/api/me/role', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const { role } = req.body as { role?: UserRole };
    if (role !== 'donor' && role !== 'recipient') {
      res.status(400).json({ error: 'Role must be donor or recipient.' });
      return;
    }
    const updated = await updateUserRole(req.currentUser!.id, role);
    const sessionToken = await createSession(updated.id, updated);
    setSessionCookie(req, res, sessionToken);
    res.json({ user: updated, sessionToken });
  } catch (err) {
    console.error('Role update error:', err);
    res.status(500).json({ error: 'Could not switch role.' });
  }
});

app.patch('/api/me/profile', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const { bloodType, neighborhood, displayName, avatarUrl } = req.body as {
      bloodType?: BloodType;
      neighborhood?: string;
      displayName?: string;
      avatarUrl?: string | null;
    };
    const updated = await updateUserProfile(req.currentUser!.id, {
      bloodType,
      neighborhood,
      displayName,
      avatarUrl,
    });
    const sessionToken = await createSession(updated.id, updated);
    setSessionCookie(req, res, sessionToken);
    res.json({ user: updated, sessionToken });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Could not update profile.' });
  }
});

// Core Network State & Donor Discovery
app.get('/api/state', async (_req, res) => {
  try {
    const state = await getAllNetworkState();
    res.json(state);
  } catch (err) {
    console.error('GET /api/state error:', err);
    res.status(500).json({ error: 'Failed to load live network state.' });
  }
});

app.post('/api/donors/localize', async (req, res) => {
  try {
    const { lat, lng } = req.body as { lat?: number; lng?: number };
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      res.status(400).json({ error: 'Valid latitude and longitude required.' });
      return;
    }
    const added = await ensureLocalDonorsAround({ lat, lng });
    for (const donor of added) {
      broadcastChatEvent({ type: 'donor:added', donor });
    }
    res.json({ added });
  } catch (err) {
    console.error('Localize donors error:', err);
    res.status(500).json({ error: 'Could not localize nearby donors.' });
  }
});

// Persistent Screening Form Submission (always stored in Cloud SQL)
app.get('/api/screenings', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const items = await getUserScreenings(req.currentUser!.id);
    res.json({ screenings: items });
  } catch (err) {
    console.error('GET /api/screenings error:', err);
    res.status(500).json({ error: 'Could not load screening history.' });
  }
});

app.post('/api/screenings', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const {
      bloodType,
      neighborhood,
      availabilityWindow,
      lat,
      lng,
      screeningAnswers,
      publishDonor,
    } = req.body as {
      bloodType?: BloodType;
      neighborhood?: string;
      availabilityWindow?: string;
      lat?: number;
      lng?: number;
      screeningAnswers?: ScreeningAnswers;
      publishDonor?: boolean;
    };

    if (!screeningAnswers) {
      res.status(400).json({ error: 'Screening questionnaire responses are required.' });
      return;
    }

    const evaluation = evaluateScreening(screeningAnswers);
    if (evaluation.status === 'incomplete') {
      res.status(400).json({
        error: 'Please complete every screening question before saving.',
        evaluation,
      });
      return;
    }

    const baseLat = typeof lat === 'number' && Number.isFinite(lat) ? lat : DEFAULT_CENTER.lat;
    const baseLng = typeof lng === 'number' && Number.isFinite(lng) ? lng : DEFAULT_CENTER.lng;

    const saved = await saveScreeningAndOptionalDonor({
      userId: req.currentUser!.id,
      bloodType: bloodType || req.currentUser!.bloodType || 'B+',
      neighborhood: neighborhood?.trim() || req.currentUser!.neighborhood || 'Local Zone',
      availabilityWindow: availabilityWindow?.trim() || 'Available today',
      evaluation,
      answers: screeningAnswers,
      publishDonor: Boolean(publishDonor) && evaluation.status === 'eligible',
      lat: baseLat,
      lng: baseLng,
    });

    if (saved.donor) {
      broadcastChatEvent({ type: 'donor:added', donor: saved.donor });
    }

    res.status(201).json({
      evaluation,
      screening: saved.screening,
      donor: saved.donor,
    });
  } catch (err) {
    console.error('POST /api/screenings error:', err);
    res.status(500).json({ error: 'Could not save screening submission.' });
  }
});

app.get('/api/payments', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const receipts = await getUserPaymentReceipts(req.currentUser!.id);
    res.json({ receipts });
  } catch (err) {
    console.error('GET /api/payments error:', err);
    res.status(500).json({ error: 'Could not load payment receipts.' });
  }
});

app.post('/api/donors/:donorId/unlock', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const donorId = String(req.params.donorId || '').trim();
    const { paymentMethod, paymentDetails, amountInr } = req.body as {
      paymentMethod?: string;
      paymentDetails?: string;
      amountInr?: number;
    };
    if (!donorId) {
      res.status(400).json({ error: 'donorId is required.' });
      return;
    }
    const fee = Number(amountInr) || 50;
    if (fee < 50) {
      res.status(400).json({ error: 'Minimum ₹50 payment is required to unlock donor chat.' });
      return;
    }

    const result = await unlockDonorChatForUser({
      userId: req.currentUser!.id,
      donorId,
      amountInr: 50,
      paymentMethod: paymentMethod || 'UPI',
      paymentDetails,
    });

    res.json(result);
  } catch (err) {
    if (err instanceof Error && err.message === 'DONOR_NOT_FOUND') {
      res.status(404).json({ error: 'Selected donor not found.' });
      return;
    }
    console.error('POST /api/donors/:donorId/unlock error:', err);
    res.status(500).json({ error: 'Could not process ₹50 unlock fee.' });
  }
});

app.post('/api/threads', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const { donorId, requestedBloodType, urgency } = req.body as {
      donorId?: string;
      requestedBloodType?: BloodType;
      urgency?: 'routine' | 'urgent';
    };

    if (!donorId) {
      res.status(400).json({ error: 'donorId is required.' });
      return;
    }

    const unlocked = await isDonorUnlockedForUser(req.currentUser!.id, donorId);
    if (!unlocked) {
      res.status(402).json({
        error: 'Please pay ₹50 to unlock and open chat access with this donor.',
        code: 'PAYMENT_REQUIRED',
      });
      return;
    }

    const result = await createOrGetThread({
      donorId,
      requestedBloodType,
      urgency,
      createdByUserId: req.currentUser!.id,
    });

    if (result.created) {
      broadcastChatEvent({ type: 'thread:created', thread: result.thread });
    }

    res.status(result.created ? 201 : 200).json({ thread: result.thread });
  } catch (err) {
    if (err instanceof Error && err.message === 'DONOR_NOT_FOUND') {
      res.status(404).json({ error: 'Selected donor not found.' });
      return;
    }
    console.error('POST /api/threads error:', err);
    res.status(500).json({ error: 'Could not open thread.' });
  }
});

app.post('/api/messages', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const { threadId, text, senderRole } = req.body as {
      threadId?: string;
      text?: string;
      senderRole?: UserRole;
    };
    if (!threadId || !text?.trim()) {
      res.status(400).json({ error: 'threadId and message text are required.' });
      return;
    }

    const user = req.currentUser!;
    const threadDonorId = await getThreadDonorId(threadId);
    if (threadDonorId) {
      const unlocked = await isDonorUnlockedForUser(user.id, threadDonorId);
      if (!unlocked) {
        res.status(402).json({
          error: 'Please pay ₹50 to unlock chat access before sending messages.',
          code: 'PAYMENT_REQUIRED',
        });
        return;
      }
    }

    const effectiveRole: UserRole =
      senderRole === 'donor' || senderRole === 'recipient' ? senderRole : user.role;
    const senderLabel = generateAnonymousSenderLabel(
      effectiveRole,
      user.id,
      user.bloodType
    );

    const saved = await appendChatMessage({
      threadId,
      senderUserId: user.id,
      senderRole: effectiveRole,
      senderLabel,
      text: text.trim(),
    });

    if (!saved) {
      res.status(404).json({ error: 'Thread not found.' });
      return;
    }

    broadcastChatEvent({ type: 'chat:message', message: saved });
    res.status(201).json({ message: saved });
  } catch (err) {
    console.error('POST /api/messages error:', err);
    res.status(500).json({ error: 'Could not send message.' });
  }
});

app.post('/api/requests', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const { bloodType, facilityZone, unitsNeeded, note, lat, lng } = req.body as {
      bloodType?: BloodType;
      facilityZone?: string;
      unitsNeeded?: number;
      note?: string;
      lat?: number;
      lng?: number;
    };

    if (!bloodType || !facilityZone?.trim()) {
      res.status(400).json({ error: 'Blood type and hospital/clinic zone are required.' });
      return;
    }

    const request = await createUrgentRequestRecord({
      userId: req.currentUser!.id,
      bloodType,
      facilityZone,
      unitsNeeded: Number(unitsNeeded) || 1,
      note: note || 'Hospital blood bank check-in required',
      lat: typeof lat === 'number' && Number.isFinite(lat) ? lat : DEFAULT_CENTER.lat,
      lng: typeof lng === 'number' && Number.isFinite(lng) ? lng : DEFAULT_CENTER.lng,
    });

    broadcastChatEvent({ type: 'request:added', request });
    res.status(201).json({ request });
  } catch (err) {
    console.error('POST /api/requests error:', err);
    res.status(500).json({ error: 'Could not publish blood request.' });
  }
});

// AI Health Chat (Persisted in Cloud SQL + Gemini 4 Hydrogen)
app.get('/api/ai/health-chat', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const history = await getAiHealthHistory(req.currentUser!.id);
    res.json({ messages: history });
  } catch (err) {
    console.error('GET /api/ai/health-chat error:', err);
    res.status(500).json({ error: 'Could not load health chat history.' });
  }
});

app.post('/api/ai/health-chat', requireAuth, async (req: AuthedRequest, res) => {
  const { message } = req.body as { message?: string };
  if (!message?.trim()) {
    res.status(400).json({ error: 'Please enter a health question.' });
    return;
  }

  const ai = createGeminiClient();
  if (!ai) {
    res.status(503).json({
      error: 'GEMINI_API_KEY is not configured in environment secrets.',
    });
    return;
  }

  try {
    const user = req.currentUser!;
    const priorHistory = await getAiHealthHistory(user.id);
    const savedUserMsg = await appendAiHealthMessage({
      userId: user.id,
      role: 'user',
      text: message.trim().slice(0, 1200),
    });

    const recentTurns = priorHistory.slice(-10).map((m) => ({
      role: (m.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
      parts: [{ text: m.text }],
    }));

    const userQuestionWithContext = `[Member Profile: Role=${user.role}, Blood Group=${user.bloodType}]\nQuestion: ${message.trim()}`;

    const response = await generateTextWithFallback(ai, {
      contents: [
        ...recentTurns,
        {
          role: 'user',
          parts: [{ text: userQuestionWithContext }],
        },
      ],
      thinkingLevel: ThinkingLevel.MEDIUM,
      systemInstruction:
        'You are RaktSetu Health AI, a medically accurate clinical health and blood-donation guidance assistant.\n' +
        'Rules for every response:\n' +
        '1. Answer the exact question the user asked directly and specifically in your opening 1-2 sentences. Never give vague or off-topic boilerplate.\n' +
        '2. Provide accurate, evidence-based facts tailored to the exact topic (for example: hemoglobin thresholds >=12.5 g/dL female / >=13.0 g/dL male, 56-day whole-blood donation spacing, ABO/Rh compatibility, iron absorption pairing with vitamin C and avoiding tea/coffee with iron meals, NSAIDs/aspirin vs antibiotic rules for donors, hydration/electrolyte recovery for post-donation dizziness, or symptom-specific care).\n' +
        '3. Format cleanly in plain text without Markdown symbols (do NOT use **, __, or #). Use concise, readable labels like "Direct Answer:", "Practical Tips:", and "Important Concerns & When to Seek Care:".\n' +
        '4. Keep answers focused, accurate, and around 120–240 words unless a multi-part question needs slightly more detail. Always mention red-flag symptoms requiring urgent medical care and remind the user that a licensed clinician or blood bank physician makes final medical decisions.',
    });

    const replyText =
      response.text?.trim() ||
      'I could not generate guidance for that query. Please consult a licensed clinician.';

    const savedAssistantMsg = await appendAiHealthMessage({
      userId: user.id,
      role: 'assistant',
      text: replyText,
    });

    res.json({
      userMessage: savedUserMsg,
      assistantMessage: savedAssistantMsg,
    });
  } catch (err) {
    console.error('AI health chat error:', err);
    res.status(500).json({
      error: formatGeminiError(err, 'Health assistant request failed. Please try again.'),
    });
  }
});

// Gemini TTS endpoint using gemini-3.8-flash-lite-tts
app.post('/api/ai/tts', async (req, res) => {
  const { text, style } = req.body as { text?: string; style?: string };
  if (!text?.trim()) {
    res.status(400).json({ error: 'Text is required for speech synthesis.' });
    return;
  }

  const ai = createGeminiClient();
  if (!ai) {
    res.status(503).json({
      error: 'GEMINI_API_KEY is not configured in environment secrets.',
    });
    return;
  }

  try {
    const cleanText = text.trim().slice(0, 1200);
    let response;
    try {
      response = await ai.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: cleanText,
                speechMetadata: {
                  style: style || 'Calm, clear, reassuring medical coordinator',
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });
    } catch {
      const alphaAi = createGeminiClient('v1alpha') || ai;
      response = await alphaAi.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [
          {
            role: 'user',
            parts: [{ text: cleanText }],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });
    }

    const base64Audio =
      response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

    if (!base64Audio) {
      res.status(502).json({ error: 'No audio returned from speech model.' });
      return;
    }

    res.json({
      audioBase64: base64Audio,
      mimeType: 'audio/wav',
    });
  } catch (err) {
    res.status(503).json({
      code: 'TTS_UNAVAILABLE',
      error: formatGeminiError(err, 'Cloud TTS unavailable right now.'),
    });
  }
});

// Gemini Search Grounding endpoint with automatic resilient fallback
app.post('/api/ai/guidance', async (req, res) => {
  const { query } = req.body as { query?: string };
  if (!query?.trim()) {
    res.status(400).json({ error: 'A question is required.' });
    return;
  }

  const ai = createGeminiClient();
  if (!ai) {
    res.status(503).json({
      error: 'GEMINI_API_KEY is not configured in environment secrets.',
    });
    return;
  }

  const systemInstruction =
    'You are the RaktSetu blood donation clinical guidelines assistant. Answer the exact question directly using authoritative blood bank standards (Red Cross, AABB, WHO, FDA, NBTC). Do not use markdown asterisks or headings. Always note that final eligibility is determined by licensed collection staff on site. Keep responses clear, accurate, and under 190 words.';

  try {
    let response;
    try {
      response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: query.trim(),
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction,
          tools: [{ googleSearch: {} }],
        },
      });
    } catch (searchErr) {
      if (!isRetryableGeminiError(searchErr)) {
        throw searchErr;
      }
      // If search-grounding quota or capacity is temporarily saturated, answer directly via Gemini
      response = await generateTextWithFallback(ai, {
        contents: query.trim(),
        thinkingLevel: ThinkingLevel.LOW,
        systemInstruction,
      });
    }

    const rawChunks =
      response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const sources: GroundingSource[] = [];
    const seenUris = new Set<string>();

    for (const chunk of rawChunks) {
      const uri = chunk.web?.uri;
      const title = chunk.web?.title;
      if (uri && !seenUris.has(uri)) {
        seenUris.add(uri);
        sources.push({
          title: title || uri,
          uri,
        });
      }
    }

    res.json({
      answer: response.text || 'No guidance text returned.',
      sources,
    });
  } catch (err) {
    res.status(500).json({
      error: formatGeminiError(err, 'Failed to fetch clinical guidance.'),
    });
  }
});

// Google Workspace Proxy Routes (Gmail + Google Chat using client OAuth Bearer token)
function extractWorkspaceBearer(req: Request): string | null {
  const header =
    (req.headers['x-workspace-token'] as string | undefined) ||
    req.headers.authorization;
  if (!header) return null;
  if (header.startsWith('Bearer ')) return header;
  return `Bearer ${header}`;
}

app.get('/api/workspace/gmail/messages', requireAuth, async (req, res) => {
  const bearer = extractWorkspaceBearer(req);
  if (!bearer) {
    res.status(401).json({ error: 'Google Workspace OAuth token required.' });
    return;
  }

  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    listUrl.searchParams.set('maxResults', '8');
    if (q) listUrl.searchParams.set('q', q);

    const listRes = await fetch(listUrl.toString(), {
      headers: { Authorization: bearer },
    });
    const listJson = (await listRes.json()) as {
      messages?: Array<{ id: string; threadId: string }>;
      error?: { message?: string };
    };

    if (!listRes.ok) {
      res.status(listRes.status).json({
        error: listJson.error?.message || 'Unable to load Gmail inbox.',
      });
      return;
    }

    const messageRefs = listJson.messages || [];
    const details = await Promise.all(
      messageRefs.slice(0, 8).map(async (item) => {
        const msgRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
          { headers: { Authorization: bearer } }
        );
        if (!msgRes.ok) return null;
        const msgData = (await msgRes.json()) as {
          id: string;
          threadId: string;
          snippet?: string;
          payload?: {
            headers?: Array<{ name: string; value: string }>;
          };
        };
        const headers = msgData.payload?.headers || [];
        const getHeader = (name: string) =>
          headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

        return {
          id: msgData.id,
          threadId: msgData.threadId,
          subject: getHeader('Subject') || '(No subject)',
          from: getHeader('From') || 'Unknown sender',
          date: getHeader('Date') || '',
          snippet: msgData.snippet || '',
        };
      })
    );

    res.json({ messages: details.filter(Boolean) });
  } catch (err) {
    console.error('Gmail list error:', err);
    res.status(500).json({ error: 'Failed to communicate with Gmail API.' });
  }
});

app.post('/api/workspace/gmail/send', requireAuth, async (req, res) => {
  const bearer = extractWorkspaceBearer(req);
  if (!bearer) {
    res.status(401).json({ error: 'Google Workspace OAuth token required.' });
    return;
  }

  const { to, subject, body } = req.body as {
    to?: string;
    subject?: string;
    body?: string;
  };
  if (!to?.trim() || !subject?.trim() || !body?.trim()) {
    res.status(400).json({ error: 'Recipient email, subject, and message body are required.' });
    return;
  }

  try {
    const rawEmail = [
      `To: ${to.trim()}`,
      `Subject: ${subject.trim()}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'MIME-Version: 1.0',
      '',
      body.trim(),
    ].join('\r\n');

    const encoded = Buffer.from(rawEmail, 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const sendRes = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        method: 'POST',
        headers: {
          Authorization: bearer,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw: encoded }),
      }
    );

    const sendJson = (await sendRes.json()) as {
      id?: string;
      error?: { message?: string };
    };

    if (!sendRes.ok) {
      res.status(sendRes.status).json({
        error: sendJson.error?.message || 'Failed to send Gmail message.',
      });
      return;
    }

    res.status(201).json({ id: sendJson.id });
  } catch (err) {
    console.error('Gmail send error:', err);
    res.status(500).json({ error: 'Failed to send email via Gmail.' });
  }
});

app.get('/api/workspace/chat/spaces', requireAuth, async (req, res) => {
  const bearer = extractWorkspaceBearer(req);
  if (!bearer) {
    res.status(401).json({ error: 'Google Workspace OAuth token required.' });
    return;
  }

  try {
    const chatRes = await fetch('https://chat.googleapis.com/v1/spaces?pageSize=20', {
      headers: { Authorization: bearer },
    });
    const chatJson = (await chatRes.json()) as {
      spaces?: Array<{ name: string; displayName?: string; spaceType?: string }>;
      error?: { message?: string; status?: string };
    };

    if (!chatRes.ok) {
      res.status(chatRes.status).json({
        error: chatJson.error?.message || 'Unable to load Google Chat spaces.',
        code: chatJson.error?.status || String(chatRes.status),
      });
      return;
    }

    res.json({
      spaces: (chatJson.spaces || []).map((s) => ({
        name: s.name,
        displayName: s.displayName || s.name,
        spaceType: s.spaceType,
      })),
    });
  } catch (err) {
    console.error('Google Chat spaces error:', err);
    res.status(500).json({ error: 'Failed to communicate with Google Chat API.' });
  }
});

app.get('/api/workspace/chat/spaces/:spaceId/messages', requireAuth, async (req, res) => {
  const bearer = extractWorkspaceBearer(req);
  if (!bearer) {
    res.status(401).json({ error: 'Google Workspace OAuth token required.' });
    return;
  }

  try {
    const spaceId = String(req.params.spaceId);
    const chatRes = await fetch(
      `https://chat.googleapis.com/v1/spaces/${encodeURIComponent(spaceId)}/messages?pageSize=20&orderBy=createTime desc`,
      { headers: { Authorization: bearer } }
    );
    const chatJson = (await chatRes.json()) as {
      messages?: Array<{
        name: string;
        text?: string;
        createTime?: string;
        sender?: { name?: string; displayName?: string; type?: string };
      }>;
      error?: { message?: string };
    };

    if (!chatRes.ok) {
      res.status(chatRes.status).json({
        error: chatJson.error?.message || 'Unable to load space messages.',
      });
      return;
    }

    res.json({
      messages: (chatJson.messages || [])
        .map((m) => ({
          name: m.name,
          text: m.text || '',
          createTime: m.createTime,
          sender: m.sender,
        }))
        .reverse(),
    });
  } catch (err) {
    console.error('Google Chat list messages error:', err);
    res.status(500).json({ error: 'Failed to load Google Chat messages.' });
  }
});

app.post('/api/workspace/chat/spaces/:spaceId/messages', requireAuth, async (req, res) => {
  const bearer = extractWorkspaceBearer(req);
  if (!bearer) {
    res.status(401).json({ error: 'Google Workspace OAuth token required.' });
    return;
  }

  const { text } = req.body as { text?: string };
  if (!text?.trim()) {
    res.status(400).json({ error: 'Message text is required.' });
    return;
  }

  try {
    const spaceId = String(req.params.spaceId);
    const chatRes = await fetch(
      `https://chat.googleapis.com/v1/spaces/${encodeURIComponent(spaceId)}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: bearer,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: text.trim() }),
      }
    );
    const chatJson = (await chatRes.json()) as {
      name?: string;
      text?: string;
      createTime?: string;
      error?: { message?: string };
    };

    if (!chatRes.ok) {
      res.status(chatRes.status).json({
        error: chatJson.error?.message || 'Failed to post to Google Chat.',
      });
      return;
    }

    res.status(201).json({ message: chatJson });
  } catch (err) {
    console.error('Google Chat send error:', err);
    res.status(500).json({ error: 'Failed to send Google Chat message.' });
  }
});

const server = http.createServer(app);

// WebSocket servers attached to the shared HTTP server on port 3000
const chatWss = new WebSocketServer({ noServer: true });
const liveWss = new WebSocketServer({ noServer: true });

function broadcastChatEvent(payload: unknown) {
  const serialized = JSON.stringify(payload);
  for (const client of chatWss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(serialized);
    }
  }
}

function broadcastPresenceCount() {
  broadcastChatEvent({
    type: 'presence:update',
    connectedClients: chatWss.clients.size,
  });
}

function extractWsSessionToken(request: http.IncomingMessage): string | null {
  try {
    const parsedUrl = new URL(request.url || '/', 'http://localhost');
    const queryToken = parsedUrl.searchParams.get('token');
    if (queryToken && queryToken.trim()) return queryToken.trim();
  } catch {
    // Fallback to cookies
  }
  const cookies = parseCookies(request.headers.cookie);
  return cookies[SESSION_COOKIE_NAME] || null;
}

chatWss.on('connection', async (ws, request) => {
  let socketUser: UserProfile | null = null;
  try {
    const token = extractWsSessionToken(request);
    if (token) {
      socketUser = await getUserBySessionToken(token);
    }
    const state = await getAllNetworkState();
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'init',
          donors: state.donors,
          threads: state.threads,
          urgentRequests: state.urgentRequests,
          connectedClients: chatWss.clients.size,
        })
      );
    }
  } catch (err) {
    console.error('WS chat init error:', err);
  }
  broadcastPresenceCount();

  ws.on('message', async (raw) => {
    try {
      const data = JSON.parse(raw.toString()) as {
        type?: string;
        threadId?: string;
        senderRole?: UserRole;
        text?: string;
      };

      if (data.type === 'chat:send' && data.threadId && data.text?.trim()) {
        // Re-fetch user in case their role was switched in Settings
        const token = extractWsSessionToken(request);
        if (token) {
          socketUser = await getUserBySessionToken(token);
        }

        if (socketUser) {
          const threadDonorId = await getThreadDonorId(data.threadId);
          if (threadDonorId) {
            const unlocked = await isDonorUnlockedForUser(socketUser.id, threadDonorId);
            if (!unlocked) {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(
                  JSON.stringify({
                    type: 'chat:error',
                    error: 'Please pay ₹50 to unlock chat access before sending messages.',
                  })
                );
              }
              return;
            }
          }
        }

        const role: UserRole =
          data.senderRole === 'donor' || data.senderRole === 'recipient'
            ? data.senderRole
            : socketUser?.role || 'recipient';

        const senderLabel = socketUser
          ? generateAnonymousSenderLabel(role, socketUser.id, socketUser.bloodType)
          : role === 'donor'
            ? 'Donor #LIVE'
            : 'Recipient #LIVE';

        const saved = await appendChatMessage({
          threadId: data.threadId,
          senderUserId: socketUser?.id ?? null,
          senderRole: role,
          senderLabel,
          text: data.text.trim().slice(0, 800),
        });

        if (saved) {
          broadcastChatEvent({ type: 'chat:message', message: saved });
        }
      }
    } catch (err) {
      console.error('WS chat message error:', err);
    }
  });

  ws.on('close', () => {
    broadcastPresenceCount();
  });
});

// Gemini Live API WebSocket bridge (/ws/live) using gemini-3.8-live with resilient coordinator fallback
liveWss.on('connection', async (clientWs) => {
  const ai = createGeminiClient();
  if (!ai) {
    clientWs.send(
      JSON.stringify({
        error: 'GEMINI_API_KEY is not configured in environment secrets.',
      })
    );
    clientWs.close();
    return;
  }

  let liveSession: Awaited<ReturnType<typeof ai.live.connect>> | null = null;
  let closed = false;
  let textAssistedMode = false;
  const liveHistory: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

  const liveSystemPrompt =
    'You are the RaktSetu Blood Donation Voice Coordinator. Help users understand ABO/Rh blood type compatibility (such as B+ recipients accepting B+, B-, O+, and O- donors), pre-donation hydration and iron prep, temporary deferral timelines (56 days between whole blood donations, 14 days symptom-free after illness), and safe anonymous coordination at accredited hospital donor centers. Keep responses warm, concise, plain text without markdown asterisks, and practical.';

  try {
    const liveClient = createGeminiClient('v1alpha') || ai;
    liveSession = await liveClient.live.connect({
      model: 'gemini-3.8-live',
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Zephyr' },
          },
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        systemInstruction: liveSystemPrompt,
      },
      callbacks: {
        onopen: () => {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ ready: true }));
          }
        },
        onmessage: (message: LiveServerMessage) => {
          if (clientWs.readyState !== WebSocket.OPEN) return;
          const content = message.serverContent;

          if (content?.inputTranscription?.text) {
            clientWs.send(
              JSON.stringify({ inputTranscript: content.inputTranscription.text })
            );
          }
          if (content?.outputTranscription?.text) {
            clientWs.send(
              JSON.stringify({ outputTranscript: content.outputTranscription.text })
            );
          }
          for (const part of content?.modelTurn?.parts ?? []) {
            if (part.inlineData?.data) {
              clientWs.send(JSON.stringify({ audio: part.inlineData.data }));
            }
          }
          if (content?.interrupted) {
            clientWs.send(JSON.stringify({ interrupted: true }));
          }
          if (content?.turnComplete) {
            clientWs.send(JSON.stringify({ turnComplete: true }));
          }
        },
        onerror: () => {
          // If upstream native Live WS fails setup, seamlessly switch to interactive text+voice coordinator
          if (!closed && !textAssistedMode && clientWs.readyState === WebSocket.OPEN) {
            textAssistedMode = true;
            liveSession = null;
            clientWs.send(JSON.stringify({ ready: true, mode: 'text-assisted' }));
          }
        },
        onclose: () => {
          if (!closed && !textAssistedMode && clientWs.readyState === WebSocket.OPEN) {
            textAssistedMode = true;
            liveSession = null;
            clientWs.send(JSON.stringify({ ready: true, mode: 'text-assisted' }));
          }
        },
      },
    });
  } catch {
    if (!closed && clientWs.readyState === WebSocket.OPEN) {
      textAssistedMode = true;
      liveSession = null;
      clientWs.send(JSON.stringify({ ready: true, mode: 'text-assisted' }));
    }
  }

  clientWs.on('message', async (raw) => {
    try {
      const payload = JSON.parse(raw.toString()) as {
        audio?: string;
        text?: string;
      };
      if (liveSession && !textAssistedMode) {
        if (payload.audio) {
          liveSession.sendRealtimeInput({
            audio: { data: payload.audio, mimeType: 'audio/pcm;rate=16000' },
          });
        } else if (payload.text) {
          liveSession.sendRealtimeInput({ text: payload.text });
        }
      } else if (textAssistedMode && payload.text?.trim()) {
        const promptText = payload.text.trim().slice(0, 800);
        const resp = await generateTextWithFallback(ai, {
          contents: [
            ...liveHistory.slice(-6),
            { role: 'user', parts: [{ text: promptText }] },
          ],
          thinkingLevel: ThinkingLevel.LOW,
          systemInstruction: liveSystemPrompt,
        });
        const answer =
          resp.text?.trim() || 'Please consult an accredited blood center coordinator.';
        liveHistory.push({ role: 'user', parts: [{ text: promptText }] });
        liveHistory.push({ role: 'model', parts: [{ text: answer }] });
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(
            JSON.stringify({
              outputTranscript: answer,
              speakText: answer,
              turnComplete: true,
            })
          );
        }
      }
    } catch (err) {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(
          JSON.stringify({
            error: formatGeminiError(err, 'Coordinator prompt failed.'),
          })
        );
      }
    }
  });

  clientWs.on('close', () => {
    closed = true;
    try {
      liveSession?.close();
    } catch {
      // Ignore close errors
    }
  });
});

async function startServer() {
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.on('upgrade', (request, socket, head) => {
    const urlPath = request.url?.split('?')[0];
    if (urlPath === '/ws/chat') {
      chatWss.handleUpgrade(request, socket, head, (ws) => {
        chatWss.emit('connection', ws, request);
      });
    } else if (urlPath === '/ws/live') {
      liveWss.handleUpgrade(request, socket, head, (ws) => {
        liveWss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`RaktSetu server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
