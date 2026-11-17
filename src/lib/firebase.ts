import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  type User,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
void setPersistence(auth, browserLocalPersistence).catch(() => {});
export const db = getFirestore(
  app,
  (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId || '(default)'
);

export const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/chat.spaces',
  'https://www.googleapis.com/auth/chat.spaces.create',
  'https://www.googleapis.com/auth/chat.spaces.readonly',
  'https://www.googleapis.com/auth/chat.messages',
  'https://www.googleapis.com/auth/chat.messages.create',
  'https://www.googleapis.com/auth/chat.messages.readonly',
  'https://www.googleapis.com/auth/chat.memberships.readonly',
];

const googleProvider = new GoogleAuthProvider();
for (const scope of WORKSPACE_SCOPES) {
  googleProvider.addScope(scope);
}
googleProvider.setCustomParameters({
  prompt: 'consent',
});

// In-memory OAuth access token cache (never stored in localStorage/sessionStorage)
let cachedWorkspaceAccessToken: string | null = null;
let isSigningIn = false;

export function waitForFirebaseUser(): Promise<User | null> {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });
}

export function initFirebaseAuthListener(
  onUserSignedIn: (user: User, accessToken: string | null) => void,
  onUserSignedOut: () => void
) {
  return onAuthStateChanged(auth, (user) => {
    if (user) {
      onUserSignedIn(user, cachedWorkspaceAccessToken);
    } else if (!isSigningIn) {
      cachedWorkspaceAccessToken = null;
      onUserSignedOut();
    }
  });
}

export async function signInWithGoogleWorkspace(): Promise<{
  user: User;
  idToken: string;
  accessToken: string | null;
}> {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, googleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const accessToken = credential?.accessToken ?? null;
    cachedWorkspaceAccessToken = accessToken;
    const idToken = await result.user.getIdToken();
    return {
      user: result.user,
      idToken,
      accessToken,
    };
  } finally {
    isSigningIn = false;
  }
}

export function getCachedWorkspaceAccessToken(): string | null {
  return cachedWorkspaceAccessToken;
}

export function clearWorkspaceAccessToken() {
  cachedWorkspaceAccessToken = null;
}

export async function signOutFirebase() {
  cachedWorkspaceAccessToken = null;
  await auth.signOut();
}
