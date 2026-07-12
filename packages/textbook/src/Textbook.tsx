/**
 * Textbook assignment component (spec §11.4) — a thin composition over
 * `reader` per the M2.5 decision: the parity reference is the WORKING
 * standalone textbook page (templates/blockpy/textbook.html), not the
 * `<textbook>` knockout component, which shipped unfinished (its content
 * renderer is commented out and editor.html never passes it a textbook —
 * ledger LD-15).
 *
 * Ported observables (textbook.html):
 *   - Sidebar: the recursive `textbook_item` macro (:60-81) — list-group
 *     items indented `5 + indent*8` px; readings clickable
 *     (`list-group-item-info` at the top level only); header-only items
 *     `disabled list-group-item-secondary`; active tracks the open page.
 *   - Open page: `<reader asPreamble: true>` with a NO-OP markCorrect
 *     (:109) — the textbook itself never marks correct (the component's
 *     own markRead is commented out, textbook.ts:121-156); the READING's
 *     completion still posts through the reader's own markRead.
 *   - URL contract: `openReading` pushes `?page=<url>` history state
 *     preserving other params (:121-126); popstate restores; the title
 *     becomes "<page> - <textbook> - BlockPy Textbook" (:135-138).
 *   - Instructor editing: the legacy RAW mode (instructions + settings
 *     textareas + Save, textbook.ts EDITOR_HTML); FORM mode
 *     (jsoneditor/filepond) is deferred.
 *
 * Client-side rehydration (LD-16): the wire document carries url strings;
 * with no by-url endpoint on an unmodified server the component takes an
 * optional `resolveAssignment`; unresolved entries render as the legacy
 * "Missing Reading" style.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AssignmentSurface } from '@blockpy/editor';
import {
  firstReading,
  findReadingByPage,
  parseTextbookDocument,
  walkItems,
  InvalidTextbookSchema,
  MISSING_READING,
  type TextbookAssignmentRef,
  type TextbookDocument,
  type TextbookItem,
} from './document';

export interface TextbookAssignment {
  id: number;
  name: string;
  url: string;
  /** The textbook JSON document. */
  instructions: string;
  /** Raw settings JSON string. */
  settings: string;
}

export interface TextbookLoadResult {
  assignment: TextbookAssignment;
  submission: { id: number | null } | null;
}

export interface TextbookProps {
  assignmentId: number;
  loadAssignment: (assignmentId: number) => Promise<TextbookLoadResult | null>;
  /** The open page — the app injects a full `Reader` (asPreamble, no-op
   *  markCorrect), keyed by reading id. */
  renderReading: (readingId: number) => ReactNode;
  /** Client-side rehydration (LD-16): url slug → assignment. Absent or
   *  null result ⇒ the legacy MISSING_READING style. */
  resolveAssignment?: (url: string) => Promise<{ id: number; name: string; url: string } | null>;
  isInstructor?: () => boolean;
  /** RAW-editor persistence: `!instructions.md` via saveFile plus the
   *  settings through saveAssignment (legacy textbook.ts:111-119). */
  saveTextbookAssignment?: (
    assignmentId: number,
    instructions: string,
    settings: string,
  ) => Promise<{ success: boolean }>;
  logEvent?: (
    eventType: string,
    category: string,
    label: string,
    message: string,
    filePath: string,
  ) => void;
}

interface LoadedTextbook {
  assignment: TextbookAssignment;
  submission: { id: number | null } | null;
  document: TextbookDocument;
}

type EditorMode = 'RAW' | 'SUBMISSION';

const pageParam = (): string => {
  try {
    return new URLSearchParams(window.location.search).get('page') ?? '';
  } catch {
    return '';
  }
};

