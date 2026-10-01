export type SpeechRequest = {
  text: string;
  locale: string;
  rate: number;
  volume: number;
};

export type SpeechAdapter = {
  speak(request: SpeechRequest): Promise<void>;
  cancel(): void;
};

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

export function browserSpeech(): SpeechAdapter {
  return {
    speak(request) {
      const synth = window.speechSynthesis;
      if (!synth || !request.text.trim()) {
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        const utter = new SpeechSynthesisUtterance(request.text);
        const voices = synth.getVoices();
        const preferred =
          voices.find((voice) => voice.lang.toLowerCase().startsWith("es-ar")) ??
          voices.find((voice) => voice.lang.toLowerCase().startsWith("es-es")) ??
          voices.find((voice) => voice.lang.toLowerCase().startsWith("es"));
        utter.lang = preferred?.lang ?? (request.locale || "es-AR");
        if (preferred) {
          utter.voice = preferred;
        }
        utter.rate = clamp(request.rate, 0.5, 1.5);
        utter.volume = clamp(request.volume, 0, 100) / 100;
        utter.onend = () => resolve();
        utter.onerror = () => resolve();
        synth.speak(utter);
      });
    },
    cancel() {
      window.speechSynthesis?.cancel();
    },
  };
}
