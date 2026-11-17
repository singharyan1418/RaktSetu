import { useCallback, useEffect, useState } from 'react';
import {
  APILoadingStatus,
  APIProvider,
  AdvancedMarker,
  Circle,
  InfoWindow,
  Map as GoogleMap,
  useAdvancedMarkerRef,
  useApiLoadingStatus,
  useMap,
} from '@vis.gl/react-google-maps';
import {
  AlertCircle,
  CheckCircle2,
  IndianRupee,
  Lock,
  MapPin,
  MessageSquare,
  Minimize2,
  Navigation,
  ShieldCheck,
} from 'lucide-react';
import type { AnonymousDonor, BloodType, LatLng, UrgentRequest } from '../types';
import { getCircleBounds } from '../utils/bloodLogic';

interface DonorMapViewProps {
  mapsApiKey: string;
  userCenter: LatLng;
  radiusKm: number;
  onRadiusChange?: (km: number) => void;
  selectedBloodType: BloodType;
  donors: AnonymousDonor[];
  urgentRequests: UrgentRequest[];
  selectedDonorId: string | null;
  onSelectDonor: (donorId: string | null) => void;
  onStartChat: (donor: AnonymousDonor) => void;
  unlockedDonorIds: string[];
  onRequestUnlockDonor: (donor: AnonymousDonor) => void;
  locationConsented: boolean;
  onMinimizeMap?: () => void;
  currentUserId?: number;
}

interface DonorMarkerProps {
  donor: AnonymousDonor;
  isSelected: boolean;
  isUnlocked: boolean;
  isOwnDonor: boolean;
  onSelect: (donorId: string) => void;
  onStartChat: (donor: AnonymousDonor) => void;
  onRequestUnlock: (donor: AnonymousDonor) => void;
  onClose: () => void;
}

