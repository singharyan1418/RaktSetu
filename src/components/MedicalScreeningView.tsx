import { useEffect, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  RefreshCw,
} from 'lucide-react';
import type {
  AnonymousDonor,
  BloodType,
  LatLng,
  SavedScreeningRecord,
  ScreeningAnswers,
  ScreeningEvaluation,
} from '../types';
import { ALL_BLOOD_TYPES, evaluateScreening } from '../utils/bloodLogic';
import { apiFetch } from '../lib/apiClient';

interface MedicalScreeningViewProps {
  userCenter: LatLng;
  defaultBloodType: BloodType;
  defaultNeighborhood: string;
  latestScreening: SavedScreeningRecord | null;
  onDonorRegistered: (donor: AnonymousDonor) => void;
  onScreeningSaved: (record: SavedScreeningRecord) => void;
  onBrowseDonors?: () => void;
}

const INITIAL_ANSWERS: ScreeningAnswers = {
  meetsAgeWeight: '',
  lastDonationRecent: '',
  recentIllness: '',
  takingMedications: '',
  recentProcedure: '',
  recentSurgery: '',
  bloodCondition: '',
};

interface QuestionSpec {
  key: keyof ScreeningAnswers;
  prompt: string;
  helper: string;
  options: Array<{ value: string; label: string }>;
}

const QUESTIONS: QuestionSpec[] = [
  {
    key: 'meetsAgeWeight',
    prompt: '1. Are you at least 18 years old and do you weigh at least 50 kg (110 lbs)?',
    helper: 'Baseline safety threshold to ensure safe blood volume recovery.',
    options: [
      { value: 'yes', label: 'Yes, I meet age and weight minimums' },
      { value: 'no', label: 'No' },
    ],
  },
  {
    key: 'lastDonationRecent',
    prompt: '2. When was your last whole blood donation?',
    helper: 'Whole blood donors require at least 56 days between donations.',
    options: [
      { value: 'never_or_over_56', label: 'Never donated or 56+ days ago' },
      { value: 'within_56_days', label: 'Within the last 56 days' },
    ],
  },
  {
    key: 'recentIllness',
    prompt: '3. Have you had a fever, flu, or active respiratory infection in the past 14 days?',
    helper: 'Donors must feel well and be fever-free on donation day.',
    options: [
      { value: 'no', label: 'No, I have felt healthy' },
      { value: 'yes', label: 'Yes, I had symptoms recently' },
    ],
  },
  {
    key: 'takingMedications',
    prompt: '4. Are you currently taking antibiotics or prescription blood thinners?',
    helper: 'Certain medications require a brief waiting window before donating.',
    options: [
      { value: 'no', label: 'No' },
      { value: 'yes', label: 'Yes' },
    ],
  },
  {
    key: 'recentProcedure',
    prompt: '5. Have you received a tattoo, piercing, or invasive dental surgery in the last 90 days?',
    helper: 'Helps prevent infectious deferral windows.',
    options: [
      { value: 'no', label: 'No' },
      { value: 'yes', label: 'Yes' },
    ],
  },
  {
    key: 'recentSurgery',
    prompt: '6. Have you had major surgery or received a blood transfusion in the last 6 months?',
    helper: 'Protects donor recovery and transfusion safety.',
    options: [
      { value: 'no', label: 'No' },
      { value: 'yes', label: 'Yes' },
    ],
  },
  {
    key: 'bloodCondition',
    prompt: '7. Do you have a history of anemia, low hemoglobin, or a chronic blood-borne condition?',
    helper: 'Hemoglobin levels are also verified on site via fingerstick.',
    options: [
      { value: 'no', label: 'No' },
      { value: 'yes', label: 'Yes' },
    ],
  },
];

