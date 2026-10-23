/**
 * Speaks the guided-tour captions. Same voice choice as God's Eye View's
 * Director narrator (browser speech, a natural English voice when the
 * system has one), with pause and resume so it follows the tour controls.
 */
const MAX_SPEECH_MS = 30_000;

function pickVoice(synth: SpeechSynthesis): SpeechSynthesisVoice | null {
  const voices = synth.getVoices?.() || [];
  const english = voices.filter((v) => /^en(-|_|$)/i.test(v.lang));
  return (
    english.find((v) => /natural|neural|google uk english male|daniel/i.test(v.name)) ||
    english.find((v) => /^en-(GB|AU)/i.test(v.lang)) ||
    english[0] ||
    null
  );
}

/** Voices load asynchronously in some browsers; wait briefly for them. */
function voicesReady(synth: SpeechSynthesis): Promise<void> {
  if (synth.getVoices?.().length) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { synth.removeEventListener?.('voiceschanged', done); resolve(); };
    synth.addEventListener?.('voiceschanged', done);
    window.setTimeout(done, 800);
  });
}

export interface Narrator {
  speak: (text: string) => Promise<void>;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  readonly supported: boolean;
}

export function createNarrator(): Narrator {
  const synth: SpeechSynthesis | undefined = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  const supported = !!synth && typeof SpeechSynthesisUtterance !== 'undefined';
  let current: { done: () => void } | null = null;
  let token = 0;

  const stop = () => {
    token++;
    current?.done();
    current = null;
    try { synth?.cancel(); } catch { /* no speech support */ }
  };

  const speak = async (text: string) => {
    stop();
    if (!supported || !synth || !text) return;
    const mine = ++token;
    await voicesReady(synth);
    if (mine !== token) return; // stopped or replaced while voices loaded
    await new Promise<void>((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = pickVoice(synth);
      if (voice) utterance.voice = voice;
      utterance.rate = 0.95;
      const timer = window.setTimeout(() => entry.done(), MAX_SPEECH_MS);
      const entry = {
        done() {
          window.clearTimeout(timer);
          if (current === entry) current = null;
          resolve();
        },
      };
      current = entry;
      utterance.onend = () => entry.done();
      utterance.onerror = () => entry.done();
      // Chrome can stay paused after a cancel(); resume before speaking.
      synth.resume?.();
      synth.speak(utterance);
    });
  };

  return {
    speak,
    stop,
    pause: () => { try { synth?.pause(); } catch { /* ignore */ } },
    resume: () => { try { synth?.resume(); } catch { /* ignore */ } },
    supported,
  };
}