function DonorMarkerWithInfo({
  donor,
  isSelected,
  isUnlocked,
  isOwnDonor,
  onSelect,
  onStartChat,
  onRequestUnlock,
  onClose,
}: DonorMarkerProps) {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const isLiveDonor =
    donor.id.startsWith('donor-live-') || donor.lastActiveMinutesAgo === 0;

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={donor.approxLocation}
        title={`${donor.anonymousHandle} (${donor.bloodType})`}
        onClick={() => onSelect(donor.id)}
        zIndex={isSelected ? 30 : isOwnDonor ? 25 : donor.isExactMatch ? 20 : 10}
      >
        <div
          data-testid={`map-donor-pin-${donor.id}`}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full font-mono text-xs font-semibold shadow-md border transition-transform cursor-pointer ${
            isSelected
              ? 'bg-white text-slate-950 border-rose-500 scale-110'
              : isOwnDonor
                ? 'bg-emerald-600 text-white border-emerald-200 hover:scale-105'
                : isLiveDonor
                  ? 'bg-rose-600 text-white border-emerald-300 hover:scale-105'
                  : donor.isExactMatch
                    ? 'bg-rose-600 text-white border-rose-300 hover:scale-105'
                    : 'bg-[#111827] text-slate-100 border-slate-600 hover:border-rose-400'
          }`}
        >
          {isLiveDonor && (
            <span className="w-2 h-2 rounded-full bg-emerald-300 shrink-0" />
          )}
          <span>{donor.bloodType}</span>
          {donor.distanceKm !== undefined && (
            <span className="opacity-80 text-[10px] tabular-nums">
              {donor.distanceKm}km
            </span>
          )}
        </div>
      </AdvancedMarker>

      {isSelected && marker && (
        <InfoWindow anchor={marker} onCloseClick={onClose} maxWidth={260}>
          <div className="p-1 text-slate-900 font-sans" data-testid="map-selected-donor-card">
            <div className="flex items-center justify-between gap-2 mb-0.5">
              <span className="font-mono text-xs font-semibold text-slate-900">
                {donor.anonymousHandle}
              </span>
              <span className="font-mono text-xs font-bold text-rose-700">
                {donor.bloodType}
              </span>
            </div>
            <p className="text-[11px] text-slate-600 mb-1">{donor.neighborhood}</p>
            <div className="text-[11px] text-slate-600 mb-2 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
              <span>
                {isOwnDonor
                  ? 'Your Live Pin · Visible to other users'
                  : isLiveDonor
                    ? 'Live Donor · Screened ~800m zone'
                    : 'Screened · ~800m zone'}
              </span>
            </div>
            {isOwnDonor ? (
              <div className="w-full px-2.5 py-1.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-semibold rounded-lg text-center">
                Active Live Donor Pin
              </div>
            ) : isUnlocked ? (
              <button
                type="button"
                onClick={() => onStartChat(donor)}
                data-testid="map-unlocked-chat-button"
                className="w-full min-h-[36px] px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium rounded-lg flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Message Anonymously</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onRequestUnlock(donor)}
                data-testid="map-pay-to-unlock-button"
                className="w-full min-h-[36px] px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Pay ₹50 to Unlock Chat</span>
              </button>
            )}
          </div>
        </InfoWindow>
      )}
    </>
  );
}

function MapCameraSync({
  userCenter,
  radiusKm,
  selectedDonor,
}: {
  userCenter: LatLng;
  radiusKm: number;
  selectedDonor: AnonymousDonor | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;
    if (selectedDonor) {
      map.panTo(selectedDonor.approxLocation);
      return;
    }
    const bounds = getCircleBounds(userCenter, radiusKm);
    map.fitBounds(bounds, 40);
  }, [map, userCenter, radiusKm, selectedDonor]);

  return null;
}

function MapsInnerCanvas({
  userCenter,
  radiusKm,
  onRadiusChange,
  donors,
  urgentRequests,
  selectedDonorId,
  onSelectDonor,
  onStartChat,
  unlockedDonorIds,
  onRequestUnlock,
  locationConsented,
  selectedBloodType,
  onMinimizeMap,
  currentUserId,
}: Omit<DonorMapViewProps, 'mapsApiKey'> & {
  onRequestUnlock: (donor: AnonymousDonor) => void;
}) {
  const status = useApiLoadingStatus();
  const map = useMap();
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const selectedDonor = donors.find((d) => d.id === selectedDonorId) || null;

  useEffect(() => {
    if (map && status === APILoadingStatus.LOADED) {
      setLoadTimedOut(false);
      return;
    }
    const timer = setTimeout(() => {
      if (!map || status !== APILoadingStatus.LOADED) {
        setLoadTimedOut(true);
      }
    }, 2500);
    return () => clearTimeout(timer);
  }, [map, status]);

  const handleCloseInfo = useCallback(() => {
    onSelectDonor(null);
  }, [onSelectDonor]);

  if (
    status === APILoadingStatus.FAILED ||
    status === APILoadingStatus.AUTH_FAILURE ||
    loadTimedOut
  ) {
    return (
      <FallbackSpatialRadar
        userCenter={userCenter}
        radiusKm={radiusKm}
        onRadiusChange={onRadiusChange}
        donors={donors}
        selectedDonorId={selectedDonorId}
        selectedBloodType={selectedBloodType}
        onSelectDonor={onSelectDonor}
        onStartChat={onStartChat}
        unlockedDonorIds={unlockedDonorIds}
        onRequestUnlock={onRequestUnlock}
        onMinimizeMap={onMinimizeMap}
        currentUserId={currentUserId}
        reason="Google Maps tiles unavailable in this environment. Showing live dark privacy-zone spatial view."
      />
    );
  }

  return (
    <div className="relative w-full h-full min-h-[260px] overflow-hidden bg-[#090D16]" data-testid="google-map-container">
      <div
        className="sr-only"
        data-testid="search-radius-circle"
        data-radius-km={radiusKm}
        data-radius-meters={radiusKm * 1000}
      />
      <GoogleMap
        mapId="DEMO_MAP_ID"
        colorScheme="DARK"
        defaultCenter={userCenter}
        defaultZoom={12}
        gestureHandling="greedy"
        disableDefaultUI={false}
        streetViewControl={false}
        mapTypeControl={false}
        internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
        className="w-full h-full"
        onClick={() => onSelectDonor(null)}
      >
        <MapCameraSync
          userCenter={userCenter}
          radiusKm={radiusKm}
          selectedDonor={selectedDonor}
        />

        {/* Visual Search Radius Circular Overlay */}
        <Circle
          center={userCenter}
          radius={radiusKm * 1000}
          strokeColor="#FB7185"
          strokeOpacity={0.95}
          strokeWeight={2.5}
          fillColor="#F43F5E"
          fillOpacity={0.14}
          clickable={false}
        />

        {selectedDonor && (
          <Circle
            center={selectedDonor.approxLocation}
            radius={selectedDonor.privacyRadiusMeters}
            strokeColor="#E2E8F0"
            strokeOpacity={0.75}
            strokeWeight={1.5}
            fillColor="#E2E8F0"
            fillOpacity={0.12}
            clickable={false}
          />
        )}

        <AdvancedMarker position={userCenter} title="Your Default Location">
          <div className="w-5 h-5 rounded-full bg-emerald-500 border-2 border-white shadow-md flex items-center justify-center">
            <Navigation className="w-2.5 h-2.5 text-slate-950" />
          </div>
        </AdvancedMarker>

        {urgentRequests.map((req) => (
          <AdvancedMarker
            key={req.id}
            position={req.location}
            title={`Urgent ${req.bloodType} Request — ${req.facilityZone}`}
          >
            <div className="px-2 py-1 rounded bg-amber-950 text-amber-200 border border-amber-500/60 text-[11px] font-medium shadow">
              {req.bloodType} Desk · {req.unitsNeeded}u
            </div>
          </AdvancedMarker>
        ))}

        {donors.map((donor) => (
          <DonorMarkerWithInfo
            key={donor.id}
            donor={donor}
            isSelected={donor.id === selectedDonorId}
            isUnlocked={unlockedDonorIds.includes(donor.id)}
            isOwnDonor={Boolean(currentUserId && donor.ownerUserId === currentUserId)}
            onSelect={(id) => onSelectDonor(id)}
            onStartChat={onStartChat}
            onRequestUnlock={onRequestUnlock}
            onClose={handleCloseInfo}
          />
        ))}
      </GoogleMap>

      {status !== APILoadingStatus.LOADED && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-[#090D16]/75 text-xs text-slate-300">
          Loading interactive donor map...
        </div>
      )}

      {/* Top-left floating Radius Overlay HUD */}
      <div
        data-testid="map-radius-hud"
        className="absolute top-3 left-3 z-20 bg-[#111827]/95 backdrop-blur-sm border border-slate-700 rounded-xl px-3 py-2 shadow-md flex flex-col gap-1.5 min-w-[175px]"
      >
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="text-slate-300 font-medium">Search Zone</span>
          <span
            data-testid="map-radius-readout"
            data-radius-km={radiusKm}
            className="font-mono font-bold text-rose-400 tabular-nums"
          >
            {radiusKm} km
          </span>
        </div>
        {onRadiusChange && (
          <input
            type="range"
            min={1}
            max={50}
            step={1}
            value={radiusKm}
            onChange={(e) => onRadiusChange(Number(e.target.value))}
            aria-label="Map search radius in kilometers"
            data-testid="map-radius-slider"
            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-rose-500"
          />
        )}
      </div>

      {/* Top-right minimize button & bottom privacy bar */}
      {onMinimizeMap && (
        <button
          type="button"
          onClick={onMinimizeMap}
          className="absolute top-3 right-3 z-20 min-h-[36px] px-3 py-1.5 rounded-xl bg-[#111827]/95 border border-slate-700 hover:bg-slate-800 text-xs font-medium text-slate-100 flex items-center gap-1.5 shadow-md cursor-pointer"
        >
          <Minimize2 className="w-3.5 h-3.5 text-rose-400" />
          <span>Minimize Map</span>
        </button>
      )}

      <div className="hidden sm:flex pointer-events-none absolute bottom-3 left-3 right-3 items-center justify-between gap-2">
        <div className="pointer-events-auto bg-[#111827]/95 backdrop-blur-sm border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 shadow-sm flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-rose-400 shrink-0" />
          <span>
            {locationConsented
              ? `Current GPS active · ${radiusKm} km search circle · Donor pins blurred ~800m`
              : `Default center active · ${radiusKm} km search circle · Donor pins blurred ~800m`}
          </span>
        </div>
      </div>
    </div>
  );
}

function FallbackSpatialRadar({
  userCenter,
  radiusKm,
  onRadiusChange,
  donors,
  selectedDonorId,
  selectedBloodType,
  onSelectDonor,
  onStartChat,
  unlockedDonorIds,
  onRequestUnlock,
  onMinimizeMap,
  currentUserId,
  reason,
}: {
  userCenter: LatLng;
  radiusKm: number;
  onRadiusChange?: (km: number) => void;
  donors: AnonymousDonor[];
  selectedDonorId: string | null;
  selectedBloodType: BloodType;
  onSelectDonor: (id: string | null) => void;
  onStartChat: (donor: AnonymousDonor) => void;
  unlockedDonorIds: string[];
  onRequestUnlock: (donor: AnonymousDonor) => void;
  onMinimizeMap?: () => void;
  currentUserId?: number;
  reason: string;
}) {
  const selectedDonor = donors.find((d) => d.id === selectedDonorId) || null;
  const isSelectedUnlocked = selectedDonor ? unlockedDonorIds.includes(selectedDonor.id) : false;
  const isSelectedOwn = Boolean(
    selectedDonor && currentUserId && selectedDonor.ownerUserId === currentUserId
  );
  const clampedRadius = Math.min(50, Math.max(1, radiusKm));
  const circleRadiusSvg = Number((10 + (clampedRadius / 50) * 34).toFixed(2));

  const projectPoint = (loc: LatLng) => {
    const scale = 1200 / Math.max(radiusKm, 3);
    const dx = (loc.lng - userCenter.lng) * scale * 0.78;
    const dy = -(loc.lat - userCenter.lat) * scale;
    const x = Math.max(12, Math.min(88, 50 + dx * 32));
    const y = Math.max(14, Math.min(84, 50 + dy * 32));
    return { x, y };
  };

  return (
    <div
      className="relative w-full h-full bg-[#0B1220] border border-slate-800 overflow-hidden flex flex-col justify-between"
      data-testid="fallback-spatial-map"
    >
      {/* Background Spatial Grid */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <pattern id="gridPatternDark" width="10" height="10" patternUnits="userSpaceOnUse">
            <path
              d="M 10 0 L 0 0 0 10"
              fill="none"
              stroke="rgba(148, 163, 184, 0.08)"
              strokeWidth="0.3"
            />
          </pattern>
        </defs>
        <rect width="100" height="100" fill="url(#gridPatternDark)" />
      </svg>

      {/* Geometrically True Dynamic Circular Search Radius Overlay */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <svg
          className="h-[92%] max-w-[92%] aspect-square"
          viewBox="0 0 100 100"
          aria-hidden="true"
        >
          <circle
            cx="50"
            cy="50"
            r={circleRadiusSvg}
            fill="rgba(244, 63, 94, 0.14)"
            stroke="rgba(251, 113, 133, 0.92)"
            strokeWidth="0.9"
            strokeDasharray="2.2 1.4"
            data-testid="search-radius-circle"
            data-radius-km={radiusKm}
          />
          <circle
            cx="50"
            cy="50"
            r={Number((circleRadiusSvg * 0.5).toFixed(2))}
            fill="none"
            stroke="rgba(148, 163, 184, 0.22)"
            strokeWidth="0.45"
          />
        </svg>
      </div>

      {/* Top Controls Row: Status + Radius HUD + Minimize */}
      <div className="relative z-10 m-3 flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-start gap-2">
          <div className="bg-[#111827]/95 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 flex items-center gap-2 max-w-xs shadow-sm">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{reason}</span>
          </div>

          <div
            data-testid="map-radius-hud"
            className="bg-[#111827]/95 border border-slate-700 rounded-xl px-3 py-2 shadow-sm flex flex-col gap-1 min-w-[155px]"
          >
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-slate-300 font-medium">Search Circle</span>
              <span
                data-testid="map-radius-readout"
                data-radius-km={radiusKm}
                className="font-mono font-bold text-rose-400 tabular-nums"
              >
                {radiusKm} km
              </span>
            </div>
            {onRadiusChange && (
              <input
                type="range"
                min={1}
                max={50}
                step={1}
                value={radiusKm}
                onChange={(e) => onRadiusChange(Number(e.target.value))}
                aria-label="Map search radius in kilometers"
                data-testid="map-radius-slider"
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-rose-500"
              />
            )}
          </div>
        </div>

        {onMinimizeMap && (
          <button
            type="button"
            onClick={onMinimizeMap}
            className="min-h-[36px] px-3 py-1.5 rounded-xl bg-[#111827]/95 border border-slate-700 hover:bg-slate-800 text-xs font-medium text-slate-100 flex items-center gap-1.5 shrink-0 cursor-pointer"
          >
            <Minimize2 className="w-3.5 h-3.5 text-rose-400" />
            <span>Minimize Map</span>
          </button>
        )}
      </div>

      <div
        className="absolute z-10 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
        style={{ left: '50%', top: '50%' }}
      >
        <div className="w-4 h-4 rounded-full bg-emerald-500 border-2 border-white shadow" />
      </div>

      {donors.map((donor) => {
        const pos = projectPoint(donor.approxLocation);
        const isSelected = donor.id === selectedDonorId;
        const isOwnDonor = Boolean(currentUserId && donor.ownerUserId === currentUserId);
        const isLiveDonor =
          donor.id.startsWith('donor-live-') || donor.lastActiveMinutesAgo === 0;
        return (
          <button
            key={donor.id}
            type="button"
            onClick={() => onSelectDonor(donor.id)}
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            data-testid={`map-donor-pin-${donor.id}`}
            aria-label={`Select ${donor.anonymousHandle}, blood type ${donor.bloodType}`}
            className={`absolute z-20 -translate-x-1/2 -translate-y-1/2 min-h-[36px] px-2.5 py-1 rounded-full font-mono text-xs font-semibold border shadow-sm transition-transform cursor-pointer flex items-center gap-1.5 ${
              isSelected
                ? 'bg-white text-slate-950 border-rose-500 scale-110'
                : isOwnDonor
                  ? 'bg-emerald-600 text-white border-emerald-200 hover:scale-105'
                  : isLiveDonor
                    ? 'bg-rose-600 text-white border-emerald-300 hover:scale-105'
                    : donor.isExactMatch
                      ? 'bg-rose-600 text-white border-rose-300 hover:scale-105'
                      : 'bg-[#111827] text-slate-100 border-slate-600 hover:border-rose-400'
            }`}
          >
            {isLiveDonor && (
              <span className="w-2 h-2 rounded-full bg-emerald-300 shrink-0" />
            )}
            <span>{donor.bloodType}</span>
          </button>
        );
      })}

      <div className="relative z-20 m-3 flex items-end justify-between gap-3">
        {selectedDonor ? (
          <div
            className="bg-[#111827] border border-slate-800 rounded-2xl p-3.5 shadow-md max-w-sm w-full"
            data-testid="map-selected-donor-card"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-semibold text-white">
                {selectedDonor.anonymousHandle}
              </span>
              <span className="font-mono text-xs font-bold text-rose-400">
                {selectedDonor.bloodType} · {selectedDonor.distanceKm ?? '—'} km
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-1">{selectedDonor.neighborhood}</p>
            <p className="text-xs text-slate-400 mt-0.5 mb-2.5">
              {selectedDonor.availabilityWindow}
            </p>
            {isSelectedOwn ? (
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-400 bg-emerald-950/40 border border-emerald-800/60 rounded-lg px-3 py-2">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>Your Live Donor Pin · Visible on map to other users</span>
              </div>
            ) : isSelectedUnlocked ? (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>₹50 Paid · Anonymous Chat Unlocked</span>
                </div>
                <button
                  type="button"
                  onClick={() => onStartChat(selectedDonor)}
                  data-testid="map-unlocked-chat-button"
                  className="w-full min-h-[40px] px-3 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium rounded-lg flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>Message Anonymously</span>
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[11px] text-amber-300 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 shrink-0" />
                  <span>Donor spotted on map · Pay ₹50 to unlock direct chat</span>
                </p>
                <button
                  type="button"
                  onClick={() => onRequestUnlock(selectedDonor)}
                  data-testid="map-pay-to-unlock-button"
                  className="w-full min-h-[40px] px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <IndianRupee className="w-3.5 h-3.5" />
                  <span>Pay ₹50 to Unlock Chat</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-[#111827]/95 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 flex items-center gap-2">
            <MapPin className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            <span>
              Showing {donors.length} compatible donors for {selectedBloodType} within{' '}
              {radiusKm} km
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function DonorMapView(props: DonorMapViewProps) {
  const [mapsUnavailable, setMapsUnavailable] = useState(false);

  useEffect(() => {
    const onQuotaOrAuth = () => setMapsUnavailable(true);
    window.addEventListener('gmp-quota-exceeded', onQuotaOrAuth);
    (window as unknown as { gm_authFailure?: () => void }).gm_authFailure = () =>
      setMapsUnavailable(true);
    return () => {
      window.removeEventListener('gmp-quota-exceeded', onQuotaOrAuth);
    };
  }, []);

  const mapContent =
    !props.mapsApiKey || mapsUnavailable ? (
      <FallbackSpatialRadar
        userCenter={props.userCenter}
        radiusKm={props.radiusKm}
        onRadiusChange={props.onRadiusChange}
        donors={props.donors}
        selectedDonorId={props.selectedDonorId}
        selectedBloodType={props.selectedBloodType}
        onSelectDonor={props.onSelectDonor}
        onStartChat={props.onStartChat}
        unlockedDonorIds={props.unlockedDonorIds}
        onRequestUnlock={props.onRequestUnlockDonor}
        onMinimizeMap={props.onMinimizeMap}
        currentUserId={props.currentUserId}
        reason={
          mapsUnavailable
            ? 'Google Maps Platform demo quota reached; dark interactive donor privacy zones remain active.'
            : 'Google Maps key pending configuration. Dark interactive spatial donor radar active.'
        }
      />
    ) : (
      <APIProvider apiKey={props.mapsApiKey} libraries={['marker']} language="en" region="US">
        <MapsInnerCanvas
          userCenter={props.userCenter}
          radiusKm={props.radiusKm}
          onRadiusChange={props.onRadiusChange}
          donors={props.donors}
          urgentRequests={props.urgentRequests}
          selectedDonorId={props.selectedDonorId}
          onSelectDonor={props.onSelectDonor}
          onStartChat={props.onStartChat}
          unlockedDonorIds={props.unlockedDonorIds}
          onRequestUnlock={props.onRequestUnlockDonor}
          onRequestUnlockDonor={props.onRequestUnlockDonor}
          locationConsented={props.locationConsented}
          selectedBloodType={props.selectedBloodType}
          onMinimizeMap={props.onMinimizeMap}
          currentUserId={props.currentUserId}
        />
      </APIProvider>
    );

  return <div className="relative w-full h-full">{mapContent}</div>;
}
