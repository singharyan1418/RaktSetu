import { useState, type FormEvent } from 'react';
import { Droplets, HeartHandshake, Lock, Mail, ShieldCheck, UserCheck } from 'lucide-react';
import type { BloodType, SavedScreeningRecord, UserProfile, UserRole } from '../types';
import { ALL_BLOOD_TYPES, validateCredentials } from '../utils/bloodLogic';
import { signInWithGoogleWorkspace } from '../lib/firebase';
import { apiFetch, setCachedUser, setSessionToken } from '../lib/apiClient';

interface AuthGateViewProps {
  onAuthenticated: (payload: {
    user: UserProfile;
    screenings: SavedScreeningRecord[];
    unlockedDonorIds: string[];
  }) => void;
}

export function AuthGateView({ onAuthenticated }: AuthGateViewProps) {
  const [authMode, setAuthMode] = useState<'register' | 'login'>('register');
  const [role, setRole] = useState<UserRole>('recipient');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bloodType, setBloodType] = useState<BloodType>('B+');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleEmailSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const check = validateCredentials(email, password);
    if (!check.valid) {
      setError(check.error || 'Please check your email and password.');
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const endpoint =
        authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const res = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password,
          role,
          displayName: displayName.trim() || undefined,
          bloodType,
        }),
      });
      const data = (await res.json()) as {
        user?: UserProfile;
        screenings?: SavedScreeningRecord[];
        unlockedDonorIds?: string[];
        sessionToken?: string;
        error?: string;
      };
      if (!res.ok || !data.user) {
        throw new Error(data.error || 'Authentication failed.');
      }
      if (data.sessionToken) {
        setSessionToken(data.sessionToken);
      }
      setCachedUser(data.user);
      onAuthenticated({
        user: data.user,
        screenings: data.screenings || [],
        unlockedDonorIds: data.unlockedDonorIds || [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      const { user: fbUser, idToken } = await signInWithGoogleWorkspace();
      const res = await apiFetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idToken,
          role,
          avatarUrl: fbUser.photoURL || undefined,
        }),
      });
      const data = (await res.json()) as {
        user?: UserProfile;
        screenings?: SavedScreeningRecord[];
        unlockedDonorIds?: string[];
        sessionToken?: string;
        error?: string;
      };
      if (!res.ok || !data.user) {
        throw new Error(data.error || 'Google sign-in verification failed.');
      }
      if (data.sessionToken) {
        setSessionToken(data.sessionToken);
      }
      setCachedUser(data.user);
      onAuthenticated({
        user: data.user,
        screenings: data.screenings || [],
        unlockedDonorIds: data.unlockedDonorIds || [],
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Google sign-in was cancelled or failed.'
      );
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <div className="min-h-dvh bg-[#090D16] text-slate-100 flex items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-[1.05fr_1fr] bg-[#111827] border border-slate-800 rounded-2xl overflow-hidden">
        {/* Left brand & privacy overview */}
        <div className="p-6 sm:p-10 bg-[#0D1322] border-b lg:border-b-0 lg:border-r border-slate-800 flex flex-col justify-between gap-8">
          <div className="space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-rose-600 flex items-center justify-center shrink-0">
                <Droplets className="w-5 h-5 text-white" />
              </div>
              <span className="font-display text-xl font-bold tracking-tight text-white">
                RaktSetu
              </span>
            </div>

            <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-white text-balance leading-snug">
              Anonymous blood donor coordination built for rapid response.
            </h1>

            <p className="text-sm text-slate-300 leading-relaxed">
              Sign in as a Donor or Recipient to access location-aware donor matching, live multi-person relay messaging, saved medical screening checks, and AI health guidance.
            </p>
          </div>

          <div className="space-y-3 pt-4 border-t border-slate-800/80 text-xs text-slate-300">
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
              <span>
                Approximate location matching · Donor map coordinates are privacy-blurred to protect identities.
              </span>
            </div>
            <div className="flex items-start gap-2.5">
              <UserCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>
                Flexible role switching · Become a Donor or switch to Recipient anytime inside Settings.
              </span>
            </div>
          </div>
        </div>

        {/* Right authentication & role gate */}
        <div className="p-6 sm:p-10 flex flex-col justify-center space-y-6">
          {/* Sign In / Create Account toggle */}
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-display text-lg font-bold text-white">
              {authMode === 'register' ? 'Enter RaktSetu' : 'Welcome Back'}
            </h2>
            <div className="flex items-center gap-1 p-1 bg-[#090D16] border border-slate-800 rounded-lg">
              <button
                type="button"
                onClick={() => {
                  setAuthMode('register');
                  setError(null);
                }}
                className={`min-h-[34px] px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  authMode === 'register'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Create Account
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthMode('login');
                  setError(null);
                }}
                className={`min-h-[34px] px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  authMode === 'login'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Sign In
              </button>
            </div>
          </div>

          {/* Mandatory Role Selection: Donor or Recipient */}
          <div>
            <span className="block text-xs font-medium text-slate-300 mb-2 tracking-wide">
              Select Your Role
            </span>
            <div className="grid grid-cols-2 gap-2.5" role="group" aria-label="Account role">
              <button
                type="button"
                onClick={() => setRole('recipient')}
                aria-pressed={role === 'recipient'}
                className={`min-h-[48px] px-3.5 py-2.5 rounded-xl border text-left transition-colors cursor-pointer ${
                  role === 'recipient'
                    ? 'bg-rose-600/15 border-rose-500 text-white'
                    : 'bg-[#090D16] border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <Droplets className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>Recipient</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Find compatible donors
                </p>
              </button>

              <button
                type="button"
                onClick={() => setRole('donor')}
                aria-pressed={role === 'donor'}
                className={`min-h-[48px] px-3.5 py-2.5 rounded-xl border text-left transition-colors cursor-pointer ${
                  role === 'donor'
                    ? 'bg-rose-600/15 border-rose-500 text-white'
                    : 'bg-[#090D16] border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <HeartHandshake className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Donor</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Complete screening &amp; help
                </p>
              </button>
            </div>
          </div>

          <form onSubmit={handleEmailSubmit} className="space-y-3.5">
            <div>
              <label
                htmlFor="auth-email"
                className="block text-xs font-medium text-slate-300 mb-1.5"
              >
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="auth-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full min-h-[44px] pl-10 pr-3.5 rounded-xl bg-[#090D16] border border-slate-800 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-rose-500"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="auth-password"
                className="block text-xs font-medium text-slate-300 mb-1.5"
              >
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="auth-password"
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  className="w-full min-h-[44px] pl-10 pr-3.5 rounded-xl bg-[#090D16] border border-slate-800 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-rose-500"
                />
              </div>
            </div>

            {authMode === 'register' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="auth-display-name"
                    className="block text-xs font-medium text-slate-300 mb-1.5"
                  >
                    Display Name (Private)
                  </label>
                  <input
                    id="auth-display-name"
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Optional"
                    className="w-full min-h-[44px] px-3.5 rounded-xl bg-[#090D16] border border-slate-800 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-rose-500"
                  />
                </div>
                <div>
                  <label
                    htmlFor="auth-blood-type"
                    className="block text-xs font-medium text-slate-300 mb-1.5"
                  >
                    Blood Group
                  </label>
                  <select
                    id="auth-blood-type"
                    value={bloodType}
                    onChange={(e) => setBloodType(e.target.value as BloodType)}
                    className="w-full min-h-[44px] px-3 rounded-xl bg-[#090D16] border border-slate-800 text-sm font-mono text-slate-100 focus:outline-none focus:border-rose-500"
                  >
                    {ALL_BLOOD_TYPES.map((bt) => (
                      <option key={bt} value={bt}>
                        {bt}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="p-3 rounded-xl bg-rose-950/50 border border-rose-800 text-xs text-rose-200"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white text-sm font-semibold transition-colors cursor-pointer"
            >
              {submitting
                ? 'Authenticating...'
                : authMode === 'register'
                  ? `Continue as ${role === 'donor' ? 'Donor' : 'Recipient'}`
                  : `Sign In as ${role === 'donor' ? 'Donor' : 'Recipient'}`}
            </button>
          </form>

          <div className="relative flex items-center py-1">
            <div className="flex-grow border-t border-slate-800" />
            <span className="shrink mx-3 text-xs text-slate-500">or connect with</span>
            <div className="flex-grow border-t border-slate-800" />
          </div>

          {/* Official styled Sign in with Google button (unlocks Gmail + Google Chat) */}
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={googleLoading}
            className="gsi-material-button"
          >
            <div className="gsi-material-button-content-wrapper">
              <div className="gsi-material-button-icon">
                <svg
                  version="1.1"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 48 48"
                  style={{ display: 'block' }}
                >
                  <path
                    fill="#EA4335"
                    d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                  />
                  <path
                    fill="#34A853"
                    d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                  />
                  <path fill="none" d="M0 0h48v48H0z" />
                </svg>
              </div>
              <span className="gsi-material-button-contents">
                {googleLoading ? 'Connecting Google...' : 'Sign in with Google'}
              </span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
