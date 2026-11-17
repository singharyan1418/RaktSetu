import { useEffect, useRef, useState, type FormEvent } from 'react';
import { HeartPulse, Send, Volume2, VolumeX } from 'lucide-react';
import type { HealthChatMessage } from '../types';
import { formatCleanHealthText } from '../utils/bloodLogic';
import { useTtsPlayer } from '../hooks/useTtsPlayer';
import { apiFetch } from '../lib/apiClient';
import { auth } from '../lib/firebase';
import {
  loadHealthChatsFromFirestore,
  syncHealthChatToFirestore,
} from '../lib/firestoreStore';

const SUGGESTED_HEALTH_TOPICS = [
  'What minimum hemoglobin level is required to donate blood safely?',
  'I feel dizzy after donating blood—what should I do right now?',
  'Can I donate blood if I took ibuprofen or antibiotics recently?',
  'Which foods help replenish iron stores fastest after blood donation?',
];

export function GuidanceAndVoiceView() {
  const [healthMessages, setHealthMessages] = useState<HealthChatMessage[]>([]);
  const [healthInput, setHealthInput] = useState('');
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);
  const healthEndRef = useRef<HTMLDivElement | null>(null);

  const { playingId, loadingId, ttsError, speak, stop: stopTts } = useTtsPlayer();

  useEffect(() => {
    let cancelled = false;
    async function loadHistory() {
      let serverMsgs: HealthChatMessage[] = [];
      try {
        const res = await apiFetch('/api/ai/health-chat');
        if (res.ok) {
          const data = (await res.json()) as { messages?: HealthChatMessage[] };
          if (data.messages) serverMsgs = data.messages;
        }
      } catch {
        // Ignore server load error
      }

      if (auth.currentUser) {
        try {
          const fsMsgs = await loadHealthChatsFromFirestore(auth.currentUser.uid);
          if (fsMsgs.length > serverMsgs.length) {
            serverMsgs = fsMsgs;
          }
        } catch {
          // Ignore Firestore error
        }
      }

      if (!cancelled && serverMsgs.length > 0) {
        setHealthMessages(serverMsgs);
      }
    }
    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    healthEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
  }, [healthMessages.length]);

  useEffect(() => {
    return () => {
      stopTts();
    };
  }, [stopTts]);

  const sendHealthQuestion = async (textToSend: string) => {
    if (!textToSend.trim()) {
      setHealthError('Describe your health question or symptom first.');
      return;
    }
    setHealthError(null);
    setHealthLoading(true);
    try {
      const res = await apiFetch('/api/ai/health-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: textToSend.trim() }),
      });
      const data = (await res.json()) as {
        userMessage?: HealthChatMessage;
        assistantMessage?: HealthChatMessage;
        error?: string;
      };
      if (!res.ok || !data.userMessage || !data.assistantMessage) {
        throw new Error(data.error || 'Could not get health guidance.');
      }
      setHealthMessages((prev) => [
        ...prev,
        data.userMessage!,
        data.assistantMessage!,
      ]);
      if (auth.currentUser) {
        void syncHealthChatToFirestore(auth.currentUser.uid, data.userMessage).catch(
          () => {}
        );
        void syncHealthChatToFirestore(
          auth.currentUser.uid,
          data.assistantMessage
        ).catch(() => {});
      }
      setHealthInput('');
    } catch (err) {
      setHealthError(
        err instanceof Error ? err.message : 'Health assistant error.'
      );
    } finally {
      setHealthLoading(false);
    }
  };

  const handleHealthSubmit = (e: FormEvent) => {
    e.preventDefault();
    void sendHealthQuestion(healthInput);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#090D16] p-4 sm:p-8">
      <div className="max-w-4xl mx-auto space-y-5">
        <section className="bg-[#111827] border border-slate-800 rounded-2xl p-6 space-y-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-rose-400">
              <HeartPulse className="w-4 h-4" />
              <span>AI Health Assistant</span>
            </div>
            <h1 className="font-display text-xl font-bold tracking-tight text-white mt-1">
              Ask About Health Issues, Effective Tips &amp; Important Concerns
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Describe any symptom, recovery concern, hemoglobin question, or donation prep issue to receive structured self-care tips and clinical warning signs.
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {SUGGESTED_HEALTH_TOPICS.map((topic) => (
              <button
                key={topic}
                type="button"
                onClick={() => setHealthInput(topic)}
                className="text-left text-xs px-3 py-1.5 rounded-lg bg-[#090D16] border border-slate-800 hover:bg-slate-800 text-slate-300 cursor-pointer"
              >
                {topic}
              </button>
            ))}
          </div>

          <div
            className="bg-[#090D16] border border-slate-800 rounded-xl p-4 h-[380px] overflow-y-auto space-y-3"
            data-testid="ai-health-chat-history"
          >
            {healthMessages.length === 0 ? (
              <p className="text-xs text-slate-400 text-center pt-16">
                Ask any health question below. RaktSetu AI provides practical tips, blood donation safety checks, and when to contact a doctor.
              </p>
            ) : (
              healthMessages.map((msg) => {
                const cleanText =
                  msg.role === 'assistant'
                    ? formatCleanHealthText(msg.text)
                    : msg.text;
                const isPlaying = playingId === msg.id;
                const isLoading = loadingId === msg.id;
                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${
                      msg.role === 'user' ? 'items-end' : 'items-start'
                    }`}
                  >
                    <span className="text-[11px] font-medium text-slate-400 mb-1 px-1">
                      {msg.role === 'user' ? 'You' : 'RaktSetu Health AI'}
                    </span>
                    <div
                      className={`max-w-2xl rounded-2xl px-4 py-3 text-xs sm:text-sm leading-relaxed whitespace-pre-wrap border ${
                        msg.role === 'user'
                          ? 'bg-rose-600/20 border-rose-500/40 text-slate-100'
                          : 'bg-[#111827] border-slate-800 text-slate-200'
                      }`}
                    >
                      <div>{cleanText}</div>
                      {msg.role === 'assistant' && (
                        <div className="mt-2 flex justify-end">
                          <button
                            type="button"
                            onClick={() =>
                              speak(
                                msg.id,
                                cleanText,
                                'Calm, clear, reassuring medical coordinator'
                              )
                            }
                            aria-label={
                              isPlaying
                                ? 'Stop reading guidance'
                                : 'Read guidance aloud'
                            }
                            className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md transition-colors text-slate-300 hover:text-white hover:bg-slate-800 cursor-pointer"
                          >
                            {isPlaying ? (
                              <VolumeX className="w-3.5 h-3.5 text-rose-400" />
                            ) : (
                              <Volume2 className="w-3.5 h-3.5 text-rose-400" />
                            )}
                            <span>
                              {isLoading
                                ? 'Synthesizing...'
                                : isPlaying
                                  ? 'Stop Audio'
                                  : 'Read Aloud'}
                            </span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
            {healthLoading && (
              <div className="flex flex-col items-start">
                <span className="text-[11px] font-medium text-slate-400 mb-1 px-1">
                  RaktSetu Health AI
                </span>
                <div className="rounded-2xl px-4 py-3 text-xs text-slate-300 bg-[#111827] border border-slate-800">
                  Analyzing your question and clinical guidelines...
                </div>
              </div>
            )}
            <div ref={healthEndRef} />
          </div>

          {healthError && (
            <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-800 text-xs text-rose-200">
              {healthError}
            </div>
          )}

          {ttsError && (
            <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-800 text-xs text-rose-200">
              {ttsError}
            </div>
          )}

          <form onSubmit={handleHealthSubmit} className="flex items-center gap-2">
            <label htmlFor="health-chat-input" className="sr-only">
              Ask a health question
            </label>
            <input
              id="health-chat-input"
              type="text"
              value={healthInput}
              onChange={(e) => setHealthInput(e.target.value)}
              placeholder="Ask about dizziness, low iron, fatigue, medications, or donation recovery..."
              className="flex-1 min-h-[44px] rounded-xl bg-[#090D16] border border-slate-800 px-3.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-rose-500"
            />
            <button
              type="submit"
              disabled={healthLoading}
              className="min-h-[44px] px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white text-sm font-semibold flex items-center gap-2 shrink-0 cursor-pointer"
            >
              <Send className="w-4 h-4" />
              <span>{healthLoading ? 'Thinking...' : 'Ask AI'}</span>
            </button>
          </form>
        </section>

        <p className="text-xs text-slate-500 text-center">
          AI Health responses are informational only. Final clinical evaluation and blood donation clearance are determined exclusively by licensed healthcare staff.
        </p>
      </div>
    </div>
  );
}
