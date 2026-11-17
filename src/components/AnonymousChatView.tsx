import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  IndianRupee,
  Lock,
  Send,
  Settings,
  ShieldCheck,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { ChatThread, UserProfile } from '../types';
import { detectPiiWarning, generateAnonymousSenderLabel } from '../utils/bloodLogic';
import { useTtsPlayer } from '../hooks/useTtsPlayer';

interface AnonymousChatViewProps {
  currentUser: UserProfile;
  threads: ChatThread[];
  activeThreadId: string | null;
  unlockedDonorIds: string[];
  onSelectThread: (threadId: string | null) => void;
  onRequestUnlockThread: (thread: ChatThread) => void;
  onSendMessage: (
    threadId: string,
    senderRole: 'recipient' | 'donor',
    text: string
  ) => Promise<void> | void;
  wsConnected: boolean;
  connectedClients: number;
  onOpenDiscover: () => void;
  onOpenSettings: () => void;
}

export function AnonymousChatView({
  currentUser,
  threads,
  activeThreadId,
  unlockedDonorIds,
  onSelectThread,
  onRequestUnlockThread,
  onSendMessage,
  wsConnected,
  connectedClients,
  onOpenDiscover,
  onOpenSettings,
}: AnonymousChatViewProps) {
  const [draft, setDraft] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const { playingId, loadingId, ttsError, speak, stop } = useTtsPlayer();

  const candidateThread = activeThreadId
    ? threads.find((t) => t.id === activeThreadId) || null
    : null;
  const activeThread =
    candidateThread && unlockedDonorIds.includes(candidateThread.donorId)
      ? candidateThread
      : null;

  const piiWarning = draft.trim() ? detectPiiWarning(draft) : null;
  const mySenderLabel = generateAnonymousSenderLabel(
    currentUser.role,
    currentUser.id,
    currentUser.bloodType
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
  }, [activeThread?.messages.length]);

  useEffect(() => {
    return () => stop();
  }, [stop]);

  useEffect(() => {
    if (!activeThread) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onSelectThread(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeThread, onSelectThread]);

  const handleChannelClick = (thread: ChatThread) => {
    if (unlockedDonorIds.includes(thread.donorId)) {
      onSelectThread(thread.id);
    } else {
      onRequestUnlockThread(thread);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeThread) return;
    if (!draft.trim()) {
      setFormError('Enter a coordination message before sending.');
      return;
    }
    setFormError(null);
    const text = draft.trim();
    setDraft('');
    await onSendMessage(activeThread.id, currentUser.role, text);
  };

  if (threads.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 bg-[#090D16]">
        <div className="max-w-md text-center bg-[#111827] border border-slate-800 rounded-2xl p-8">
          <Lock className="w-8 h-8 text-rose-400 mx-auto mb-3" />
          <h2 className="font-display text-lg font-bold text-white">
            No Relay Channels Yet
          </h2>
          <p className="text-sm text-slate-400 mt-1.5">
            Select a verified donor in Discover or on the Map and pay ₹50 to unlock a real-time anonymous relay conversation.
          </p>
          <button
            type="button"
            onClick={onOpenDiscover}
            className="mt-5 min-h-[44px] px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium rounded-xl cursor-pointer"
          >
            Browse Nearby Donors
          </button>
        </div>
      </div>
    );
  }

  // When no unlocked chat is open, show ONLY the chats list (no idle right-hand section)
  if (!activeThread) {
    return (
      <div
        className="flex-1 overflow-y-auto bg-[#090D16] p-4 sm:p-6"
        data-testid="messages-chats-only"
      >
        <div className="max-w-3xl w-full mx-auto bg-[#0D1322] border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-4 sm:px-5 py-3.5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-bold text-white">
                Live Relay Channels
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Tap a channel to open. Locked chats require a one-time ₹50 coordination unlock fee.
              </p>
            </div>
            <span className="text-xs text-slate-400 tabular-nums">
              {wsConnected ? `Live · ${connectedClients} online` : 'Reconnecting'}
            </span>
          </div>

          <div className="divide-y divide-slate-800/80" data-testid="chat-channel-list">
            {threads.map((thread) => {
              const isUnlocked = unlockedDonorIds.includes(thread.donorId);
              const lastMsg = thread.messages[thread.messages.length - 1];
              return (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => handleChannelClick(thread)}
                  data-testid={`channel-item-${thread.donorId}`}
                  className="w-full text-left px-4 sm:px-5 py-4 hover:bg-[#111827] transition-colors flex items-center justify-between gap-4 cursor-pointer"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-white">
                        {thread.donorHandle}
                      </span>
                      <span className="text-slate-600" aria-hidden="true">
                        ·
                      </span>
                      <span className="font-mono text-xs font-bold text-rose-400">
                        {thread.bloodType}
                      </span>
                      <span className="text-slate-600" aria-hidden="true">
                        ·
                      </span>
                      <span className="text-xs text-slate-400 truncate">
                        {thread.neighborhood}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 mt-1 truncate">
                      {isUnlocked
                        ? lastMsg
                          ? lastMsg.text
                          : 'Unlocked · Tap to start anonymous coordination'
                        : 'Locked · Pay ₹50 to view and reply in real time'}
                    </p>
                  </div>

                  {isUnlocked ? (
                    <span className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-950/60 border border-emerald-700/70 text-emerald-300 text-xs font-semibold">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Open Chat</span>
                    </span>
                  ) : (
                    <span className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600/20 border border-amber-500/50 text-amber-300 text-xs font-semibold">
                      <IndianRupee className="w-3.5 h-3.5" />
                      <span>Pay ₹50</span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <section
      className="fixed inset-0 z-[45] flex flex-col bg-[#090D16] w-full h-dvh"
      data-testid="active-chat-panel"
      aria-label={`Full-screen anonymous chat with ${activeThread.donorHandle}`}
    >
      {/* Full-screen chat header */}
      <div className="px-4 sm:px-6 py-3.5 border-b border-slate-800 bg-[#0D1322] shrink-0">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onSelectThread(null)}
                aria-label="Back to channels"
                data-testid="exit-fullscreen-chat-button"
                className="min-h-[34px] px-3 py-1.5 rounded-lg bg-[#111827] border border-slate-700 hover:bg-slate-800 text-xs font-medium text-slate-200 flex items-center gap-1.5 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Channels</span>
              </button>
              <span className="font-mono text-sm font-bold text-white">
                {activeThread.donorHandle}
              </span>
              <span className="text-slate-600" aria-hidden="true">
                ·
              </span>
              <span className="font-mono text-xs font-semibold text-rose-400">
                {activeThread.bloodType}
              </span>
              <span className="text-slate-600" aria-hidden="true">
                ·
              </span>
              <span className="text-xs text-slate-400">
                {activeThread.neighborhood}
              </span>
            </div>
            <p className="text-xs text-emerald-400 flex items-center gap-1.5 mt-1.5">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              <span>
                ₹50 Unlocked · Chatting anonymously as {mySenderLabel}
              </span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden sm:inline text-xs text-slate-400 tabular-nums px-2.5 py-1 rounded-lg bg-[#111827] border border-slate-800">
              {wsConnected ? `Live · ${connectedClients} online` : 'Reconnecting'}
            </span>
            <button
              type="button"
              onClick={onOpenSettings}
              className="min-h-[36px] px-3 py-1.5 rounded-lg bg-[#111827] border border-slate-700 hover:bg-slate-800 text-xs font-medium text-slate-200 flex items-center gap-1.5 cursor-pointer"
            >
              <Settings className="w-3.5 h-3.5 text-rose-400" />
              <span>
                Role: {currentUser.role === 'donor' ? 'Donor' : 'Recipient'}
              </span>
            </button>
          </div>
        </div>
      </div>

      {ttsError && (
        <div className="px-4 py-2 bg-rose-950/60 border-b border-rose-800 text-xs text-rose-200 shrink-0">
          <div className="max-w-5xl mx-auto">{ttsError}</div>
        </div>
      )}

      {/* Full-screen message stream */}
      <div
        className="flex-1 overflow-y-auto p-4 sm:p-6 bg-[#090D16]"
        data-testid="chat-messages"
      >
        <div className="max-w-4xl mx-auto space-y-4">
          {activeThread.messages.length === 0 ? (
            <div className="text-center py-12 text-xs text-slate-400">
              Real-time channel unlocked. Messages are synced across connected users via the server so donors and recipients can reply immediately.
            </div>
          ) : (
            activeThread.messages.map((msg) => {
              const isOwn =
                msg.senderUserId != null
                  ? msg.senderUserId === currentUser.id
                  : msg.senderRole === currentUser.role;
              const isPlaying = playingId === msg.id;
              const isLoading = loadingId === msg.id;
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'}`}
                >
                  <div className="flex items-center gap-2 mb-1 px-1">
                    <span className="text-xs font-medium text-slate-300">
                      {msg.senderLabel}
                    </span>
                    <span className="text-[11px] text-slate-500 tabular-nums font-mono">
                      {new Date(msg.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div
                    className={`max-w-xl rounded-2xl px-4 py-3 text-sm leading-relaxed border ${
                      isOwn
                        ? 'bg-rose-600/20 text-slate-100 border-rose-500/40'
                        : 'bg-[#111827] text-slate-100 border-slate-800'
                    }`}
                  >
                    <p>{msg.text}</p>
                    <div className="mt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={() =>
                          speak(
                            msg.id,
                            `${msg.senderLabel} says: ${msg.text}`,
                            'Clear, calm coordination message'
                          )
                        }
                        aria-label={
                          isPlaying ? 'Stop reading message' : 'Read message aloud'
                        }
                        className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md transition-colors text-slate-300 hover:text-white hover:bg-slate-800 cursor-pointer"
                      >
                        {isPlaying ? (
                          <VolumeX className="w-3.5 h-3.5" />
                        ) : (
                          <Volume2 className="w-3.5 h-3.5" />
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
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Full-screen pinned bottom composer */}
      <form
        onSubmit={handleSubmit}
        className="p-3 sm:p-4 border-t border-slate-800 bg-[#0D1322] shrink-0"
      >
        <div className="max-w-4xl mx-auto space-y-2">
          {piiWarning && (
            <div className="flex items-center gap-2 text-xs text-amber-200 bg-amber-950/50 border border-amber-800 rounded-lg px-3 py-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
              <span>{piiWarning}</span>
            </div>
          )}
          {formError && (
            <p className="text-xs text-rose-400 px-1">{formError}</p>
          )}
          <div className="flex items-center gap-2">
            <label htmlFor="chat-message-input" className="sr-only">
              Anonymous message
            </label>
            <input
              id="chat-message-input"
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={`Reply live as ${mySenderLabel}...`}
              className="flex-1 min-h-[44px] rounded-xl bg-[#090D16] border border-slate-800 px-3.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-rose-500"
            />
            <button
              type="submit"
              aria-label="Send anonymous message"
              className="min-h-[44px] px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium flex items-center gap-2 shrink-0 cursor-pointer"
            >
              <Send className="w-4 h-4" />
              <span className="hidden sm:inline">Send</span>
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
