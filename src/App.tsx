import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ClipboardCheck,
  Compass,
  HeartPulse,
  Map as MapIcon,
  MapPin,
  MessageSquare,
  Settings,
} from 'lucide-react';
import type {
  AnonymousDonor,
  BloodType,
  ChatMessage,
  ChatThread,
  LatLng,
  PaymentReceipt,
  SavedScreeningRecord,
  UrgentRequest,
  UserProfile,
} from './types';
import {
  filterAndSortDonors,
  getUserInitials,
  sanitizeAvatarUrl,
} from './utils/bloodLogic';
import { DEFAULT_CENTER } from './utils/seedDonors';
import {
  signOutFirebase,
  waitForFirebaseUser,
} from './lib/firebase';
import {
  loadScreeningsFromFirestore,
  loadUserFromFirestore,
  syncRoleToFirestore,
  syncScreeningToFirestore,
  syncUserToFirestore,
} from './lib/firestoreStore';
import {
  apiFetch,
  clearClientAuth,
  getCachedUser,
  getLocalScreenings,
  getLocalUnlockedDonors,
  getSessionToken,
  saveLocalScreenings,
  saveLocalUnlockedDonors,
  setCachedUser,
  setSessionToken,
} from './lib/apiClient';
import { AuthGateView } from './components/AuthGateView';
import { DonorDiscoveryPanel } from './components/DonorDiscoveryPanel';
import { DonorMapView } from './components/DonorMapView';
import { AnonymousChatView } from './components/AnonymousChatView';
import { MedicalScreeningView } from './components/MedicalScreeningView';
import { GuidanceAndVoiceView } from './components/GuidanceAndVoiceView';
import { SettingsView } from './components/SettingsView';
import {
  DonorPaymentModal,
  type UnlockTargetDonor,
} from './components/DonorPaymentModal';

type ActiveTab =
  | 'discover'
  | 'messages'
  | 'screening'
  | 'guidance'
  | 'settings';

