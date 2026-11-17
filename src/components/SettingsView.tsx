import { useState, type FormEvent } from 'react';
import {
  ArrowLeftRight,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Crosshair,
  IndianRupee,
  LogOut,
  MapPin,
  ShieldCheck,
  User,
} from 'lucide-react';
import type {
  BloodType,
  PaymentReceipt,
  SavedScreeningRecord,
  UserProfile,
  UserRole,
} from '../types';
import { ALL_BLOOD_TYPES, getUserInitials, toggleUserRole } from '../utils/bloodLogic';
import { apiFetch, setCachedUser, setSessionToken } from '../lib/apiClient';

interface SettingsViewProps {
  user: UserProfile;
  screenings: SavedScreeningRecord[];
  paymentReceipts?: PaymentReceipt[];
  locationConsented: boolean;
  locationStatusMessage: string | null;
  onToggleLocationConsent: () => void;
  onRoleUpdated: (user: UserProfile) => void;
  onProfileUpdated: (user: UserProfile) => void;
  onSignOut: () => void;
  onGoToScreening: () => void;
}

export function SettingsView({
  user,
  screenings,
  paymentReceipts = [],
  locationConsented,
  locationStatusMessage,
  onToggleLocationConsent,
  onRoleUpdated,
  onProfileUpdated,
  onSignOut,
  onGoToScreening,
}: SettingsViewProps) {
  const [roleSwitching, setRoleSwitching] = useState(false);
  const [roleFeedback, setRoleFeedback] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState(user.displayName);
  const [bloodType, setBloodType] = useState<BloodType>(user.bloodType);
  const [neighborhood, setNeighborhood] = useState(user.neighborhood);
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl || '');
  const [previewErrored, setPreviewErrored] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const nextRole: UserRole = toggleUserRole(user.role);

  const handleSwitchRole = async () => {
    setRoleSwitching(true);
    setError(null);
    setRoleFeedback(null);
    try {
      const res = await apiFetch('/api/me/role', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: nextRole }),
      });
      const data = (await res.json()) as {
        user?: UserProfile;
        sessionToken?: string;
        error?: string;
      };
      if (!res.ok || !data.user) {
        throw new Error(data.error || 'Could not update role.');
      }
      if (data.sessionToken) {
        setSessionToken(data.sessionToken);
      }
      setCachedUser(data.user);
      onRoleUpdated(data.user);
      setRoleFeedback(
        `Account switched to ${data.user.role === 'donor' ? 'Donor' : 'Recipient'} mode.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Role update failed.');
    } finally {
      setRoleSwitching(false);
    }
  };

  const handleSaveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setError(null);
    setProfileMessage(null);
    try {
      const res = await apiFetch('/api/me/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: displayName.trim() || user.displayName,
          bloodType,
          neighborhood: neighborhood.trim() || 'Local Zone',
          avatarUrl: avatarUrl.trim(),
        }),
      });
      const data = (await res.json()) as {
        user?: UserProfile;
        sessionToken?: string;
        error?: string;
      };
      if (!res.ok || !data.user) {
        throw new Error(data.error || 'Could not save profile.');
      }
      if (data.sessionToken) {
        setSessionToken(data.sessionToken);
      }
      setCachedUser(data.user);
      onProfileUpdated(data.user);
      setProfileMessage('Profile preferences saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Profile update failed.');
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#090D16] p-4 sm:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-white">
              Account Settings &amp; Saved Records
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Manage your active Donor or Recipient role, location preferences, and stored screening forms.
            </p>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="min-h-[42px] px-4 py-2 rounded-xl border border-slate-700 bg-[#111827] hover:bg-slate-800 text-xs font-medium text-slate-200 flex items-center gap-2 cursor-pointer"
          >
            <LogOut className="w-4 h-4 text-rose-400" />
            <span>Sign Out</span>
          </button>
        </div>

        {error && (
          <div className="p-3.5 rounded-xl bg-rose-950/60 border border-rose-800 text-xs text-rose-200">
            {error}
          </div>
        )}

        {/* Role Switch Card: Donor <-> Recipient */}
        <section className="bg-[#111827] border border-slate-800 rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <User className="w-4 h-4 text-rose-400" />
              <span>Active Coordination Role</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-slate-300">{user.email}</span>
            </div>
            <h2 className="font-display text-lg font-bold text-white">
              You are currently registered as a{' '}
              <span className="text-rose-400 capitalize">{user.role}</span>
            </h2>
            <p className="text-xs text-slate-400 max-w-xl">
              Switch between Donor and Recipient whenever needed—your messages and coordination profile adapt immediately.
            </p>
            {roleFeedback && (
              <p className="text-xs text-emerald-400 pt-1">{roleFeedback}</p>
            )}
          </div>

          <button
            type="button"
            onClick={handleSwitchRole}
            disabled={roleSwitching}
            data-testid="switch-role-button"
            className="min-h-[44px] px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white text-sm font-semibold flex items-center gap-2 shrink-0 cursor-pointer"
          >
            <ArrowLeftRight className="w-4 h-4" />
            <span>
              {roleSwitching
                ? 'Switching...'
                : nextRole === 'donor'
                  ? 'Become a Donor'
                  : 'Switch to Recipient'}
            </span>
          </button>
        </section>

        {/* Profile & Location Preferences */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <form
            onSubmit={handleSaveProfile}
            className="bg-[#111827] border border-slate-800 rounded-2xl p-6 space-y-4"
          >
            <h2 className="font-display text-base font-bold text-white">
              Profile Preferences
            </h2>
            <div>
              <label
                htmlFor="settings-display-name"
                className="block text-xs font-medium text-slate-300 mb-1.5"
              >
                Private Display Name
              </label>
              <input
                id="settings-display-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full min-h-[42px] px-3.5 rounded-xl bg-[#090D16] border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-rose-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="settings-blood-type"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Blood Type
                </label>
                <select
                  id="settings-blood-type"
                  value={bloodType}
                  onChange={(e) => setBloodType(e.target.value as BloodType)}
                  className="w-full min-h-[42px] px-3 rounded-xl bg-[#090D16] border border-slate-800 text-sm font-mono text-slate-100 focus:outline-none focus:border-rose-500"
                >
                  {ALL_BLOOD_TYPES.map((bt) => (
                    <option key={bt} value={bt}>
                      {bt}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="settings-neighborhood"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Default Zone
                </label>
                <input
                  id="settings-neighborhood"
                  type="text"
                  value={neighborhood}
                  onChange={(e) => setNeighborhood(e.target.value)}
                  className="w-full min-h-[42px] px-3.5 rounded-xl bg-[#090D16] border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-rose-500"
                />
              </div>
            </div>

            <div className="flex items-center gap-3 pb-1">
              <div className="w-12 h-12 rounded-full overflow-hidden border border-slate-700 bg-[#090D16] flex items-center justify-center shrink-0">
                {avatarUrl.trim() && !previewErrored ? (
                  <img
                    src={avatarUrl.trim()}
                    alt={displayName || user.displayName}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                    onError={() => setPreviewErrored(true)}
                  />
                ) : (
                  <span className="text-xs font-bold text-rose-300">
                    {getUserInitials(displayName || user.displayName, user.email)}
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <label
                  htmlFor="settings-avatar-url"
                  className="block text-xs font-medium text-slate-300 mb-1"
                >
                  Profile Avatar URL (Optional)
                </label>
                <input
                  id="settings-avatar-url"
                  type="url"
                  value={avatarUrl}
                  onChange={(e) => {
                    setAvatarUrl(e.target.value);
                    setPreviewErrored(false);
                  }}
                  placeholder="https://example.com/avatar.jpg"
                  className="w-full min-h-[40px] px-3 rounded-xl bg-[#090D16] border border-slate-800 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-rose-500"
                />
              </div>
            </div>

            {profileMessage && (
              <p className="text-xs text-emerald-400">{profileMessage}</p>
            )}

            <button
              type="submit"
              disabled={savingProfile}
              className="min-h-[42px] px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold cursor-pointer"
            >
              {savingProfile ? 'Saving...' : 'Save Profile'}
            </button>
          </form>

          {/* Location Privacy Card */}
          <div className="bg-[#111827] border border-slate-800 rounded-2xl p-6 flex flex-col justify-between space-y-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
                <MapPin className="w-4 h-4 text-rose-400" />
                <span>Default Current Location</span>
              </div>
              <h2 className="font-display text-base font-bold text-white">
                Approximate GPS Matching
              </h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                RaktSetu uses your current browser coordinates as the default search center and blurs donor pins within ~800m for privacy.
              </p>
              {locationStatusMessage && (
                <p className="text-xs text-slate-300 pt-1">{locationStatusMessage}</p>
              )}
            </div>

            <button
              type="button"
              onClick={onToggleLocationConsent}
              className="min-h-[44px] w-full px-4 py-2.5 rounded-xl border border-slate-700 bg-[#090D16] hover:bg-slate-800 text-xs font-medium text-slate-100 flex items-center justify-center gap-2 cursor-pointer"
            >
              <Crosshair className="w-4 h-4 text-rose-400" />
              <span>
                {locationConsented
                  ? 'Revoke Current Location & Reset'
                  : 'Refresh Current Location'}
              </span>
            </button>
          </div>
        </div>

        {/* Saved Screening Forms History */}
        <section className="bg-[#111827] border border-slate-800 rounded-2xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-bold text-white flex items-center gap-2">
                <ClipboardCheck className="w-4 h-4 text-rose-400" />
                <span>Saved Screening Submissions</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Every medical screening form you submit is permanently stored to your account.
              </p>
            </div>
            <button
              type="button"
              onClick={onGoToScreening}
              className="min-h-[38px] px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-white cursor-pointer"
            >
              New Screening Form
            </button>
          </div>

          {screenings.length === 0 ? (
            <div className="p-6 rounded-xl bg-[#090D16] border border-slate-800 text-center text-xs text-slate-400">
              No screening forms submitted yet. Complete the Screening form to store your eligibility check.
            </div>
          ) : (
            <div className="divide-y divide-slate-800 border border-slate-800 rounded-xl bg-[#090D16]" data-testid="saved-screenings-list">
              {screenings.map((item) => (
                <div key={item.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {item.status === 'eligible' ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      ) : item.status === 'temporary_deferral' ? (
                        <Clock className="w-4 h-4 text-amber-400 shrink-0" />
                      ) : (
                        <ShieldCheck className="w-4 h-4 text-rose-400 shrink-0" />
                      )}
                      <span className="font-semibold text-white capitalize">
                        {item.status.replace('_', ' ')}
                      </span>
                      <span className="text-slate-600" aria-hidden="true">·</span>
                      <span className="font-mono text-rose-400 font-semibold">
                        {item.bloodType}
                      </span>
                      <span className="text-slate-600" aria-hidden="true">·</span>
                      <span className="text-slate-300">{item.neighborhood}</span>
                    </div>
                    <p className="text-xs text-slate-400">{item.summary}</p>
                  </div>
                  <span className="text-[11px] font-mono text-slate-500 tabular-nums shrink-0">
                    {new Date(item.createdAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Payment Receipts History (₹50 Unlocks) */}
        <section className="bg-[#111827] border border-slate-800 rounded-2xl p-6 space-y-4">
          <div>
            <h2 className="font-display text-base font-bold text-white flex items-center gap-2">
              <IndianRupee className="w-4 h-4 text-emerald-400" />
              <span>Payment Receipts (₹50 Unlocks)</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Verified ₹50 donor chat unlock transactions linked to your account.
            </p>
          </div>

          {paymentReceipts.length === 0 ? (
            <div className="p-6 rounded-xl bg-[#090D16] border border-slate-800 text-center text-xs text-slate-400">
              No ₹50 chat unlock payments recorded yet.
            </div>
          ) : (
            <div
              className="divide-y divide-slate-800 border border-slate-800 rounded-xl bg-[#090D16]"
              data-testid="payment-receipts-list"
            >
              {paymentReceipts.map((receipt) => (
                <div
                  key={receipt.transactionId}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span className="font-mono font-semibold text-white">
                        {receipt.donorHandle}
                      </span>
                      <span className="text-slate-600" aria-hidden="true">·</span>
                      <span className="font-mono text-rose-400 font-semibold">
                        {receipt.bloodType}
                      </span>
                      <span className="text-slate-600" aria-hidden="true">·</span>
                      <span className="font-mono text-emerald-400 font-semibold">
                        ₹{receipt.amountInr}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 font-mono">
                      {receipt.transactionId} · {receipt.paymentMethod}
                      {receipt.paymentDetails ? ` (${receipt.paymentDetails})` : ''}
                    </p>
                  </div>
                  <span className="text-[11px] font-mono text-slate-500 tabular-nums shrink-0">
                    {new Date(receipt.paidAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