export function Textbook(props: TextbookProps) {
  const [loaded, setLoaded] = useState<LoadedTextbook | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [page, setPage] = useState<TextbookAssignmentRef | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>('SUBMISSION');
  const [draftInstructions, setDraftInstructions] = useState('');
  const [draftSettings, setDraftSettings] = useState('');
  const [reloadNonce, setReloadNonce] = useState(0);
  const propsRef = useRef(props);
  propsRef.current = props;
  const loadedRef = useRef<LoadedTextbook | null>(null);
  loadedRef.current = loaded;

  // -- load + client-side rehydration ---------------------------------------
  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setErrorMessage('');
    setPage(null);
    void propsRef.current
      .loadAssignment(props.assignmentId)
      .then(async (result) => {
        if (cancelled || !result) {
          if (!result) setErrorMessage(`The textbook (${props.assignmentId}) failed to load.`);
          return;
        }
        let doc: TextbookDocument;
        try {
          doc = parseTextbookDocument(result.assignment.instructions);
        } catch (error) {
          // The server route 400s on schema errors (assignments.py:122-123).
          setErrorMessage(
            error instanceof InvalidTextbookSchema
              ? `Error: ${error.message}`
              : `Error: ${String(error)}`,
          );
          return;
        }
        // Rehydrate url-string references (LD-16) before first render so
        // the sidebar names/ids are stable.
        const resolve = propsRef.current.resolveAssignment;
        for (const item of walkItems(doc.content)) {
          for (const key of ['reading', 'group'] as const) {
            const ref = item[key];
            if (!ref || ref.id !== null || ref.missing) continue;
            if (!resolve) {
              item[key] = { ...ref, name: MISSING_READING.name, missing: true };
              continue;
            }
            try {
              const resolved = await resolve(ref.url);
              item[key] = resolved
                ? { id: resolved.id, name: resolved.name, url: resolved.url, missing: false }
                : { ...ref, name: MISSING_READING.name, missing: true };
            } catch {
              item[key] = { ...ref, name: MISSING_READING.name, missing: true };
            }
          }
        }
        if (cancelled) return;
        setLoaded({ assignment: result.assignment, submission: result.submission, document: doc });
        setDraftInstructions(result.assignment.instructions);
        setDraftSettings(result.assignment.settings);
        // Boot page: ?page= (by url then id, assignments.py:100-112),
        // falling back to the first reading (default_first_page).
        const requested = pageParam();
        const initial =
          (requested ? findReadingByPage(doc, requested) : null) ?? firstReading(doc);
        setPage(initial);
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('Failed to load (HTTP LEVEL)', error);
          setErrorMessage(`The textbook (${props.assignmentId}) failed to load.`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [props.assignmentId, reloadNonce]);

  // -- page navigation (textbook.html:121-138) --------------------------------
  const updateTitle = useCallback((name: string) => {
    const current = loadedRef.current;
    if (!current) return;
    document.title = `${name} - ${current.assignment.name} - BlockPy Textbook`;
  }, []);

  const openReading = useCallback(
    (reading: TextbookAssignmentRef) => {
      setPage(reading);
      updateTitle(reading.name);
      try {
        const pageUrl = new URL(window.location.href);
        pageUrl.searchParams.set('page', reading.url);
        window.history.pushState(
          { id: reading.id, url: reading.url, name: reading.name },
          '',
          pageUrl,
        );
      } catch {
        // Sandboxed/about: pages — navigation state just stays local.
      }
    },
    [updateTitle],
  );

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const state = event.state as { id?: number; url?: string; name?: string } | null;
      if (!state || typeof state.url !== 'string') return;
      const current = loadedRef.current;
      if (!current) return;
      const reading = findReadingByPage(current.document, state.url);
      if (reading) {
        setPage(reading);
        updateTitle(reading.name);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [updateTitle]);

  // -- sidebar (the textbook_item macro, textbook.html:60-81) -----------------
  const renderItem = (item: TextbookItem, indent: number, key: string): ReactNode => {
    const reading = item.reading;
    const clickable = reading !== null && !reading.missing && reading.id !== null;
    const classStyle =
      reading && clickable
        ? indent >= 1
          ? ''
          : ' list-group-item-info'
        : ' disabled list-group-item-secondary';
    const label = item.header ?? reading?.name ?? null;
    const active = clickable && reading!.id === page?.id;
    return (
      <div key={key}>
        {label !== null && (
          <div
            className={`list-group-item list-group-item-action book-item${classStyle}${active ? ' active' : ''}`}
            style={{ paddingLeft: `${5 + indent * 8}px` }}
            role={clickable ? 'button' : undefined}
            onClick={clickable ? () => openReading(reading!) : undefined}
          >
            {label}
          </div>
        )}
        {item.content.map((child, index) => renderItem(child, indent + 1, `${key}-${index}`))}
      </div>
    );
  };

  if (!loaded) {
    return (
      <div className="blockpy-textbook">
        {errorMessage ? (
          <div className="alert alert-warning">{errorMessage}</div>
        ) : (
          'Loading textbook…'
        )}
      </div>
    );
  }

  const instructor = props.isInstructor?.() === true;

  return (
    <AssignmentSurface
      assignmentId={loaded.assignment.id}
      submissionId={loaded.submission?.id ?? null}
      variant="full"
      {...(props.logEvent ? { logEvent: props.logEvent } : {})}
    >
      <div className="blockpy-textbook">
        {errorMessage.length > 0 && (
          <div className="alert alert-warning p-1 border rounded float-right">{errorMessage}</div>
        )}
        {instructor && (
          <div className="textbook-editor-modes">
            {(
              [
                ['RAW', 'Raw Editor'],
                ['SUBMISSION', 'Actual Textbook'],
              ] as const
            ).map(([value, label]) => (
              <div className="form-check" key={value}>
                <label className="form-check-label">
                  <input
                    className="form-check-input"
                    type="radio"
                    name="textbook-editor-mode-radio"
                    value={value}
                    checked={editorMode === value}
                    onChange={() => setEditorMode(value)}
                  />{' '}
                  {label}
                </label>
              </div>
            ))}
          </div>
        )}
        {instructor && editorMode === 'RAW' ? (
          <div className="textbook-raw-editor">
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary"
              onClick={() => {
                const save = propsRef.current.saveTextbookAssignment;
                if (!save) return;
                void save(loaded.assignment.id, draftInstructions, draftSettings).then(
                  (result) => {
                    if (result.success) {
                      setReloadNonce((nonce) => nonce + 1);
                    } else {
                      setErrorMessage('Failed to save the textbook.');
                    }
                  },
                );
              }}
            >
              Save Assignment
            </button>
            <br />
            <h6>Instructions</h6>
            <textarea
              className="textbook-editor-instructions"
              style={{ width: '100%', height: '300px' }}
              value={draftInstructions}
              onChange={(event) => setDraftInstructions(event.target.value)}
            />
            <br />
            <h6>Settings</h6>
            <textarea
              className="textbook-editor-settings"
              style={{ width: '100%', height: '300px' }}
              value={draftSettings}
              onChange={(event) => setDraftSettings(event.target.value)}
            />
          </div>
        ) : (
          <div className="row" id="textbook">
            <div className="col-md-4 col-lg-3 textbook-navigation">
              <div className="list-group">
                {loaded.document.content.map((item, index) =>
                  renderItem(item, 0, `item-${index}`),
                )}
              </div>
            </div>
            <div className="col-md-8 col-lg-9 textbook-page">
              {page && page.id !== null ? (
                // Keyed so a page switch remounts the reader (its load
                // effect keys on assignmentId anyway; the key keeps state
                // like runnable launches from leaking across pages).
                <div key={page.id}>{props.renderReading(page.id)}</div>
              ) : (
                <div className="textbook-empty">Select a reading from the sidebar.</div>
              )}
            </div>
          </div>
        )}
      </div>
    </AssignmentSurface>
  );
}