export default function App() {
  const [authChecking, setAuthChecking] = useState(true);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [savedScreenings, setSavedScreenings] = useState<SavedScreeningRecord[]>([]);
  const [unlockedDonorIds, setUnlockedDonorIds] = useState<string[]>([]);
  const [paymentReceipts, setPaymentReceipts] = useState<PaymentReceipt[]>([]);
  const [avatarErrored, setAvatarErrored] = useState(false);

  const [activeTab, setActiveTab] = useState<ActiveTab>('discover');
  const [mapsApiKey, setMapsApiKey] = useState<string>(
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
  );
  const [quotaExceeded, setQuotaExceeded] = useState(false);

  // Minimized map & blood types by default (user expands only if desired)
  const [mapExpanded, setMapExpanded] = useState(false);
  const [bloodTypesExpanded, setBloodTypesExpanded] = useState(false);

  // Donor discovery state
  const [selectedBloodType, setSelectedBloodType] = useState<BloodType>('B+');
  const [exactOnly, setExactOnly] = useState(false);
  const [radiusKm, setRadiusKm] = useState(10);
  const [userCenter, setUserCenter] = useState<LatLng>(DEFAULT_CENTER);
  const [locationConsented, setLocationConsented] = useState(false);
  const [locationStatusMessage, setLocationStatusMessage] = useState<string | null>(
    null
  );
  const hasAutoLocatedRef = useRef(false);

  // Server-authoritative real-time state
  const [donors, setDonors] = useState<AnonymousDonor[]>([]);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [urgentRequests, setUrgentRequests] = useState<UrgentRequest[]>([]);
  const [selectedDonorId, setSelectedDonorId] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [connectedClients, setConnectedClients] = useState(1);
  const [initialLoading, setInitialLoading] = useState(false);
  const [stateError, setStateError] = useState<string | null>(null);
  const [pendingUnlockTarget, setPendingUnlockTarget] = useState<{
    target: UnlockTargetDonor;
    pendingThreadId?: string;
    viaMap?: boolean;
  } | null>(null);

  const wsRef = useRef<WebSocket | null>(null);

  // Listen for Google Maps Platform quota events
  useEffect(() => {
    const handler = () => setQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', handler);
    return () => window.removeEventListener('gmp-quota-exceeded', handler);
  }, []);

  // Reset avatar fallback flag whenever avatarUrl changes
  useEffect(() => {
    setAvatarErrored(false);
  }, [currentUser?.avatarUrl]);

  // Bootstrap authentication session & Maps runtime config
  useEffect(() => {
    let cancelled = false;

    function mergeScreenings(
      primary: SavedScreeningRecord[],
      secondary: SavedScreeningRecord[]
    ): SavedScreeningRecord[] {
      const byId = new Map<string, SavedScreeningRecord>();
      for (const item of [...primary, ...secondary]) {
        if (item && item.id && !byId.has(item.id)) {
          byId.set(item.id, item);
        }
      }
      return Array.from(byId.values()).sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt)
      );
    }

    async function hydrateAuthenticatedUser(
      user: UserProfile,
      serverScreenings: SavedScreeningRecord[],
      serverUnlockedDonorIds: string[],
      sessionToken?: string | null,
      serverPaymentReceipts: PaymentReceipt[] = []
    ) {
      if (sessionToken) {
        setSessionToken(sessionToken);
      }
      setCachedUser(user);

      const localCached = getLocalScreenings(user.uid);
      let combinedScreenings = mergeScreenings(serverScreenings, localCached);

      const mergedUnlocked = Array.from(
        new Set([...serverUnlockedDonorIds, ...getLocalUnlockedDonors(user.uid)])
      );
      saveLocalUnlockedDonors(user.uid, mergedUnlocked);

      if (user.authProvider === 'google') {
        try {
          const [fsProfile, fsScreenings] = await Promise.all([
            loadUserFromFirestore(user.uid).catch(() => null),
            loadScreeningsFromFirestore(user.uid).catch(() => []),
          ]);
          if (fsScreenings.length > 0) {
            combinedScreenings = mergeScreenings(combinedScreenings, fsScreenings);
          }
          if (fsProfile?.role && fsProfile.role !== user.role) {
            const roleRes = await apiFetch('/api/me/role', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ role: fsProfile.role }),
            });
            if (roleRes.ok) {
              const roleData = (await roleRes.json()) as {
                user?: UserProfile;
                sessionToken?: string;
              };
              if (roleData.user) {
                user = roleData.user;
                if (roleData.sessionToken) setSessionToken(roleData.sessionToken);
                setCachedUser(user);
              }
            }
          } else {
            void syncUserToFirestore(user).catch(() => {});
          }
        } catch {
          // Non-fatal Firestore hydration error
        }
      }

      saveLocalScreenings(user.uid, combinedScreenings);
      if (!cancelled) {
        setCurrentUser(user);
        setSavedScreenings(combinedScreenings);
        setUnlockedDonorIds(mergedUnlocked);
        setPaymentReceipts(serverPaymentReceipts);
        setSelectedBloodType(user.bloodType || 'B+');
      }
    }

    async function checkAuthAndConfig() {
      try {
        const [cfgRes, meRes] = await Promise.all([
          apiFetch('/api/config'),
          apiFetch('/api/auth/me'),
        ]);

        if (cfgRes.ok) {
          const cfg = (await cfgRes.json()) as { mapsApiKey?: string };
          if (!cancelled && cfg.mapsApiKey) {
            setMapsApiKey((prev) => prev || cfg.mapsApiKey || '');
          }
        }

        if (meRes.ok) {
          const meData = (await meRes.json()) as {
            user: UserProfile | null;
            screenings?: SavedScreeningRecord[];
            unlockedDonorIds?: string[];
            paymentReceipts?: PaymentReceipt[];
            sessionToken?: string | null;
          };
          if (!cancelled && meData.user) {
            await hydrateAuthenticatedUser(
              meData.user,
              meData.screenings || [],
              meData.unlockedDonorIds || [],
              meData.sessionToken,
              meData.paymentReceipts || []
            );
            return;
          }
        }

        // If backend session wasn't matched, check persistent Firebase Auth state
        const fbUser = await waitForFirebaseUser();
        if (fbUser && !cancelled) {
          try {
            const idToken = await fbUser.getIdToken();
            const cached = getCachedUser();
            const fsProfile = await loadUserFromFirestore(fbUser.uid).catch(() => null);
            const googleRes = await apiFetch('/api/auth/google', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                idToken,
                role: fsProfile?.role || cached?.role || 'recipient',
                avatarUrl: fbUser.photoURL || undefined,
              }),
            });
            if (googleRes.ok) {
              const gData = (await googleRes.json()) as {
                user?: UserProfile;
                screenings?: SavedScreeningRecord[];
                unlockedDonorIds?: string[];
                sessionToken?: string;
              };
              if (!cancelled && gData.user) {
                await hydrateAuthenticatedUser(
                  gData.user,
                  gData.screenings || [],
                  gData.unlockedDonorIds || [],
                  gData.sessionToken
                );
                return;
              }
            }
          } catch {
            // Fall through to autostart or AuthGate
          }
        }

        // Clear stale local token if server explicitly confirmed unauthenticated
        if (meRes.ok) {
          clearClientAuth();
        }

        // Optional automated verification bypass (?autostart=1)
        const params = new URLSearchParams(window.location.search);
        if (params.get('autostart') === '1') {
          const demoRes = await apiFetch('/api/auth/demo', { method: 'POST' });
          if (demoRes.ok) {
            const demoData = (await demoRes.json()) as {
              user?: UserProfile;
              screenings?: SavedScreeningRecord[];
              unlockedDonorIds?: string[];
              sessionToken?: string;
            };
            if (!cancelled && demoData.user) {
              await hydrateAuthenticatedUser(
                demoData.user,
                demoData.screenings || [],
                demoData.unlockedDonorIds || [],
                demoData.sessionToken
              );
            }
          }
        }
      } catch {
        // Leave user on AuthGateView if check fails
      } finally {
        if (!cancelled) setAuthChecking(false);
      }
    }

    checkAuthAndConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  const localizeAtCoordinates = useCallback(async (coords: LatLng) => {
    setUserCenter(coords);
    setLocationConsented(true);
    setLocationStatusMessage(
      'Using your current location · Donor coordinates remain privacy-blurred.'
    );

    try {
      const res = await apiFetch('/api/donors/localize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(coords),
      });
      if (res.ok) {
        const data = (await res.json()) as { added?: AnonymousDonor[] };
        if (data.added && data.added.length > 0) {
          setDonors((prev) => {
            const existing = new Set(prev.map((d) => d.id));
            const newItems = data.added!.filter((d) => !existing.has(d.id));
            return newItems.length > 0 ? [...newItems, ...prev] : prev;
          });
        }
      }
    } catch {
      // Non-fatal if network localization check fails
    }
  }, []);

  // Automatically use the user's current location as default once inside the app
  useEffect(() => {
    if (!currentUser || hasAutoLocatedRef.current) return;
    hasAutoLocatedRef.current = true;

    if (!navigator.geolocation) {
      setLocationStatusMessage(
        'Browser geolocation unavailable; showing default regional coordinates.'
      );
      return;
    }

    setLocationStatusMessage('Detecting your current location...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords: LatLng = {
          lat: Number(pos.coords.latitude.toFixed(4)),
          lng: Number(pos.coords.longitude.toFixed(4)),
        };
        localizeAtCoordinates(coords);
      },
      () => {
        setLocationConsented(false);
        setLocationStatusMessage(
          'Location access declined; showing default regional network. Tap to retry.'
        );
      },
      { enableHighAccuracy: false, timeout: 6000 }
    );
  }, [currentUser, localizeAtCoordinates]);

  // Fetch Cloud SQL state & establish real-time WebSocket once authenticated
  useEffect(() => {
    if (!currentUser) return;

    let cancelled = false;
    let closedByCleanup = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    async function loadInitialState() {
      setInitialLoading(true);
      try {
        const [stateRes, paymentsRes] = await Promise.all([
          apiFetch('/api/state'),
          apiFetch('/api/payments'),
        ]);
        if (stateRes.ok) {
          const data = (await stateRes.json()) as {
            donors: AnonymousDonor[];
            threads: ChatThread[];
            urgentRequests: UrgentRequest[];
          };
          if (!cancelled) {
            setDonors(data.donors);
            setThreads(data.threads);
            setUrgentRequests(data.urgentRequests);
            setStateError(null);
          }
        }
        if (paymentsRes.ok) {
          const pData = (await paymentsRes.json()) as { receipts?: PaymentReceipt[] };
          if (!cancelled && pData.receipts) {
            setPaymentReceipts(pData.receipts);
          }
        }
      } catch {
        if (!cancelled) {
          setStateError('Unable to reach server state. Retrying connection...');
        }
      } finally {
        if (!cancelled) setInitialLoading(false);
      }
    }

    function connectWebSocket() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const token = getSessionToken();
      const wsUrl = `${protocol}//${window.location.host}/ws/chat${
        token ? `?token=${encodeURIComponent(token)}` : ''
      }`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
        setStateError(null);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as {
            type: string;
            donors?: AnonymousDonor[];
            threads?: ChatThread[];
            urgentRequests?: UrgentRequest[];
            donor?: AnonymousDonor;
            thread?: ChatThread;
            message?: ChatMessage;
            request?: UrgentRequest;
            connectedClients?: number;
          };

          if (msg.type === 'init') {
            if (msg.donors) setDonors(msg.donors);
            if (msg.threads) {
              setThreads(msg.threads);
            }
            if (msg.urgentRequests) setUrgentRequests(msg.urgentRequests);
            if (typeof msg.connectedClients === 'number') {
              setConnectedClients(msg.connectedClients);
            }
          } else if (msg.type === 'presence:update') {
            if (typeof msg.connectedClients === 'number') {
              setConnectedClients(msg.connectedClients);
            }
          } else if (msg.type === 'donor:added' && msg.donor) {
            const added = msg.donor;
            setDonors((prev) =>
              prev.some((d) => d.id === added.id)
                ? prev.map((d) => (d.id === added.id ? added : d))
                : [added, ...prev]
            );
          } else if (msg.type === 'thread:created' && msg.thread) {
            const created = msg.thread;
            setThreads((prev) =>
              prev.some((t) => t.id === created.id) ? prev : [created, ...prev]
            );
          } else if (msg.type === 'chat:message' && msg.message) {
            const incoming = msg.message;
            setThreads((prev) =>
              prev.map((thread) => {
                if (thread.id !== incoming.threadId) return thread;
                if (thread.messages.some((m) => m.id === incoming.id)) {
                  return thread;
                }
                return {
                  ...thread,
                  messages: [...thread.messages, incoming],
                };
              })
            );
          } else if (msg.type === 'request:added' && msg.request) {
            const reqAdded = msg.request;
            setUrgentRequests((prev) =>
              prev.some((r) => r.id === reqAdded.id) ? prev : [reqAdded, ...prev]
            );
          } else if (msg.type === 'chat:error') {
            const errMsg = (msg as { error?: string }).error;
            if (errMsg) setStateError(errMsg);
          }
        } catch {
          // Ignore malformed WS message
        }
      };

      ws.onclose = () => {
        if (!closedByCleanup) {
          setWsConnected(false);
          reconnectTimer = setTimeout(connectWebSocket, 2000);
        }
      };
    }

    loadInitialState();
    connectWebSocket();

    return () => {
      cancelled = true;
      closedByCleanup = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const ws = wsRef.current;
      if (ws) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        } else if (ws.readyState === WebSocket.CONNECTING) {
          ws.addEventListener('open', () => ws.close(), { once: true });
        }
      }
      wsRef.current = null;
    };
  }, [currentUser?.id]);

  const filteredDonors = useMemo(
    () =>
      filterAndSortDonors(
        donors,
        userCenter,
        selectedBloodType,
        radiusKm,
        exactOnly
      ),
    [donors, userCenter, selectedBloodType, radiusKm, exactOnly]
  );

  const handleToggleLocationConsent = useCallback(() => {
    if (locationConsented) {
      setLocationConsented(false);
      setUserCenter(DEFAULT_CENTER);
      setLocationStatusMessage(
        'Location consent reset. Using default regional center.'
      );
      return;
    }

    if (!navigator.geolocation) {
      setLocationStatusMessage(
        'Geolocation unavailable in this browser; using default center.'
      );
      return;
    }

    setLocationStatusMessage('Detecting your current location...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        localizeAtCoordinates({
          lat: Number(pos.coords.latitude.toFixed(4)),
          lng: Number(pos.coords.longitude.toFixed(4)),
        });
      },
      () => {
        setLocationConsented(false);
        setLocationStatusMessage(
          'Location permission declined; continuing with default center.'
        );
      },
      { enableHighAccuracy: false, timeout: 6000 }
    );
  }, [locationConsented, localizeAtCoordinates]);

  const openUnlockedThread = useCallback(
    async (donorId: string, viaMap = false) => {
      try {
        const res = await apiFetch('/api/threads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            donorId,
            requestedBloodType: selectedBloodType,
            urgency: 'urgent',
            viaMap,
          }),
        });
        const data = (await res.json()) as { thread?: ChatThread; error?: string };
        if (res.ok && data.thread) {
          const created = data.thread;
          setThreads((prev) =>
            prev.some((t) => t.id === created.id) ? prev : [created, ...prev]
          );
          setActiveThreadId(created.id);
          setActiveTab('messages');
        } else if (!res.ok) {
          setStateError(data.error || 'Unable to open anonymous message thread.');
        }
      } catch {
        setStateError('Unable to open anonymous message thread.');
      }
    },
    [selectedBloodType]
  );

  const handleUnlockDonorById = useCallback(
    async (donorId: string, paymentMethod: string, paymentDetails?: string) => {
      const res = await apiFetch(
        `/api/donors/${encodeURIComponent(donorId)}/unlock`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paymentMethod, paymentDetails, amountInr: 50 }),
        }
      );
      const data = (await res.json()) as {
        unlockedDonorIds?: string[];
        receipt?: PaymentReceipt;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || 'Could not process ₹50 unlock fee.');
      }
      setUnlockedDonorIds((prev) => {
        const next = Array.from(
          new Set([...prev, ...(data.unlockedDonorIds || []), donorId])
        );
        if (currentUser) {
          saveLocalUnlockedDonors(currentUser.uid, next);
        }
        return next;
      });
      if (data.receipt) {
        const receipt = data.receipt;
        setPaymentReceipts((prev) =>
          prev.some((r) => r.transactionId === receipt.transactionId)
            ? prev
            : [receipt, ...prev]
        );
      }
      return data.receipt;
    },
    [currentUser]
  );

  const handleRequestUnlockDonor = useCallback(
    (donor: AnonymousDonor, viaMap = false) => {
      setPendingUnlockTarget({
        target: {
          donorId: donor.id,
          anonymousHandle: donor.anonymousHandle,
          bloodType: donor.bloodType,
          neighborhood: donor.neighborhood,
        },
        viaMap,
      });
    },
    []
  );

  const handleRequestUnlockThread = useCallback((thread: ChatThread) => {
    setPendingUnlockTarget({
      target: {
        donorId: thread.donorId,
        anonymousHandle: thread.donorHandle,
        bloodType: thread.bloodType,
        neighborhood: thread.neighborhood,
      },
      pendingThreadId: thread.id,
    });
  }, []);

  const handleStartChat = useCallback(
    async (donor: AnonymousDonor, viaMap = false) => {
      if (!unlockedDonorIds.includes(donor.id)) {
        handleRequestUnlockDonor(donor, viaMap);
        return;
      }
      await openUnlockedThread(donor.id, viaMap);
    },
    [handleRequestUnlockDonor, openUnlockedThread, unlockedDonorIds]
  );

  const handleConfirmModalPayment = useCallback(
    async (donorId: string, paymentMethod: string, paymentDetails?: string) => {
      return await handleUnlockDonorById(donorId, paymentMethod, paymentDetails);
    },
    [handleUnlockDonorById]
  );

  const handleOpenUnlockedChatAfterPayment = useCallback(async () => {
    const pending = pendingUnlockTarget;
    setPendingUnlockTarget(null);
    if (!pending) return;
    if (pending.pendingThreadId) {
      setActiveThreadId(pending.pendingThreadId);
      setActiveTab('messages');
    } else {
      await openUnlockedThread(pending.target.donorId, pending.viaMap || false);
    }
  }, [openUnlockedThread, pendingUnlockTarget]);

  const handleSendMessage = useCallback(
    async (threadId: string, senderRole: 'recipient' | 'donor', text: string) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'chat:send',
            threadId,
            senderRole,
            text,
          })
        );
        return;
      }

      // REST fallback when WebSocket is reconnecting
      const res = await apiFetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId, senderRole, text }),
      });
      if (res.ok) {
        const data = (await res.json()) as { message?: ChatMessage };
        if (data.message) {
          const saved = data.message;
          setThreads((prev) =>
            prev.map((t) => {
              if (t.id !== saved.threadId) return t;
              if (t.messages.some((m) => m.id === saved.id)) return t;
              return { ...t, messages: [...t.messages, saved] };
            })
          );
        }
      }
    },
    []
  );

  const handleCreateUrgentRequest = useCallback(
    async (payload: {
      bloodType: BloodType;
      facilityZone: string;
      unitsNeeded: number;
      note: string;
    }) => {
      const res = await apiFetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          lat: userCenter.lat,
          lng: userCenter.lng,
        }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error || 'Failed to broadcast request.');
      }
      const data = (await res.json()) as { request: UrgentRequest };
      setUrgentRequests((prev) =>
        prev.some((r) => r.id === data.request.id) ? prev : [data.request, ...prev]
      );
      setSelectedBloodType(payload.bloodType);
    },
    [userCenter]
  );

  const handleDonorRegistered = useCallback(
    (donor: AnonymousDonor) => {
      setDonors((prev) =>
        prev.some((d) => d.id === donor.id)
          ? prev.map((d) => (d.id === donor.id ? donor : d))
          : [donor, ...prev]
      );
      setUnlockedDonorIds((prev) => {
        const next = Array.from(new Set([...prev, donor.id]));
        if (currentUser) {
          saveLocalUnlockedDonors(currentUser.uid, next);
        }
        return next;
      });
      setSelectedBloodType(donor.bloodType);
      setSelectedDonorId(donor.id);
      setMapExpanded(true);
      setActiveTab('discover');
    },
    [currentUser]
  );

  const handleScreeningSaved = useCallback(
    (record: SavedScreeningRecord) => {
      setSavedScreenings((prev) => {
        const updated = [record, ...prev.filter((item) => item.id !== record.id)];
        if (currentUser) {
          saveLocalScreenings(currentUser.uid, updated);
        }
        return updated;
      });
      if (currentUser?.authProvider === 'google') {
        void syncScreeningToFirestore(currentUser.uid, record).catch(() => {});
      }
    },
    [currentUser]
  );

  const handleSignOut = useCallback(async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Proceed with client state clear
    }
    clearClientAuth();
    try {
      await signOutFirebase();
    } catch {
      // Ignore if not signed into Firebase
    }
    hasAutoLocatedRef.current = false;
    setCurrentUser(null);
    setSavedScreenings([]);
    setUnlockedDonorIds([]);
    setPaymentReceipts([]);
    setActiveThreadId(null);
    setActiveTab('discover');
  }, []);

  if (authChecking) {
    return (
      <div className="min-h-dvh bg-[#090D16] text-slate-200 flex items-center justify-center text-sm">
        Initializing RaktSetu...
      </div>
    );
  }

  if (!currentUser) {
    return (
      <AuthGateView
        onAuthenticated={({
          user,
          screenings,
          unlockedDonorIds: authUnlocked,
        }) => {
          const merged = [
            ...screenings,
            ...getLocalScreenings(user.uid).filter(
              (localItem) => !screenings.some((s) => s.id === localItem.id)
            ),
          ];
          saveLocalScreenings(user.uid, merged);
          const mergedUnlocked = Array.from(
            new Set([...authUnlocked, ...getLocalUnlockedDonors(user.uid)])
          );
          saveLocalUnlockedDonors(user.uid, mergedUnlocked);
          setCurrentUser(user);
          setSavedScreenings(merged);
          setUnlockedDonorIds(mergedUnlocked);
          setSelectedBloodType(user.bloodType || 'B+');
          if (user.authProvider === 'google') {
            void syncUserToFirestore(user).catch(() => {});
          }
        }}
      />
    );
  }

  const resolvedAvatarUrl = !avatarErrored
    ? sanitizeAvatarUrl(currentUser.avatarUrl)
    : undefined;
  const userInitials = getUserInitials(
    currentUser.displayName,
    currentUser.email
  );

  const desktopNavItems: Array<{
    id: ActiveTab;
    label: string;
    shortLabel: string;
    icon: typeof MapPin;
  }> = [
    { id: 'discover', label: 'Discover', shortLabel: 'Discover', icon: MapPin },
    { id: 'messages', label: 'Messages', shortLabel: 'Messages', icon: MessageSquare },
    { id: 'screening', label: 'Screening', shortLabel: 'Screen', icon: ClipboardCheck },
    { id: 'guidance', label: 'AI Health', shortLabel: 'Health', icon: HeartPulse },
  ];

  return (
    <div className="h-dvh flex flex-col bg-[#090D16] text-slate-100 overflow-hidden">
      {/* Required Google Maps Platform Demo Key Quota Banner */}
      {quotaExceeded && (
        <div className="bg-amber-950/90 border-b border-amber-800 text-amber-100 px-4 py-2 text-xs md:text-sm text-center sticky top-0 z-50">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-200 hover:text-white"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

      {/* Top Navigation Bar (Strict 3-Zone Contract) */}
      <header className="h-12 md:h-16 bg-[#0D1322] border-b border-slate-800 px-4 md:px-6 flex items-center justify-between gap-6 shrink-0 z-30">
        {/* Zone 1: Single text element wordmark */}
        <button
          type="button"
          onClick={() => setActiveTab('discover')}
          className="font-display text-base md:text-lg font-extrabold tracking-tight text-white whitespace-nowrap shrink-0 cursor-pointer"
        >
          RaktSetu
        </button>

        {/* Zone 2: 5 single-line navigation links */}
        <nav
          aria-label="Primary navigation"
          className="hidden md:flex items-center gap-5 lg:gap-7"
        >
          {desktopNavItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                aria-current={active ? 'page' : undefined}
                className={`text-sm font-medium whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
                  active
                    ? 'text-rose-400 border-rose-500'
                    : 'text-slate-400 border-transparent hover:text-white'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Circular profile thumbnail + Settings button */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div
            data-testid="header-user-avatar"
            title={currentUser.displayName || currentUser.email}
            className="w-8 h-8 md:w-9 md:h-9 rounded-full overflow-hidden border border-slate-700 bg-[#111827] flex items-center justify-center shrink-0"
          >
            {resolvedAvatarUrl ? (
              <img
                src={resolvedAvatarUrl}
                alt={currentUser.displayName || 'User profile'}
                onError={() => setAvatarErrored(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-xs font-bold tracking-tight text-rose-300 select-none">
                {userInitials}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            data-testid="open-settings-button"
            className={`min-h-[36px] md:min-h-[40px] px-3.5 md:px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 flex items-center gap-2 cursor-pointer border ${
              activeTab === 'settings'
                ? 'bg-rose-600 border-rose-500 text-white'
                : 'bg-[#111827] hover:bg-slate-800 border-slate-700 text-slate-100'
            }`}
          >
            <Settings className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            <span>
              Settings · {currentUser.role === 'donor' ? 'Donor' : 'Recipient'}
            </span>
          </button>
        </div>
      </header>

      {stateError && (
        <div className="bg-amber-950/70 border-b border-amber-800 px-4 py-2 text-xs text-amber-200">
          {stateError}
        </div>
      )}

      {/* Main Workspace */}
      <main className="flex-1 flex flex-col min-h-0 pb-14 md:pb-0">
        {initialLoading && donors.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-sm text-slate-400">
            Loading live RaktSetu network...
          </div>
        ) : activeTab === 'discover' ? (
          mapExpanded ? (
            <div
              data-testid="discover-scroll-container"
              className="flex-1 flex flex-col overflow-y-auto md:overflow-hidden md:grid md:grid-cols-[410px_1fr] lg:grid-cols-[440px_1fr] min-h-0"
            >
              {/* Expanded Map View */}
              <div
                className="order-1 md:order-2 h-[260px] sm:h-[310px] md:h-full shrink-0 md:shrink relative overflow-hidden border-b md:border-b-0 border-slate-800"
                data-testid="expanded-map-container"
              >
                <DonorMapView
                  mapsApiKey={mapsApiKey}
                  userCenter={userCenter}
                  radiusKm={radiusKm}
                  onRadiusChange={setRadiusKm}
                  selectedBloodType={selectedBloodType}
                  donors={filteredDonors}
                  urgentRequests={urgentRequests}
                  selectedDonorId={selectedDonorId}
                  onSelectDonor={setSelectedDonorId}
                  onStartChat={(donor) => handleStartChat(donor, true)}
                  unlockedDonorIds={unlockedDonorIds}
                  onRequestUnlockDonor={(donor) => handleRequestUnlockDonor(donor, true)}
                  locationConsented={locationConsented}
                  onMinimizeMap={() => setMapExpanded(false)}
                  currentUserId={currentUser.id}
                />
              </div>

              <div
                data-testid="discover-panel-scroll"
                className="order-2 md:order-1 md:h-full md:overflow-y-auto min-h-0 flex flex-col"
              >
                <DonorDiscoveryPanel
                  selectedBloodType={selectedBloodType}
                  onBloodTypeChange={setSelectedBloodType}
                  exactOnly={exactOnly}
                  onExactOnlyChange={setExactOnly}
                  radiusKm={radiusKm}
                  onRadiusChange={setRadiusKm}
                  donors={filteredDonors}
                  selectedDonorId={selectedDonorId}
                  unlockedDonorIds={unlockedDonorIds}
                  onSelectDonor={setSelectedDonorId}
                  onStartChat={(donor) => handleStartChat(donor, false)}
                  locationConsented={locationConsented}
                  locationStatusMessage={locationStatusMessage}
                  onToggleLocationConsent={handleToggleLocationConsent}
                  urgentRequests={urgentRequests}
                  onCreateUrgentRequest={handleCreateUrgentRequest}
                  mapExpanded={mapExpanded}
                  onToggleMap={() => setMapExpanded(false)}
                  bloodTypesExpanded={bloodTypesExpanded}
                  onToggleBloodTypes={() => setBloodTypesExpanded((v) => !v)}
                  currentUserId={currentUser.id}
                />
              </div>
            </div>
          ) : (
            <div
              data-testid="discover-scroll-container"
              className="flex-1 min-h-0 overflow-y-auto"
            >
              <div className="max-w-5xl w-full mx-auto border-x border-slate-800/70 bg-[#0D1322] min-h-full">
                {/* Minimized Map Bar (Expands only when user clicks) */}
                <div
                  className="px-4 sm:px-5 py-3 bg-[#090D16] border-b border-slate-800 flex flex-wrap items-center justify-between gap-3"
                  data-testid="minimized-map-bar"
                >
                  <div className="flex items-center gap-2.5 text-xs text-slate-300 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-[#111827] border border-slate-800 flex items-center justify-center shrink-0">
                      <Compass className="w-4 h-4 text-rose-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-white">
                        Interactive Map Minimized
                      </p>
                      <p className="text-[11px] text-slate-400 truncate tabular-nums">
                        {filteredDonors.length} compatible donors within {radiusKm} km of{' '}
                        {locationConsented ? 'your current location' : 'default center'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMapExpanded(true)}
                    data-testid="expand-map-button"
                    className="min-h-[38px] px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1.5 shrink-0 cursor-pointer"
                  >
                    <MapIcon className="w-3.5 h-3.5" />
                    <span>Expand Map</span>
                  </button>
                </div>

                <DonorDiscoveryPanel
                  selectedBloodType={selectedBloodType}
                  onBloodTypeChange={setSelectedBloodType}
                  exactOnly={exactOnly}
                  onExactOnlyChange={setExactOnly}
                  radiusKm={radiusKm}
                  onRadiusChange={setRadiusKm}
                  donors={filteredDonors}
                  selectedDonorId={selectedDonorId}
                  unlockedDonorIds={unlockedDonorIds}
                  onSelectDonor={setSelectedDonorId}
                  onStartChat={(donor) => handleStartChat(donor, false)}
                  locationConsented={locationConsented}
                  locationStatusMessage={locationStatusMessage}
                  onToggleLocationConsent={handleToggleLocationConsent}
                  urgentRequests={urgentRequests}
                  onCreateUrgentRequest={handleCreateUrgentRequest}
                  mapExpanded={mapExpanded}
                  onToggleMap={() => setMapExpanded(true)}
                  bloodTypesExpanded={bloodTypesExpanded}
                  onToggleBloodTypes={() => setBloodTypesExpanded((v) => !v)}
                  currentUserId={currentUser.id}
                />
              </div>
            </div>
          )
        ) : activeTab === 'messages' ? (
          <AnonymousChatView
            currentUser={currentUser}
            threads={threads}
            activeThreadId={activeThreadId}
            unlockedDonorIds={unlockedDonorIds}
            onSelectThread={setActiveThreadId}
            onRequestUnlockThread={handleRequestUnlockThread}
            onSendMessage={handleSendMessage}
            wsConnected={wsConnected}
            connectedClients={connectedClients}
            onOpenDiscover={() => setActiveTab('discover')}
            onOpenSettings={() => {
              setActiveThreadId(null);
              setActiveTab('settings');
            }}
          />
        ) : activeTab === 'screening' ? (
          <MedicalScreeningView
            userCenter={userCenter}
            defaultBloodType={currentUser.bloodType}
            defaultNeighborhood={currentUser.neighborhood}
            latestScreening={savedScreenings[0] || null}
            onDonorRegistered={handleDonorRegistered}
            onScreeningSaved={handleScreeningSaved}
            onBrowseDonors={() => setActiveTab('discover')}
          />
        ) : activeTab === 'guidance' ? (
          <GuidanceAndVoiceView />
        ) : (
          <SettingsView
            user={currentUser}
            screenings={savedScreenings}
            paymentReceipts={paymentReceipts}
            locationConsented={locationConsented}
            locationStatusMessage={locationStatusMessage}
            onToggleLocationConsent={handleToggleLocationConsent}
            onRoleUpdated={(updated) => {
              setCurrentUser(updated);
              if (updated.authProvider === 'google') {
                void syncRoleToFirestore(updated.uid, updated.role).catch(() => {});
              }
            }}
            onProfileUpdated={(updated) => {
              setCurrentUser(updated);
              setSelectedBloodType(updated.bloodType);
              if (updated.authProvider === 'google') {
                void syncUserToFirestore(updated).catch(() => {});
              }
            }}
            onSignOut={handleSignOut}
            onGoToScreening={() => setActiveTab('screening')}
          />
        )}
      </main>

      {/* Mobile Bottom Thumb-Zone Navigation (56px height + 48px top = 104px <= 15% of 844px) */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-14 bg-[#0D1322]/95 backdrop-blur-md border-t border-slate-800 grid grid-cols-4 items-center"
      >
        {desktopNavItems.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              aria-current={active ? 'page' : undefined}
              className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
                active ? 'text-rose-400' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="text-[11px] font-medium tracking-tight leading-none">
                {item.shortLabel}
              </span>
            </button>
          );
        })}
      </nav>

      <DonorPaymentModal
        target={pendingUnlockTarget?.target || null}
        onClose={() => setPendingUnlockTarget(null)}
        onConfirmPayment={handleConfirmModalPayment}
        onOpenUnlockedChat={handleOpenUnlockedChatAfterPayment}
      />
    </div>
  );
}
