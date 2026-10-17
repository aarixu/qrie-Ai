import type { TtsAdapter } from '@ai-tutor/player';
import { announceLine } from '../avatar/avatarBus';

/**
 * Resilient TTS Adapter for Live Lecture Classes.
 * Synchronizes speech synthesis with the mascot avatar's lip-sync bus in real-time.
 */
export function createLectureTts(): TtsAdapter {
  let activeTimer: ReturnType<typeof setTimeout> | null = null;
  let activeResolver: (() => void) | null = null;

  const cleanup = () => {
    if (activeTimer) {
      clearTimeout(activeTimer);
      activeTimer = null;
    }
    announceLine('');
    const resolve = activeResolver;
    activeResolver = null;
    if (resolve) resolve();
  };

  return {
    speak(text: string): Promise<void> {
      return new Promise<void>((resolve) => {
        cleanup();
        activeResolver = resolve;
        announceLine(text);

        if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
          const words = text.split(/\s+/).length;
          const ms = Math.max(1800, (words / 140) * 60 * 1000);
          activeTimer = setTimeout(cleanup, ms);
          return;
        }

        const synth = window.speechSynthesis;
        synth.cancel();

        const utterance = new SpeechSynthesisUtterance(text);

        const voices = synth.getVoices();
        const preferredVoice =
          voices.find((v) => v.lang.startsWith('en-IN')) ||
          voices.find((v) => v.name.includes('India') || v.name.includes('Natural')) ||
          voices.find((v) => v.lang.startsWith('en'));

        if (preferredVoice) {
          utterance.voice = preferredVoice;
        }

        utterance.rate = 1.0;
        utterance.pitch = 1.02;

        utterance.onend = () => {
          cleanup();
        };

        utterance.onerror = () => {
          cleanup();
        };

        const words = text.split(/\s+/).length;
        const maxExpectedMs = Math.max(2500, (words / 100) * 60 * 1000 + 1500);
        activeTimer = setTimeout(cleanup, maxExpectedMs);

        try {
          synth.speak(utterance);
        } catch {
          cleanup();
        }
      });
    },

    cancel() {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      cleanup();
    },
  };
}
