/**
 * Feedback pane — Row 2 right (A8 §1/§4.5: category badge with the legacy
 * `label-*` classes, bold label, HTML message; aria-live like legacy).
 * Message code blocks are highlighted on present (legacy feedback.js:218-220;
 * dead-in-legacy, made real per LD-10). Includes the rating response region
 * (feedback.js:46-74 + blockpy.js:789-817) and the instructor score/reset
 * header controls (feedback.js:32-38).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { categoryPresentation } from './categories';
import { highlightCodeBlocks } from './highlight';
import { Icon } from './icons';
import { renderInstructions } from './Instructions';
import { useEditorChromeStore } from './store';

/**
 * Legacy updateFeedback ran EVERY presented message through the markdown
 * pipeline (feedback.js:213 — `utilities.markdown(message)` = the same
 * EasyMDE/marked path as instructions) with the `<pre>\n` doubling quirk.
 * Inline HTML passes through marked untouched (D4-A: unsanitized).
 */
export function renderFeedbackMessage(message: string): string {
  return renderInstructions(message).replace(/<pre>\n/g, '<pre>\n\n');
}

/** Legacy localSettings key (LocalStorageWrapper "BLOCKPY" prefix). */
const SHOW_RATING_KEY = 'BLOCKPY_display.showRating';

function readShowRating(): boolean {
  try {
    return localStorage.getItem(SHOW_RATING_KEY) !== 'false';
  } catch {
    return true;
  }
}

export interface FeedbackProps {
  size?: string;
  /**
   * Legacy provideRatings (= !assignment.hidden, blockpy.js:789-791):
   * the rating region renders only when true AND a handler is attached.
   */
  onRate?: (rating: 'thumbs-up' | 'thumbs-down') => void;
  /** display.instructor — score % + reset control in the header. */
  instructor?: boolean;
  /** submission.score (0-1); header shows (100*score)% for instructors. */
  score?: number;
  /** Legacy ui.feedback.resetScore (blockpy.js:784-788). */
  onResetScore?: () => void;
}

export function Feedback({ size = 'col-md-6', ...props }: FeedbackProps) {
  const feedback = useEditorChromeStore((state) => state.feedback);
  const setTraceVisible = useEditorChromeStore((state) => state.setTraceVisible);
  const hasTrace = useEditorChromeStore((state) => state.traceSteps.length > 0);
  const presentation = categoryPresentation(feedback.category);
  const messageRef = useRef<HTMLDivElement>(null);
  // Rating region state: visibility persists like legacy localSettings.
  const [showRating, setShowRating] = useState(readShowRating);
  const [hasRated, setHasRated] = useState(false);
  const [thankYou, setThankYou] = useState(false);
  const store = useEditorChromeStore;

  const renderedMessage = useMemo(
    () => renderFeedbackMessage(feedback.message),
    [feedback.message],
  );

  // Legacy highlights feedback code immediately (no debounce).
  useEffect(() => {
    if (messageRef.current) highlightCodeBlocks(messageRef.current);
  }, [renderedMessage]);

  const flipRating = () => {
    const next = !showRating;
    setShowRating(next);
    try {
      localStorage.setItem(SHOW_RATING_KEY, String(next));
    } catch {
      // Storage unavailable (sandboxed iframe) — the toggle still works.
    }
  };

  const rate = (rating: 'thumbs-up' | 'thumbs-down') => {
    props.onRate?.(rating);
    setHasRated(true);
    setThankYou(true);
    // Ledger LD-18: only a NEGATIVE rating suggests sharing after the 1 s
    // thank-you. Legacy opened the "having trouble?" prompted share dialog
    // for ANY rating (blockpy.js:801-813, dead suggestShare param) —
    // thanking someone for a thumbs-up with a trouble dialog was noise.
    setTimeout(() => {
      setThankYou(false);
      if (rating === 'thumbs-down') {
        store.getState().requestPromptedShare();
      }
    }, 1000);
  };

  const score = props.score ?? 0;
  const ratable = Boolean(props.onRate && feedback.label);
  return (
    <div
      className={`blockpy-feedback blockpy-panel ${size}`}
      aria-live="polite"
    >
      {/* One header row. Flex (not clearfix/float): a floated button inside
          the flex-column panel forced the row to button height while the
          inline title sat on the top baseline — the "View Trace gap"
          (M3.2). */}
      <div className="blockpy-panel-header">
        <strong className="feedback-header">Feedback: </strong>
        <span
          className={`badge blockpy-feedback-category feedback-badge ${presentation.badgeClass}`}
        >
          {presentation.displayText}
        </span>
        {props.instructor && feedback.label !== '' && (
          <small className="text-muted"> {100 * score}%</small>
        )}
        {props.instructor && feedback.label !== '' && score > 0 && props.onResetScore && (
          <small
            className="text-muted blockpy-feedback-reset"
            style={{ cursor: 'pointer' }}
            onClick={props.onResetScore}
          >
            {' '}
            <u>(reset)</u>
          </small>
        )}
        {hasTrace && (
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary blockpy-panel-header-action"
            onClick={() => setTraceVisible(true)}
          >
            <Icon name="eye" /> View Trace
          </button>
        )}
      </div>
      <strong className="blockpy-feedback-label">{feedback.label}</strong>
      <div
        ref={messageRef}
        className="blockpy-feedback-message"
        // Legacy renders feedback HTML unsanitized (D4-A applies here too —
        // the message body comes from instructor Pedal scripts), AFTER the
        // markdown pass (feedback.js:213).
        dangerouslySetInnerHTML={{ __html: renderedMessage }}
      />
      {(feedback.positives ?? []).length > 0 && (
        <div className="blockpy-feedback-positives">
          {feedback.positives!.map((positive, i) => (
            <div
              key={i}
              className="blockpy-feedback-positive"
              title={positive.title}
            >
              <Icon name="star" /> {positive.message}
            </div>
          ))}
        </div>
      )}
      <div style={{ position: 'relative' }}>
        <span
          className={`blockpy-feedback-thank-you${thankYou ? ' show' : ''}`}
        >
          Thank you!
        </span>
      </div>
      {ratable && showRating && (
        <small
          className="blockpy-feedback-response-full"
          style={{ textAlign: 'right' }}
        >
          <span
            style={{ cursor: 'pointer' }}
            onClick={flipRating}
            title="Hide rating"
          >
            <Icon name="rateCollapse" />
          </span>{' '}
          Rate this Feedback:{' '}
          <span
            className="blockpy-rating blockpy-rating-up"
            style={{ cursor: 'pointer', opacity: hasRated ? 0.5 : 1 }}
            onClick={() => rate('thumbs-up')}
          >
            <Icon name="thumbsUp" />
          </span>
          <span
            className="blockpy-rating blockpy-rating-down"
            style={{ cursor: 'pointer', opacity: hasRated ? 0.5 : 1 }}
            onClick={() => rate('thumbs-down')}
          >
            <Icon name="thumbsDown" />
          </span>
        </small>
      )}
      {ratable && !showRating && (
        <small
          className="blockpy-feedback-response-collapsed"
          style={{ position: 'absolute', right: 0, bottom: 0 }}
        >
          <span
            style={{ cursor: 'pointer', verticalAlign: 'middle' }}
            onClick={flipRating}
            title="Show rating"
          >
            <Icon name="rateExpand" />
          </span>{' '}
          Rate
        </small>
      )}
    </div>
  );
}
