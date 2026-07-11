/**
 * Assignment-group header (spec §9.1) — the React port of the
 * `assignment_group_header` Jinja macro (blockpy-server
 * templates/helpers/assignment_groups.html:146-200). Rendered TWICE (top
 * and bottom of the page) from one GroupNavStore, matching the double
 * template include; §9.6 CSS hooks are preserved verbatim.
 *
 * Icons: legacy FontAwesome fa-step-backward/chevron-left/chevron-right/
 * fa-step-forward → Lucide SkipBack/ChevronLeft/ChevronRight/SkipForward —
 * identical glyph shapes, same modernization the editor chrome applied to
 * its trace/history steppers (editor icons.tsx, A8 §3.2).
 */
import { useEffect, useSyncExternalStore } from 'react';
import { ChevronLeft, ChevronRight, SkipBack, SkipForward, type LucideProps } from 'lucide-react';
import type { GroupNavStore } from './store';

const ICON_PROPS: LucideProps = {
  size: 14,
  strokeWidth: 1.75,
  'aria-hidden': true,
  style: { verticalAlign: 'text-bottom' },
};

export interface GroupNavProps {
  store: GroupNavStore;
}

export function GroupNav({ store }: GroupNavProps) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  // Clock/countdown timers are ref-counted across the two instances.
  useEffect(() => store.attach(), [store]);

  const { entries, anySecretive, currentId, correct, numerator, nextSuccess, expanded } = state;
  const atFirst = currentId === store.firstId;
  const atLast = currentId === store.lastId;
  const current = entries.find((entry) => entry.id === currentId);
  // markCorrect swaps btn-outline-secondary for btn-success (A7 §2) — the
  // two are mutually exclusive, matching the legacy removeClass/addClass.
  const nextButtonClass = `btn ${nextSuccess ? 'btn-success' : 'btn-outline-secondary'} mr-2 btn-sm assignment-selector-btn assignment-selector-next`;

  return (
    <div className="assignment-selector-div">
      <div className="row">
        <div className="col-md-12 mt-1 mb-1 ml-2 mr-2">
          <div className="center-block">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm mr-2 assignment-selector-btn assignment-selector-first"
              disabled={atFirst}
              onClick={() => store.first()}
            >
              <SkipBack {...ICON_PROPS} /> First
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm mr-2 assignment-selector-btn assignment-selector-back"
              disabled={atFirst}
              onClick={() => store.back()}
            >
              <ChevronLeft {...ICON_PROPS} /> Back
            </button>
            <select
              className="assignment-selector m-1"
              value={currentId}
              // Legacy: size = min(5, document-wide options / 2) — with the
              // dual-rendered header that resolves to min(5, N) (:97).
              size={expanded ? Math.min(5, entries.length) : 1}
              style={{ verticalAlign: expanded ? 'top' : 'middle' }}
              onChange={(event) => store.navigateTo(parseInt(event.target.value, 10))}
            >
              {entries.map((entry) => {
                const isCorrect = !anySecretive && correct.has(entry.id);
                return (
                  <option
                    key={entry.id}
                    value={entry.id}
                    className={
                      anySecretive
                        ? 'secret-submission'
                        : isCorrect
                          ? 'correct-submission'
                          : 'incorrect-submission'
                    }
                  >
                    {isCorrect ? `✔ ${entry.name}` : entry.name}
                  </option>
                );
              })}
            </select>
            <span className="completion-box m-1" onClick={() => store.toggleExpansion()}>
              (<span className="completion-rate">{anySecretive ? '??' : numerator}</span>/
              {entries.length} completed)
            </span>
            <button
              type="button"
              className={nextButtonClass}
              disabled={atLast}
              onClick={() => store.next()}
            >
              Next <ChevronRight {...ICON_PROPS} />
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm assignment-selector-btn assignment-selector-last"
              disabled={atLast}
              onClick={() => store.last()}
            >
              Last <SkipForward {...ICON_PROPS} />
            </button>
            <span
              className="float-right text-muted assignment-selector-countdown"
              title="Time remaining (if a time limit is set)"
            >
              {state.countdownText}
            </span>
            <span
              className="float-right text-muted assignment-selector-clock"
              title="Estimate time spent (click to get total time spent across all sessions)"
              style={state.clockVisible ? undefined : { display: 'none' }}
              onClick={() => store.clockClicked()}
            >
              {state.clockText}
            </span>
            {/* aria-live announcement — new but non-breaking (§9.3). */}
            <span className="sr-only" aria-live="polite">
              {current ? `Assignment: ${current.name}` : ''}
            </span>
          </div>
        </div>
        {state.notice !== null && <span>{state.notice}</span>}
      </div>
    </div>
  );
}
