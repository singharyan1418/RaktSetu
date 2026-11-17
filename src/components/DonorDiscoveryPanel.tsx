import { useState, type FormEvent } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Crosshair,
  IndianRupee,
  Lock,
  Map as MapIcon,
  MessageSquare,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import type { AnonymousDonor, BloodType, UrgentRequest } from '../types';
import { ALL_BLOOD_TYPES, getCompatibleDonorTypes } from '../utils/bloodLogic';

interface DonorDiscoveryPanelProps {
  selectedBloodType: BloodType;
  onBloodTypeChange: (bloodType: BloodType) => void;
  exactOnly: boolean;
  onExactOnlyChange: (exactOnly: boolean) => void;
  radiusKm: number;
  onRadiusChange: (km: number) => void;
  donors: AnonymousDonor[];
  selectedDonorId: string | null;
  unlockedDonorIds: string[];
  onSelectDonor: (donorId: string) => void;
  onStartChat: (donor: AnonymousDonor) => void;
  locationConsented: boolean;
  locationStatusMessage: string | null;
  onToggleLocationConsent: () => void;
  urgentRequests: UrgentRequest[];
  onCreateUrgentRequest: (payload: {
    bloodType: BloodType;
    facilityZone: string;
    unitsNeeded: number;
    note: string;
  }) => Promise<void>;
  mapExpanded: boolean;
  onToggleMap: () => void;
  bloodTypesExpanded: boolean;
  onToggleBloodTypes: () => void;
  currentUserId?: number;
}

