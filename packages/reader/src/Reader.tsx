/**
 * Reading assignment component (spec §11.2) — port of the server-frontend
 * `<reader>` knockout component (blockpy-server frontend/components/
 * reader/reader.ts + reader.html).
 *
 * Pinned legacy semantics (A7 §4):
 *   - load ⇒ correct: `markRead()` fires as soon as the assignment +
 *     submission pair arrives — no scroll/dwell/video gate (reader.ts:
 *     154-156). Anonymous loads (no submission) never mark.
 *   - scroll/video engagement is telemetry only: escalating read pings
 *     (30 s · count) through the lti.fetchWindowSize postMessage loop,
 *     HTML5 video events, YouTube state changes, and tab visibility — all
 *     `Resource.View`/`reading` events.
 *   - exam gate: `settings.start_timer_button` hides the group selector for
 *     unstarted students until "I am ready to start the exam!" posts
 *     start_assignment (reader.ts:102-135, 251-256).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { RunController } from '@blockpy/editor';
import { Download, ExternalLink } from 'lucide-react';
import { renderReadingMarkdown } from './markdown';
import { parseReaderSettings, rememberVoiceChoice, type ReaderSettings } from './settings';
import { RunnableBlock, collectRunnableSlots, type RunnableSlot } from './Runnable';

export const LOG_TIME_RATE = 30000;
export const VIDEO_EVENTS = [
  'pause',
  'playing',
  'seeked',
  'ended',
  'loadeddata',
  'error',
  'ratechange',
  'waiting',
] as const;

export interface ReaderAssignment {
  id: number;
  name: string;
  url: string;
  instructions: string;
  /** Raw settings JSON string. */
  settings: string;
}

export interface ReaderSubmission {
  id: number | null;
  correct: boolean;
  dateStarted: string | null;
  /** Per-student time-limit override ("Nmin"/"Nx", submission.timeLimit()). */
  timeLimit: string | null;
}

/** Countdown feed for the group header's checker (spec §9.4): the reading's
 *  time limit + start replace the editor pair's while the reader is up. */
export interface ReaderTimeLimitInfo {
  timeLimit: string | null;
  studentTimeLimit: string | null;
  dateStarted: string | null;
}

export interface ReaderLoadResult {
  assignment: ReaderAssignment;
  submission: ReaderSubmission | null;
}

export interface MarkReadResponse {
  success: boolean;
  correct?: boolean;
  submissionStatus?: string;
  /** Server failure text (legacy response.message.message). */
  message?: string;
}

export interface ReaderProps {
  assignmentId: number;
  /** The reading keeps its own loaded pair — legacy posts loadAssignment
   *  without adopting into the editor model (reader.ts:137-171). */
  loadAssignment: (assignmentId: number) => Promise<ReaderLoadResult | null>;
  /** updateSubmission {status: 1, correct: true} with the READING's ids
   *  (reader.ts:384-419). Absent = anonymous/offline: never marks. */
  markRead?: (
    assignmentId: number,
    submissionId: number | null,
  ) => Promise<MarkReadResponse>;
  /** Navigation store hook, called when the server echoes correct. */
  markCorrect?: (assignmentId: number) => void;
  logEvent?: (
    eventType: string,
    category: string,
    label: string,
    message: string,
    filePath: string,
  ) => void;
  /** Relative link/image/slides target → download_file URL. */
  downloadUrl?: (assignmentId: number, filename: string) => string;
  /** Popout href base (legacy assignment.editUrl(); '&embed=true' appended). */
  editUrl?: (assignment: ReaderAssignment) => string | null;
  /** Page-shared engine for runnable blocks (§8.4). */
  runController?: RunController;
  blocklyMediaPath?: string;
  isInstructor?: () => boolean;
  /** POST blockpy/start_assignment (exam timer, reader.ts:109-135). */
  startAssignment?: (
    assignmentId: number,
    dateStartedIso: string,
  ) => Promise<{ success: boolean }>;
  /** Fired on load and after a successful exam start — the app routes this
   *  into the navigation store's time-limit checker (legacy: the reader IS
   *  the AssignmentInterface running handleTimeCheck on its own pair). */
  onTimeLimitInfo?: (info: ReaderTimeLimitInfo) => void;
  /** Rendered above another assignment (§11.2); popout hidden by legacy
   *  usage patterns is NOT implied — asPreamble only changes composition. */
  asPreamble?: boolean;
}

interface LoadedReading {
  assignment: ReaderAssignment;
  submission: ReaderSubmission | null;
  settings: ReaderSettings;
}

/** jQuery's $(document).height() equivalent. */
const documentHeight = (): number =>
  Math.max(
    document.body.scrollHeight,
    document.body.offsetHeight,
    document.documentElement.clientHeight,
    document.documentElement.scrollHeight,
    document.documentElement.offsetHeight,
  );

