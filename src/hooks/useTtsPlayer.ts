import { useCallback, useRef, useState } from 'react';

export function useTtsPlayer() {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [ttsError, setTtsError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore speechSynthesis cancel error
      }
    }
    setPlayingId(null);
  }, []);

  const speakWithBrowserFallback = useCallback((id: string, text: string): boolean => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return false;
    }
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.onend = () => {
        setPlayingId(null);
      };
      utterance.onerror = () => {
        setPlayingId(null);
      };
      setPlayingId(id);
      window.speechSynthesis.speak(utterance);
      return true;
    } catch {
      return false;
    }
  }, []);

  const speak = useCallback(
    async (id: string, text: string, style?: string) => {
      if (playingId === id) {
        stop();
        return;
      }

      stop();
      setTtsError(null);
      setLoadingId(id);

      try {
        const res = await fetch('/api/ai/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, style }),
        });

        let data: {
          audioBase64?: string;
          mimeType?: string;
          error?: string;
        } = {};
        try {
          data = (await res.json()) as typeof data;
        } catch {
          data = {};
        }

        if (res.ok && data.audioBase64) {
          const audio = new Audio(
            `data:${data.mimeType || 'audio/wav'};base64,${data.audioBase64}`
          );
          audioRef.current = audio;
          audio.onended = () => {
            setPlayingId(null);
            audioRef.current = null;
          };
          audio.onerror = () => {
            audioRef.current = null;
            if (!speakWithBrowserFallback(id, text)) {
              setPlayingId(null);
              setTtsError('Audio playback failed on this device.');
            }
          };

          setLoadingId(null);
          setPlayingId(id);
          await audio.play();
          return;
        }

        setLoadingId(null);
        if (speakWithBrowserFallback(id, text)) {
          return;
        }
        throw new Error(data.error || 'Voice playback is unavailable on this device.');
      } catch (err) {
        setLoadingId(null);
        if (speakWithBrowserFallback(id, text)) {
          return;
        }
        setPlayingId(null);
        setTtsError(err instanceof Error ? err.message : 'Voice playback unavailable.');
      }
    },
    [playingId, speakWithBrowserFallback, stop]
  );

  return {
    playingId,
    loadingId,
    ttsError,
    speak,
    stop,
  };
}
