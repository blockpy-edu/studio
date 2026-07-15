/**
 * Reading settings surface - port of `parseAdditionalSettings` and the
 * voice-choice helpers (blockpy-server frontend/components/reader/
 * reader.ts:183-257). The settings JSON drives everything outside the
 * markdown body: videos, header/summary, slides download, popout, and the
 * exam start-timer gate.
 */

export interface ReaderSettings {
  /** Chosen YouTube video id ('' = none). */
  youtube: string;
  /** voice-name → video-id when the setting is an object. */
  youtubeOptions: Record<string, string>;
  /** Chosen MP4 URL ('' = none). */
  video: string;
  videoOptions: Record<string, string>;
  header: string;
  summary: string;
  /** Absolute slides URL ('' = none); relative names resolve through
   *  download_file (reader.ts:245-249). */
  slides: string;
  allowPopout: boolean;
  startTimerButton: boolean;
  /** Raw time_limit passthrough (unconverted - numeric values crash the
   *  legacy checker the same way, see navigation's parseTimeLimit). */
  timeLimit: string | null;
}

export const VOICE_CHOICE_KEY = 'blockpy-reader-voice-choice';

const safeGet = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeSet = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage denied - the choice just doesn't persist.
  }
};

/** Most-recently-chosen voice name present in the options wins; falls back
 *  to the first option's URL (reader.ts:183-200). */
export function getBestVoice(options: Record<string, string>): string {
  const raw = safeGet(VOICE_CHOICE_KEY);
  const defaultVoice = Object.values(options)[0] || '';
  if (raw == null) return defaultVoice;
  let previous: unknown;
  try {
    previous = JSON.parse(raw);
  } catch {
    return defaultVoice;
  }
  if (!Array.isArray(previous)) return defaultVoice;
  for (const voice of previous) {
    if (typeof voice === 'string' && voice in options) {
      return options[voice] as string;
    }
  }
  return defaultVoice;
}

/** Moves the chosen voice name to the front of the stored list
 *  (reader.ts:202-221). */
export function rememberVoiceChoice(voice: string): void {
  const raw = safeGet(VOICE_CHOICE_KEY);
  if (raw == null) {
    safeSet(VOICE_CHOICE_KEY, JSON.stringify([voice]));
    return;
  }
  let previous: string[];
  try {
    previous = JSON.parse(raw) as string[];
  } catch {
    safeSet(VOICE_CHOICE_KEY, JSON.stringify([voice]));
    return;
  }
  previous = previous.filter((candidate) => candidate !== voice);
  previous.unshift(voice);
  safeSet(VOICE_CHOICE_KEY, JSON.stringify(previous));
}

/** reader.ts:223-257 - note slides uses its own absolute-URL predicate
 *  (`/^https?:\/\//`), different from the link-rewrite's `startsWith("http")`. */
export function parseReaderSettings(
  settingsRaw: string,
  downloadUrl: (filename: string) => string,
): ReaderSettings {
  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(settingsRaw || '{}') as Record<string, unknown>;
  } catch {
    // Legacy would throw out of the load handler; fail soft to defaults.
    settings = {};
  }
  const parsed: ReaderSettings = {
    youtube: '',
    youtubeOptions: {},
    video: '',
    videoOptions: {},
    header: typeof settings['header'] === 'string' ? (settings['header'] as string) : '',
    summary: typeof settings['summary'] === 'string' ? (settings['summary'] as string) : '',
    slides: '',
    allowPopout: 'popout' in settings ? Boolean(settings['popout']) : true,
    startTimerButton: Boolean(settings['start_timer_button'] ?? false),
    timeLimit: (settings['time_limit'] ?? null) as string | null,
  };
  const youtube = settings['youtube'];
  if (youtube instanceof Object) {
    parsed.youtubeOptions = youtube as Record<string, string>;
    parsed.youtube = getBestVoice(parsed.youtubeOptions);
  } else {
    parsed.youtube = typeof youtube === 'string' ? youtube : '';
  }
  const video = settings['video'];
  if (video instanceof Object) {
    parsed.videoOptions = video as Record<string, string>;
    parsed.video = getBestVoice(parsed.videoOptions);
  } else {
    parsed.video = typeof video === 'string' ? video : '';
  }
  let slides = typeof settings['slides'] === 'string' ? (settings['slides'] as string) : '';
  if (slides && !/^https?:\/\//.test(slides)) {
    slides = downloadUrl(slides);
  }
  parsed.slides = slides;
  return parsed;
}