export function MedicalScreeningView({
  userCenter,
  defaultBloodType,
  defaultNeighborhood,
  latestScreening,
  onDonorRegistered,
  onScreeningSaved,
  onBrowseDonors,
}: MedicalScreeningViewProps) {
  const [answers, setAnswers] = useState<ScreeningAnswers>(
    latestScreening?.answersJson || INITIAL_ANSWERS
  );
  const [evaluation, setEvaluation] = useState<ScreeningEvaluation | null>(() =>
    latestScreening?.answersJson ? evaluateScreening(latestScreening.answersJson) : null
  );
  const [retaking, setRetaking] = useState(false);
  const [bloodType, setBloodType] = useState<BloodType>(
    latestScreening?.bloodType || defaultBloodType || 'B+'
  );
  const [neighborhood, setNeighborhood] = useState(
    latestScreening?.neighborhood || defaultNeighborhood || 'Local Zone'
  );
  const [availabilityWindow, setAvailabilityWindow] = useState(
    latestScreening?.availabilityWindow || 'Available today within 1 hr'
  );
  const [regError, setRegError] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (latestScreening && !retaking) {
      setAnswers(latestScreening.answersJson || INITIAL_ANSWERS);
      setEvaluation(
        latestScreening.answersJson
          ? evaluateScreening(latestScreening.answersJson)
          : null
      );
      setBloodType(latestScreening.bloodType || defaultBloodType || 'B+');
      setNeighborhood(latestScreening.neighborhood || defaultNeighborhood || 'Local Zone');
      setAvailabilityWindow(
        latestScreening.availabilityWindow || 'Available today within 1 hr'
      );
    }
  }, [latestScreening, retaking, defaultBloodType, defaultNeighborhood]);

  const handleEvaluate = async (e: FormEvent) => {
    e.preventDefault();
    const result = evaluateScreening(answers);
    setEvaluation(result);
    setRegError(null);

    if (result.status === 'incomplete') {
      return;
    }

    // Always persist submitted screening form
    setEvaluating(true);
    try {
      const res = await apiFetch('/api/screenings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bloodType,
          neighborhood: neighborhood.trim() || 'Local Zone',
          availabilityWindow: availabilityWindow.trim() || 'Available today',
          lat: userCenter.lat,
          lng: userCenter.lng,
          screeningAnswers: answers,
          publishDonor: false,
        }),
      });
      const data = (await res.json()) as {
        screening?: SavedScreeningRecord;
        error?: string;
      };
      if (!res.ok || !data.screening) {
        throw new Error(data.error || 'Could not save screening record.');
      }
      onScreeningSaved(data.screening);
      setRetaking(false);
    } catch (err) {
      setRegError(err instanceof Error ? err.message : 'Unable to save screening.');
    } finally {
      setEvaluating(false);
    }
  };

  const handlePublishDonor = async (e: FormEvent) => {
    e.preventDefault();
    if (!neighborhood.trim() || !availabilityWindow.trim()) {
      setRegError(
        'Please provide an approximate neighborhood zone and availability window.'
      );
      return;
    }

    setRegError(null);
    setSubmitting(true);
    try {
      const res = await apiFetch('/api/screenings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bloodType,
          neighborhood: neighborhood.trim(),
          availabilityWindow: availabilityWindow.trim(),
          lat: userCenter.lat,
          lng: userCenter.lng,
          screeningAnswers: answers,
          publishDonor: true,
        }),
      });

      const data = (await res.json()) as {
        screening?: SavedScreeningRecord;
        donor?: AnonymousDonor | null;
        error?: string;
      };
      if (!res.ok || !data.donor) {
        throw new Error(data.error || 'Could not publish anonymous donor profile.');
      }

      if (data.screening) {
        onScreeningSaved(data.screening);
      }
      onDonorRegistered(data.donor);
    } catch (err) {
      setRegError(err instanceof Error ? err.message : 'Registration error.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#090D16] p-4 sm:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="bg-[#111827] border border-slate-800 rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-rose-400 mb-1">
              <ClipboardCheck className="w-4 h-4" />
              <span>Pre-Donation Eligibility Check</span>
            </div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-white">
              Preliminary Medical History Screening
            </h1>
          </div>
        </div>

        {latestScreening && !retaking ? (
          <section
            data-testid="saved-screening-card"
            className="bg-[#111827] border border-slate-800 rounded-2xl p-6 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Saved Screening On File</span>
                </div>
                <h2 className="font-display text-lg font-bold text-white mt-1">
                  Your medical screening is already saved ({latestScreening.bloodType} · {latestScreening.neighborhood})
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {onBrowseDonors && (
                  <button
                    type="button"
                    onClick={onBrowseDonors}
                    className="min-h-[40px] px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-white cursor-pointer"
                  >
                    Browse Nearby Donors
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setRetaking(true);
                  }}
                  data-testid="retake-screening-button"
                  className="min-h-[40px] px-4 py-2 rounded-xl border border-slate-700 bg-[#090D16] hover:bg-slate-800 text-xs font-medium text-slate-200 flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-rose-400" />
                  <span>Retake / Update Screening</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-slate-800/80">
              {QUESTIONS.map((q) => {
                const selectedVal = answers[q.key];
                const selectedLabel =
                  q.options.find((opt) => opt.value === selectedVal)?.label || 'Recorded';
                return (
                  <div
                    key={q.key}
                    className="rounded-xl bg-[#090D16] border border-slate-800/90 px-3.5 py-2.5"
                  >
                    <p className="text-[11px] text-slate-400">{q.prompt}</p>
                    <p className="text-xs font-medium text-slate-100 mt-1">
                      {selectedLabel}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>
        ) : (
          <form onSubmit={handleEvaluate} className="space-y-4">
            {QUESTIONS.map((q) => {
              const isMissing = evaluation?.missingFields.includes(q.key);
              return (
                <fieldset
                  key={q.key}
                  className={`bg-[#111827] border rounded-2xl p-5 transition-colors ${
                    isMissing
                      ? 'border-rose-500 bg-rose-950/20'
                      : 'border-slate-800'
                  }`}
                >
                  <legend className="text-sm font-semibold text-white">
                    {q.prompt}
                  </legend>
                  <p className="text-xs text-slate-400 mt-1 mb-3">{q.helper}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {q.options.map((opt) => {
                      const checked = answers[q.key] === opt.value;
                      return (
                        <label
                          key={opt.value}
                          className={`min-h-[44px] px-3.5 py-2.5 rounded-xl border text-xs font-medium flex items-center gap-2.5 cursor-pointer transition-colors ${
                            checked
                              ? 'bg-rose-600/20 text-white border-rose-500'
                              : 'bg-[#090D16] text-slate-300 border-slate-800 hover:bg-slate-800/70'
                          }`}
                        >
                          <input
                            type="radio"
                            name={q.key}
                            value={opt.value}
                            checked={checked}
                            onChange={() =>
                              setAnswers((prev) => ({
                                ...prev,
                                [q.key]: opt.value,
                              }))
                            }
                            className="w-4 h-4 accent-rose-500 shrink-0 cursor-pointer"
                          />
                          <span>{opt.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              );
            })}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAnswers(INITIAL_ANSWERS);
                    setEvaluation(null);
                  }}
                  className="min-h-[44px] px-4 py-2.5 rounded-xl border border-slate-700 bg-[#111827] hover:bg-slate-800 text-sm font-medium text-slate-200 cursor-pointer"
                >
                  Reset Responses
                </button>
                {latestScreening && retaking && (
                  <button
                    type="button"
                    onClick={() => setRetaking(false)}
                    className="min-h-[44px] px-4 py-2.5 rounded-xl border border-slate-700 bg-[#111827] hover:bg-slate-800 text-sm font-medium text-slate-300 cursor-pointer"
                  >
                    Keep Saved Screening
                  </button>
                )}
              </div>
              <button
                type="submit"
                disabled={evaluating}
                className="min-h-[44px] px-6 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white text-sm font-semibold cursor-pointer"
              >
                {evaluating ? 'Saving & Evaluating...' : 'Evaluate & Save Screening'}
              </button>
            </div>
          </form>
        )}

        {evaluation && (
          <div
            data-testid="screening-result"
            className={`rounded-2xl border p-6 ${
              evaluation.status === 'eligible'
                ? 'bg-emerald-950/25 border-emerald-800/70'
                : evaluation.status === 'temporary_deferral'
                  ? 'bg-amber-950/25 border-amber-800/70'
                  : 'bg-rose-950/25 border-rose-800/70'
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                {evaluation.status === 'eligible' ? (
                  <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0 mt-0.5" />
                ) : evaluation.status === 'temporary_deferral' ? (
                  <Clock className="w-6 h-6 text-amber-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-6 h-6 text-rose-400 shrink-0 mt-0.5" />
                )}
                <div>
                  <h2 className="font-display text-lg font-bold text-white">
                    {evaluation.title}
                  </h2>
                  {evaluation.reasons.length > 1 && (
                    <ul className="mt-3 space-y-1 text-xs text-slate-300 list-disc list-inside">
                      {evaluation.reasons.slice(1).map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>

            {evaluation.status === 'eligible' && (
              <form
                onSubmit={handlePublishDonor}
                className="mt-6 pt-5 border-t border-emerald-800/50 space-y-4"
              >

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label
                      htmlFor="donor-blood-type"
                      className="block text-xs font-medium text-slate-300 mb-1"
                    >
                      Your Blood Type
                    </label>
                    <select
                      id="donor-blood-type"
                      value={bloodType}
                      onChange={(e) => setBloodType(e.target.value as BloodType)}
                      className="w-full min-h-[44px] rounded-xl border border-slate-700 bg-[#090D16] px-3 text-sm font-mono font-semibold text-white"
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
                      htmlFor="donor-zone"
                      className="block text-xs font-medium text-slate-300 mb-1"
                    >
                      General Neighborhood Zone
                    </label>
                    <input
                      id="donor-zone"
                      type="text"
                      value={neighborhood}
                      onChange={(e) => setNeighborhood(e.target.value)}
                      placeholder="e.g., Central Medical Zone"
                      className="w-full min-h-[44px] rounded-xl border border-slate-700 bg-[#090D16] px-3 text-sm text-white"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="donor-availability"
                      className="block text-xs font-medium text-slate-300 mb-1"
                    >
                      Availability Window
                    </label>
                    <input
                      id="donor-availability"
                      type="text"
                      value={availabilityWindow}
                      onChange={(e) => setAvailabilityWindow(e.target.value)}
                      placeholder="e.g., Available today until 8pm"
                      className="w-full min-h-[44px] rounded-xl border border-slate-700 bg-[#090D16] px-3 text-sm text-white"
                    />
                  </div>
                </div>

                {regError && <p className="text-xs text-rose-400">{regError}</p>}

                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[44px] px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white text-sm font-semibold cursor-pointer"
                >
                  {submitting
                    ? 'Publishing Anonymous Pin...'
                    : 'Go Live Anonymously on Donor Map'}
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
