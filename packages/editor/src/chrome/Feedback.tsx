/**
 * Feedback pane — Row 2 right (A8 §1/§4.5: category badge with the legacy
 * `label-*` classes, bold label, HTML message; aria-live like legacy).
 */
import { categoryPresentation } from './categories';
import { Icon } from './icons';
import { useEditorChromeStore } from './store';

export interface FeedbackProps {
  size?: string;
}

export function Feedback({ size = 'col-md-6' }: FeedbackProps) {
  const feedback = useEditorChromeStore((state) => state.feedback);
  const setTraceVisible = useEditorChromeStore((state) => state.setTraceVisible);
  const hasTrace = useEditorChromeStore((state) => state.traceSteps.length > 0);
  const presentation = categoryPresentation(feedback.category);
  return (
    <div
      className={`blockpy-feedback blockpy-panel ${size}`}
      aria-live="polite"
    >
      {/* One header row: .blockpy-feedback is a flex column (legacy), so
          bare inline children would stretch full-width — group them. */}
      <div className="clearfix">
        {hasTrace && (
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary float-right"
            onClick={() => setTraceVisible(true)}
          >
            <Icon name="eye" /> View Trace
          </button>
        )}
        <strong className="feedback-header">Feedback: </strong>
        <span
          className={`badge blockpy-feedback-category feedback-badge ${presentation.badgeClass}`}
        >
          {presentation.displayText}
        </span>
      </div>
      <strong className="blockpy-feedback-label">{feedback.label}</strong>
      <div
        className="blockpy-feedback-message"
        // Legacy renders feedback HTML unsanitized (D4-A applies here too —
        // the message body comes from instructor Pedal scripts).
        dangerouslySetInnerHTML={{ __html: feedback.message }}
      />
    </div>
  );
}
