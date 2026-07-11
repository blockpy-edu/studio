/**
 * Feedback pane — Row 2 right (A8 §1/§4.5: category badge with the legacy
 * `label-*` classes, bold label, HTML message; aria-live like legacy).
 */
import { categoryPresentation } from './categories';
import { useEditorChromeStore } from './store';

export interface FeedbackProps {
  size?: string;
}

export function Feedback({ size = 'col-md-6' }: FeedbackProps) {
  const feedback = useEditorChromeStore((state) => state.feedback);
  const presentation = categoryPresentation(feedback.category);
  return (
    <div
      className={`blockpy-feedback blockpy-panel ${size}`}
      aria-live="polite"
    >
      <strong className="feedback-header">Feedback: </strong>
      <span
        className={`badge blockpy-feedback-category feedback-badge ${presentation.badgeClass}`}
      >
        {presentation.displayText}
      </span>
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