export function Reader(props: ReaderProps) {
  const [loaded, setLoaded] = useState<LoadedReading | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [dateStarted, setDateStarted] = useState<string | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [runnables, setRunnables] = useState<RunnableSlot[]>([]);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const startedPlayingAtRef = useRef<number>(0);
  const logCountRef = useRef(0);
  const oldPositionRef = useRef<number | null>(null);
  const logTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedRef = useRef<LoadedReading | null>(null);
  loadedRef.current = loaded;

  const propsRef = useRef(props);
  propsRef.current = props;

  const logEvent = useCallback(
    (eventType: string, category: string, label: string, message: string) => {
      const current = loadedRef.current;
      propsRef.current.logEvent?.(
        eventType,
        category,
        label,
        message,
        current?.assignment.url ?? '',
      );
    },
    [],
  );

  // -- read-ping loop (reader.ts:343-372) -------------------------------------
  const logReadingStart = useCallback(() => {
    try {
      window.top?.postMessage({ subject: 'lti.fetchWindowSize' }, '*');
    } catch {
      // Cross-origin top without postMessage access — ping loop just stops.
    }
  }, []);

  const logReading = useCallback(
    (positionData: Record<string, unknown> | null) => {
      logCountRef.current += 1;
      const delay = logCountRef.current * LOG_TIME_RATE;
      let position: number;
      let height: number;
      if (positionData != null && 'offset' in positionData) {
        position = Number(positionData['scrollY'] ?? 0);
        height =
          documentHeight() +
          Number((positionData['offset'] as { top?: number } | undefined)?.top ?? 0);
      } else {
        position = window.scrollY ?? document.documentElement.scrollTop;
        height = documentHeight();
      }
      const moved = position !== oldPositionRef.current;
      const progress = (100 * position) / height;
      const current = loadedRef.current;
      if (current && current.submission) {
        logEvent(
          'Resource.View',
          'reading',
          'read',
          JSON.stringify({ count: logCountRef.current, delay, position, height, progress, moved }),
        );
        // Legacy schedules the next ping in the log callback; ours is
        // fire-and-forget so the (delay-dominated) schedule happens now.
        logTimerRef.current = setTimeout(logReadingStart, delay);
        oldPositionRef.current = position;
      }
    },
    [logEvent, logReadingStart],
  );

  // The lti.fetchWindowSize round-trip: when framed, the platform answers
  // with offsets; unframed, our own message echoes back (top === self).
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      let data: unknown = event.data;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {
          return;
        }
      }
      const record = data as Record<string, unknown> | null;
      const subject = record?.['subject'];
      if (subject === 'lti.fetchWindowSize' || subject === 'lti.fetchWindowSize.response') {
        logReading(record);
      }
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [logReading]);

  // Tab-visibility telemetry (assignment_interface.ts:134-138).
  useEffect(() => {
    const onVisibility = () =>
      logEvent('Resource.View', 'reading', 'visibility', document.visibilityState);
    window.addEventListener('visibilitychange', onVisibility);
    return () => window.removeEventListener('visibilitychange', onVisibility);
  }, [logEvent]);

  // -- markRead (reader.ts:384-419; A7 §4 load ⇒ correct) ---------------------
  const markRead = useCallback((reading: LoadedReading) => {
    const { markRead: post, markCorrect } = propsRef.current;
    if (!post || !reading.submission) return;
    void post(reading.assignment.id, reading.submission.id)
      .then((response) => {
        if (!response.success) {
          console.error(response);
          setErrorMessage(response.message ?? 'Failed to mark the reading.');
        }
        setLoaded((previous) =>
          previous && previous.assignment.id === reading.assignment.id
            ? {
                ...previous,
                submission: previous.submission
                  ? { ...previous.submission, correct: response.correct === true }
                  : previous.submission,
              }
            : previous,
        );
        if (response.correct && markCorrect) {
          markCorrect(reading.assignment.id);
        }
      })
      .catch((error) => {
        console.error('Failed to load (HTTP LEVEL)', error);
        setErrorMessage(
          'HTTP ERROR (try reloading the page; if still an error, report to instructor!): ' +
            String(error),
        );
      });
  }, []);

  // -- load (reader.ts:137-171) ------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setErrorMessage('');
    setRunnables([]);
    void propsRef.current
      .loadAssignment(props.assignmentId)
      .then((result) => {
        if (cancelled || !result) {
          if (!result) console.error('Failed to load', props.assignmentId);
          return;
        }
        const downloadUrl = (filename: string) =>
          propsRef.current.downloadUrl?.(result.assignment.id, filename) ?? filename;
        const settings = parseReaderSettings(result.assignment.settings, downloadUrl);
        const reading: LoadedReading = {
          assignment: result.assignment,
          submission: result.submission,
          settings,
        };
        setLoaded(reading);
        setDateStarted(result.submission?.dateStarted ?? null);
        logCountRef.current = 1;
        logTimerRef.current = setTimeout(logReadingStart, 1000);
        if (result.submission) {
          markRead(reading);
        }
        propsRef.current.onTimeLimitInfo?.({
          timeLimit: settings.timeLimit,
          studentTimeLimit: result.submission?.timeLimit ?? null,
          dateStarted: result.submission?.dateStarted ?? null,
        });
        // Exam gate: unstarted students lose the group selector until the
        // timer starts (reader.ts:251-256).
        if (
          settings.startTimerButton &&
          !propsRef.current.isInstructor?.() &&
          result.submission &&
          !result.submission.dateStarted
        ) {
          document
            .querySelectorAll<HTMLElement>('.assignment-selector-div')
            .forEach((el) => (el.style.display = 'none'));
        }
      })
      .catch((error) => {
        if (!cancelled) console.error('Failed to load (HTTP LEVEL)', error);
      });
    return () => {
      cancelled = true;
      if (logTimerRef.current) clearTimeout(logTimerRef.current);
    };
  }, [props.assignmentId, logReadingStart, markRead]);

  // -- markdown body + runnable hydration (§11.2) ------------------------------
  const renderedHtml = useMemo(() => {
    if (!loaded) return '';
    return renderReadingMarkdown(loaded.assignment.instructions, {
      downloadUrl: (link) =>
        propsRef.current.downloadUrl?.(loaded.assignment.id, link) ?? link,
    });
  }, [loaded]);

  useEffect(() => {
    if (bodyRef.current) {
      setRunnables(collectRunnableSlots(bodyRef.current));
    }
  }, [renderedHtml]);

  // -- video / youtube watch telemetry (reader.ts:259-334) ---------------------
  const logWatching = useCallback(
    (event: Event) => {
      const target = event.currentTarget as HTMLVideoElement;
      const duration =
        event.type === 'pause' ? target.currentTime - (startedPlayingAtRef.current || 0) : 0;
      logEvent(
        'Resource.View',
        'reading',
        'watch',
        JSON.stringify({ event: event.type, time: target.currentTime, duration }),
      );
      if (event.type === 'playing') {
        startedPlayingAtRef.current = target.currentTime;
      }
    },
    [logEvent],
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !loaded?.settings.video) return;
    for (const name of VIDEO_EVENTS) video.addEventListener(name, logWatching);
    return () => {
      for (const name of VIDEO_EVENTS) video.removeEventListener(name, logWatching);
    };
  }, [loaded, logWatching]);

  // YouTube state changes need the iframe API; legacy's loader is commented
  // out of editor.html (:391), so this is fail-soft there too.
  useEffect(() => {
    if (!loaded?.settings.youtube || loaded.settings.video) return;
    const YT = (window as unknown as Record<string, unknown>)['YT'] as
      | { Player: new (id: string, options: unknown) => { destroy(): void } }
      | undefined;
    if (!YT) return;
    let player: { destroy(): void } | null = null;
    try {
      player = new YT.Player('reader-youtube-video', {
        playerVars: { enablejsapi: 1 },
        events: {
          onStateChange: (event: { data: unknown }) =>
            logEvent(
              'Resource.View',
              'reading',
              'watch',
              JSON.stringify({ event: event.data, time: 0 }),
            ),
        },
      });
    } catch (error) {
      console.log('YT Player probably not available.');
      console.error(error);
    }
    return () => {
      try {
        player?.destroy();
      } catch {
        // Already gone.
      }
    };
  }, [loaded, logEvent]);

  // -- exam start (reader.ts:109-135) ------------------------------------------
  const startTimer = useCallback(() => {
    const current = loadedRef.current;
    const { startAssignment, onTimeLimitInfo } = propsRef.current;
    if (!current || !startAssignment) return;
    const started = new Date().toISOString();
    startAssignment(current.assignment.id, started)
      .then((response) => {
        if (response.success) {
          setDateStarted(started);
          onTimeLimitInfo?.({
            timeLimit: current.settings.timeLimit,
            studentTimeLimit: current.submission?.timeLimit ?? null,
            dateStarted: started,
          });
          document
            .querySelectorAll<HTMLElement>('.assignment-selector-div')
            .forEach((el) => (el.style.display = ''));
        } else {
          alert(
            'The exam could not be started. Please try reloading the page and starting again.',
          );
          console.error('Failed to start timer', response);
        }
      })
      .catch((error) => {
        alert('The exam could not be started. Please try reloading the page and starting again.');
        console.error('Failed to start timer (HTTP LEVEL)', error);
      });
  }, []);

  if (!loaded) {
    return <div className="blockpy-reader">{errorMessage || 'Loading reading…'}</div>;
  }

  const { assignment, submission, settings } = loaded;
  const popoutBase = props.editUrl?.(assignment) ?? null;
  const showYoutubeVoices =
    settings.youtube.length > 0 &&
    !settings.video &&
    Object.keys(settings.youtubeOptions).length > 1;
  const showVideoVoices =
    settings.video.length > 0 && Object.keys(settings.videoOptions).length > 1;
  const voiceOptions = settings.video ? settings.videoOptions : settings.youtubeOptions;
  const currentVoiceUrl = settings.video || settings.youtube;

  const chooseVoice = (voice: string, url: string) => {
    rememberVoiceChoice(voice);
    setVoiceOpen(false);
    setLoaded((previous) =>
      previous
        ? {
            ...previous,
            settings: previous.settings.video
              ? { ...previous.settings, video: url }
              : { ...previous.settings, youtube: url },
          }
        : previous,
    );
  };

  return (
    <div className="blockpy-reader">
      {errorMessage && <div className="alert alert-warning">{errorMessage}</div>}
      {settings.allowPopout && popoutBase && (
        <a
          href={`${popoutBase}&embed=true`}
          className="btn btn-sm btn-outline-secondary float-right m-3"
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={14} strokeWidth={1.75} aria-hidden /> Popout
        </a>
      )}
      {settings.slides.length > 0 && (
        <a
          href={settings.slides}
          className="btn btn-sm btn-outline-secondary float-right m-3"
          target="_blank"
          rel="noreferrer"
        >
          <Download size={14} strokeWidth={1.75} aria-hidden /> Download
        </a>
      )}
      <div style={{ background: '#FBFAF7' }} className="pt-4">
        {settings.header.length > 0 && <h3 className="p-1">{settings.header}</h3>}
        {settings.summary.length > 0 && <div className="p-1">{settings.summary}</div>}
        {(showYoutubeVoices || showVideoVoices) && (
          <div style={{ float: 'right' }} className="btn-group" role="group">
            <button
              id="blockpy-reader-video-voice-choice"
              type="button"
              className="btn btn-outline-secondary dropdown-toggle"
              aria-haspopup="true"
              aria-expanded={voiceOpen}
              onClick={() => setVoiceOpen(!voiceOpen)}
            >
              Voice
            </button>
            <div
              className={`dropdown-menu${voiceOpen ? ' show' : ''}`}
              aria-labelledby="blockpy-reader-video-voice-choice"
            >
              {Object.entries(voiceOptions).map(([voice, url]) => (
                <a
                  key={voice}
                  href="#"
                  className={`dropdown-item${url === currentVoiceUrl ? ' active' : ''}`}
                  onClick={(event) => {
                    event.preventDefault();
                    chooseVoice(voice, url);
                  }}
                >
                  {voice}
                </a>
              ))}
            </div>
          </div>
        )}
        {settings.video.length > 0 && (
          <video
            controls
            width={640}
            height={480}
            style={{ display: 'block', marginLeft: 'auto', marginRight: 'auto' }}
            crossOrigin="anonymous"
            preload="metadata"
            className="reader-video-display"
            ref={videoRef}
          >
            <source src={`${settings.video}#t=1`} type="video/mp4" />
            <track
              src={`${settings.video.slice(0, -3)}vtt`}
              default
              kind="captions"
              srcLang="en"
              label="English"
            />
          </video>
        )}
        {settings.youtube.length > 0 && !settings.video && (
          <iframe
            style={{ width: '640px', height: '480px', marginLeft: '10%' }}
            width={300}
            height={150}
            allowFullScreen
            id="reader-youtube-video"
            title={assignment.name}
            src={`https://www.youtube.com/embed/${settings.youtube}?feature=oembed&rel=0&enablejsapi=1`}
          />
        )}
        <div
          className="p-4 blockpy-reader-content"
          ref={bodyRef}
          // D4-A: unsanitized instructor HTML, legacy parity.
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
        {settings.startTimerButton && submission && (
          <div className="text-center mb-4">
            {dateStarted ? (
              <button type="button" className="btn btn-primary btn-lg" disabled>
                Exam has begun, please continue working.
              </button>
            ) : (
              <button type="button" className="btn btn-primary btn-lg" onClick={startTimer}>
                I am ready to start the exam!
              </button>
            )}
          </div>
        )}
        <hr />
      </div>
      {runnables.map((runnable, index) =>
        createPortal(
          <RunnableBlock
            key={`${assignment.id}-${runnable.partId}-${index}`}
            pre={runnable.pre}
            source={runnable.source}
            runController={props.runController}
            blocklyMediaPath={props.blocklyMediaPath}
          />,
          runnable.slot,
        ),
      )}
    </div>
  );
}