export function DonorDiscoveryPanel({
  selectedBloodType,
  onBloodTypeChange,
  exactOnly,
  onExactOnlyChange,
  radiusKm,
  onRadiusChange,
  donors,
  selectedDonorId,
  unlockedDonorIds,
  onSelectDonor,
  onStartChat,
  locationConsented,
  locationStatusMessage,
  onToggleLocationConsent,
  urgentRequests,
  onCreateUrgentRequest,
  mapExpanded,
  onToggleMap,
  bloodTypesExpanded,
  onToggleBloodTypes,
  currentUserId,
}: DonorDiscoveryPanelProps) {
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [reqBloodType, setReqBloodType] = useState<BloodType>(selectedBloodType);
  const [facilityZone, setFacilityZone] = useState('');
  const [unitsNeeded, setUnitsNeeded] = useState(2);
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const compatibleTypes = getCompatibleDonorTypes(selectedBloodType, exactOnly);

  const handleRequestSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!facilityZone.trim()) {
      setFormError('Please enter the hospital or accredited blood bank zone.');
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      await onCreateUrgentRequest({
        bloodType: reqBloodType,
        facilityZone: facilityZone.trim(),
        unitsNeeded,
        note: note.trim() || 'Hospital donor desk check-in required',
      });
      setFacilityZone('');
      setNote('');
      setShowRequestForm(false);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Could not publish blood request.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col bg-[#0D1322] md:border-r border-slate-800">
      {/* Header & Minimized Controls */}
      <div className="p-4 sm:p-5 border-b border-slate-800 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="font-display text-lg font-bold tracking-tight text-white">
              Nearby Screened Donors
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Compatible: {compatibleTypes.join(', ')} · Within {radiusKm} km
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {mapExpanded && (
              <button
                type="button"
                onClick={onToggleMap}
                aria-expanded={mapExpanded}
                className="min-h-[38px] px-3 py-1.5 rounded-lg border border-slate-700 bg-[#111827] hover:bg-slate-800 text-xs font-medium text-slate-200 flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <MapIcon className="w-3.5 h-3.5 text-rose-400" />
                <span>Minimize Map</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setReqBloodType(selectedBloodType);
                setShowRequestForm((prev) => !prev);
              }}
              className="min-h-[38px] px-3 py-1.5 rounded-lg border border-rose-500/40 bg-rose-600/15 hover:bg-rose-600/25 text-xs font-medium text-rose-200 flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              {showRequestForm ? (
                <X className="w-3.5 h-3.5" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
              <span>{showRequestForm ? 'Close' : 'Urgent Request'}</span>
            </button>
          </div>
        </div>

        {/* Always-Visible Search Radius Slider (Dynamically updates map circular overlay) */}
        <div className="rounded-xl border border-slate-800 bg-[#090D16] p-3 space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <label
              htmlFor="discovery-radius-slider"
              className="font-medium text-slate-300 flex items-center gap-1.5"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-rose-400" />
              <span>Search Radius</span>
            </label>
            <span
              className="font-mono font-bold text-rose-400 tabular-nums"
              data-testid="radius-value-readout"
            >
              {radiusKm} km
            </span>
          </div>
          <input
            id="discovery-radius-slider"
            type="range"
            min={1}
            max={50}
            step={1}
            value={radiusKm}
            onChange={(e) => onRadiusChange(Number(e.target.value))}
            aria-label="Search radius in kilometers"
            data-testid="radius-slider"
            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-rose-500"
          />
          <div className="flex items-center justify-between text-[10px] font-mono text-slate-500">
            <span>1 km</span>
            <span>10 km</span>
            <span>25 km</span>
            <span>50 km</span>
          </div>
        </div>

        {/* Minimized Blood Type Selector Bar (Expands only when user clicks) */}
        <div className="rounded-xl border border-slate-800 bg-[#090D16] p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-slate-300 flex items-center gap-2 min-w-0">
              <span className="text-slate-400 shrink-0">Blood Filter:</span>
              <span className="font-mono font-bold text-rose-400 shrink-0">
                {selectedBloodType}
              </span>
              <span className="text-slate-600 shrink-0" aria-hidden="true">
                ·
              </span>
              <span className="text-slate-400 truncate">
                {exactOnly ? 'Exact match' : 'Compatible types'}
              </span>
            </div>

            <button
              type="button"
              onClick={onToggleBloodTypes}
              aria-expanded={bloodTypesExpanded}
              data-testid="toggle-blood-types"
              className="min-h-[34px] px-2.5 py-1 rounded-lg bg-[#111827] border border-slate-700 hover:bg-slate-800 text-xs font-medium text-slate-200 flex items-center gap-1.5 shrink-0 cursor-pointer"
            >
              <span>{bloodTypesExpanded ? 'Minimize Types' : 'Expand Blood Types'}</span>
              {bloodTypesExpanded ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
          </div>

          {bloodTypesExpanded && (
            <div className="mt-3 pt-3 border-t border-slate-800 space-y-3" data-testid="blood-types-panel">
              <div>
                <span className="block text-xs font-medium text-slate-400 mb-2">
                  Select Required Blood Type
                </span>
                <div
                  className="grid grid-cols-4 gap-1.5"
                  role="group"
                  aria-label="Blood type filter"
                >
                  {ALL_BLOOD_TYPES.map((bt) => {
                    const active = selectedBloodType === bt;
                    return (
                      <button
                        key={bt}
                        type="button"
                        onClick={() => onBloodTypeChange(bt)}
                        aria-pressed={active}
                        className={`min-h-[38px] rounded-lg font-mono text-xs font-semibold transition-colors cursor-pointer ${
                          active
                            ? 'bg-rose-600 text-white'
                            : 'bg-[#111827] border border-slate-800 text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        {bt}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1 p-1 bg-[#111827] border border-slate-800 rounded-lg">
                  <button
                    type="button"
                    onClick={() => onExactOnlyChange(false)}
                    className={`min-h-[32px] px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      !exactOnly
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    All Compatible
                  </button>
                  <button
                    type="button"
                    onClick={() => onExactOnlyChange(true)}
                    className={`min-h-[32px] px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      exactOnly
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Exact {selectedBloodType}
                  </button>
                </div>

                <span className="text-[11px] font-mono text-slate-400">
                  Radius: {radiusKm} km
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Current location status / consent control */}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onToggleLocationConsent}
            className={`min-h-[38px] w-full px-3 py-1.5 rounded-lg text-xs font-medium flex items-center justify-center gap-2 border transition-colors cursor-pointer ${
              locationConsented
                ? 'bg-emerald-950/40 text-emerald-300 border-emerald-800/70 hover:bg-emerald-950/60'
                : 'bg-[#111827] text-slate-300 border-slate-800 hover:bg-slate-800'
            }`}
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span>
              {locationConsented
                ? 'Current Location Active · Tap to Reset'
                : 'Use My Current Location'}
            </span>
          </button>
        </div>
        {locationStatusMessage && (
          <p className="text-xs text-slate-400">{locationStatusMessage}</p>
        )}
      </div>

      {/* Urgent Blood Request inline panel */}
      {showRequestForm && (
        <form
          onSubmit={handleRequestSubmit}
          className="p-4 bg-[#111827] border-b border-slate-800 space-y-3"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">
              Broadcast Hospital Blood Request
            </h2>
            <span className="text-xs text-slate-400">Anonymous desk alert</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label
                htmlFor="req-blood-type"
                className="block text-xs font-medium text-slate-300 mb-1"
              >
                Blood Type
              </label>
              <select
                id="req-blood-type"
                value={reqBloodType}
                onChange={(e) => setReqBloodType(e.target.value as BloodType)}
                className="w-full min-h-[40px] rounded-lg border border-slate-700 bg-[#090D16] px-2.5 text-xs font-mono text-slate-100"
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
                htmlFor="req-units"
                className="block text-xs font-medium text-slate-300 mb-1"
              >
                Units Needed
              </label>
              <input
                id="req-units"
                type="number"
                min={1}
                max={8}
                value={unitsNeeded}
                onChange={(e) => setUnitsNeeded(Number(e.target.value))}
                className="w-full min-h-[40px] rounded-lg border border-slate-700 bg-[#090D16] px-2.5 text-xs font-mono text-slate-100"
              />
            </div>
          </div>
          <div>
            <label
              htmlFor="req-facility"
              className="block text-xs font-medium text-slate-300 mb-1"
            >
              Accredited Hospital / Collection Center Zone
            </label>
            <input
              id="req-facility"
              type="text"
              placeholder="e.g., Central Hospital Blood Bank Desk"
              value={facilityZone}
              onChange={(e) => setFacilityZone(e.target.value)}
              className="w-full min-h-[40px] rounded-lg border border-slate-700 bg-[#090D16] px-3 text-xs text-slate-100 placeholder:text-slate-500"
            />
          </div>
          <div>
            <label
              htmlFor="req-note"
              className="block text-xs font-medium text-slate-300 mb-1"
            >
              Coordinator Note (No PII)
            </label>
            <input
              id="req-note"
              type="text"
              placeholder="e.g., Outpatient surgery reserve, check-in Desk B"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full min-h-[40px] rounded-lg border border-slate-700 bg-[#090D16] px-3 text-xs text-slate-100 placeholder:text-slate-500"
            />
          </div>
          {formError && <p className="text-xs text-rose-400">{formError}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full min-h-[42px] bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white text-xs font-semibold rounded-lg cursor-pointer"
          >
            {submitting ? 'Publishing Alert...' : 'Broadcast Request to Compatible Donors'}
          </button>
        </form>
      )}

      {/* Donor Results List */}
      <div className="divide-y divide-slate-800/80" data-testid="donor-list">
        {urgentRequests.length > 0 && (
          <div className="px-4 py-2.5 bg-amber-950/35 border-b border-amber-800/50 text-xs text-amber-200">
            <span className="font-semibold">Active Desk Alert:</span>{' '}
            {urgentRequests[0].bloodType} ({urgentRequests[0].unitsNeeded} units) at{' '}
            {urgentRequests[0].facilityZone}
          </div>
        )}

        {donors.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm font-medium text-slate-200">
              No screened donors within {radiusKm} km
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Drag the Search Radius slider above or expand Blood Types to allow compatible blood types.
            </p>
          </div>
        ) : (
          donors.map((donor) => {
            const isSelected = donor.id === selectedDonorId;
            const isOwnDonor = Boolean(currentUserId && donor.ownerUserId === currentUserId);
            const isLiveDonor =
              donor.id.startsWith('donor-live-') || donor.lastActiveMinutesAgo === 0;
            return (
              <div
                key={donor.id}
                className={`p-4 transition-colors ${
                  isSelected ? 'bg-rose-950/25' : 'hover:bg-[#111827]'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => onSelectDonor(donor.id)}
                    className="text-left flex-1 min-w-0 cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-rose-400 tabular-nums">
                        {donor.bloodType}
                      </span>
                      <span className="text-slate-600" aria-hidden="true">
                        ·
                      </span>
                      <span className="font-mono text-xs font-semibold text-slate-100 truncate">
                        {donor.anonymousHandle}
                      </span>
                      {isLiveDonor && (
                        <span className="text-[11px] font-medium text-emerald-400 shrink-0">
                          {isOwnDonor ? '· Live (You)' : '· Live'}
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-300 mt-1 truncate">
                      {donor.neighborhood}
                    </p>

                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400 mt-1.5 tabular-nums">
                      <span>{donor.distanceKm ?? '—'} km away</span>
                      <span aria-hidden="true">·</span>
                      <span>{donor.availabilityWindow}</span>
                    </div>

                    <div className="flex items-center gap-1.5 text-xs text-emerald-400 mt-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        Screening verified · {donor.donationCount} prior donations
                      </span>
                    </div>
                  </button>

                  {isOwnDonor ? (
                    <span className="min-h-[42px] px-3 py-2 rounded-xl border border-emerald-700/60 bg-emerald-950/40 text-emerald-300 text-xs font-medium flex items-center shrink-0">
                      Live Pin
                    </span>
                  ) : (
                    (() => {
                      const isUnlocked = unlockedDonorIds.includes(donor.id);
                      return (
                        <button
                          type="button"
                          onClick={() => onStartChat(donor)}
                          aria-label={
                            isUnlocked
                              ? `Message ${donor.anonymousHandle} anonymously`
                              : `Pay ₹50 to unlock chat with ${donor.anonymousHandle}`
                          }
                          data-testid={`discover-chat-btn-${donor.id}`}
                          className={`min-h-[42px] min-w-[42px] px-3 py-2 rounded-xl border text-xs font-medium flex items-center gap-1.5 shrink-0 cursor-pointer ${
                            isUnlocked
                              ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                              : 'bg-amber-600/20 hover:bg-amber-600/30 border-amber-500/50 text-amber-200'
                          }`}
                        >
                          {isUnlocked ? (
                            <>
                              <MessageSquare className="w-3.5 h-3.5 text-rose-400" />
                              <span className="hidden sm:inline">Message</span>
                            </>
                          ) : (
                            <>
                              <Lock className="w-3.5 h-3.5 text-amber-400" />
                              <span className="hidden sm:inline">Pay ₹50</span>
                              <IndianRupee className="w-3 h-3 sm:hidden text-amber-400" />
                            </>
                          )}
                        </button>
                      );
                    })()
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
