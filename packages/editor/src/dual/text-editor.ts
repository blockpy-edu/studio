/**
 * Text half of the dual editor - port of legacy `BlockMirror/src/text_editor.js`
 * on CodeMirror 6 (legacy used CM5).
 *
 * Ported semantics (round-trip/UX conformance):
 *  - `setCode(code, quietly)`: a quiet set must not re-trigger the sync loop
 *    (legacy `silentEvents_`; here a transaction annotation, which is exact
 *    rather than "swallow the next event").
 *  - `outOfDate_` deferral: sets while hidden are stashed and flushed when
 *    the editor becomes visible again.
 *  - view-mode table: split 40% / text 100% / block hidden, with the 675px
 *    responsive breakpoint handled by the controller.
 *  - `setHighlightedLines(lines, style)` / `clearHighlightedLines(style)` -
 *    line classes drive the A8 highlight colors (editor-error-line, …).
 *  - Tab/Shift-Tab indent, Ctrl-Enter runs (legacy *intended* this; its
 *    binding read an undefined property - fixed here), Esc blurs.
 *
 * CM6 additions sanctioned by the milestone plan (not in legacy, which had
 * lint/autocomplete commented out): syntax lint from the shared Lezer parse
 * (same B1–B3 gate as block generation) and autocompletion.
 */
import {
  Annotation,
  Compartment,
  EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from '@codemirror/state';
import { Decoration, EditorView, keymap, lineNumbers } from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentMore,
} from '@codemirror/commands';
import {
  bracketMatching,
  foldGutter,
  indentUnit,
  syntaxHighlighting,
  defaultHighlightStyle,
} from '@codemirror/language';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { linter, type Diagnostic } from '@codemirror/lint';
import { python } from '@codemirror/lang-python';
import { HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { parseSource } from '@blockpy/blocks';

/** Themes the dual editor understands (M4.1; store `ThemeName` values -
 * win2000 is a chrome-only skin, so the code surface treats it as light). */
export type EditorTheme = 'light' | 'dark' | 'win2000';

/**
 * Dark syntax colors (M4.1, LD-23). NOT legacy-normative - themes are a
 * Studio extension; palette is the familiar One-Dark family for AA contrast
 * on the #1e1e1e surface (themes.css owns the editor chrome colors).
 */
const darkHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: '#c678dd' },
  {
    tag: [tags.name, tags.deleted, tags.character, tags.propertyName],
    color: '#e06c75',
  },
  { tag: [tags.function(tags.variableName), tags.labelName], color: '#61afef' },
  {
    tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)],
    color: '#d19a66',
  },
  { tag: [tags.definition(tags.name), tags.separator], color: '#abb2bf' },
  {
    tag: [tags.typeName, tags.className, tags.number, tags.self, tags.namespace],
    color: '#e5c07b',
  },
  {
    tag: [tags.operator, tags.operatorKeyword, tags.escape, tags.regexp],
    color: '#56b6c2',
  },
  { tag: [tags.meta, tags.comment], color: '#7d8799' },
  { tag: [tags.string, tags.special(tags.string)], color: '#98c379' },
  { tag: tags.invalid, color: '#ffffff' },
]);

/** Marks programmatic `setCode(..., quietly=true)` transactions. */
const silentSet = Annotation.define<boolean>();

const addHighlight = StateEffect.define<{ lines: number[]; style: string }>();
const clearHighlight = StateEffect.define<{ style: string | null }>();

interface HighlightEntry {
  line: number;
  style: string;
}

const highlightField = StateField.define<HighlightEntry[]>({
  create: () => [],
  update(entries, tr) {
    let next = entries;
    for (const effect of tr.effects) {
      if (effect.is(addHighlight)) {
        next = [
          ...next,
          ...effect.value.lines.map((line) => ({
            line,
            style: effect.value.style,
          })),
        ];
      } else if (effect.is(clearHighlight)) {
        next =
          effect.value.style === null ? [] : next.filter((e) => e.style !== effect.value.style);
      }
    }
    return next;
  },
});

const highlightPlugin = EditorView.decorations.compute(['doc', highlightField], (state) => {
  const builder = new RangeSetBuilder<Decoration>();
  const entries = [...state.field(highlightField)].sort((a, b) => a.line - b.line);
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.line < 1 || entry.line > state.doc.lines) continue;
    const key = `${entry.line}|${entry.style}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const line = state.doc.line(entry.line);
    builder.add(line.from, line.from, Decoration.line({ class: entry.style }));
  }
  return builder.finish();
});

/** Syntax lint from the shared Lezer parse - same gate as block generation. */
function pythonSyntaxLinter() {
  return linter((view): Diagnostic[] => {
    const source = view.state.doc.toString();
    if (source.trim() === '') return [];
    const { errors } = parseSource(source);
    return errors.map((error) => ({
      from: Math.min(error.from, view.state.doc.length),
      to: Math.min(Math.max(error.to, error.from + 1), view.state.doc.length),
      severity: 'error' as const,
      message: `Syntax error on line ${error.line}`,
    }));
  });
}

export interface TextEditorViewConfiguration {
  width: string;
  visible: boolean;
  indentSidebar: boolean;
}

export interface TextEditorHost {
  /** Container/sidebar tags created by the DualEditor DOM scaffold. */
  textContainer: HTMLElement;
  textSidebar: HTMLElement;
  /** Configured editor height in px (legacy `config.height`). */
  height: number;
  /** Responsive stacking breakpoint check (window width >= 675). */
  isWide(): boolean;
  /** Whether the legacy text-mode indent sidebar is enabled at all. */
  indentSidebar: boolean;
  /** Toolbar width of the block editor, for the text-mode indent sidebar. */
  getBlockToolbarWidth(): number;
  /** Run callback (legacy `config.run`, bound to Ctrl-Enter). */
  run(): void;
  /** Sync-loop entry: user edited the text. */
  onTextChanged(newCode: string): void;
}

export class DualTextEditor {
  static readonly VIEW_CONFIGURATIONS: Record<string, TextEditorViewConfiguration> = {
    split: { width: '40%', visible: true, indentSidebar: false },
    text: { width: '100%', visible: true, indentSidebar: true },
    block: { width: '0%', visible: false, indentSidebar: false },
  };

  readonly view: EditorView;
  private readonly host: TextEditorHost;
  private readonly readOnly = new Compartment();
  private readonly autocomplete = new Compartment();
  private readonly theme = new Compartment();
  private mode_: keyof typeof DualTextEditor.VIEW_CONFIGURATIONS = 'split';
  /** Code stashed while hidden, applied on next show (legacy `outOfDate_`). */
  private outOfDate_: string | null = null;

  constructor(host: TextEditorHost, initialReadOnly: boolean) {
    this.host = host;
    this.view = new EditorView({
      parent: host.textContainer,
      state: EditorState.create({
        doc: '',
        extensions: [
          lineNumbers(),
          history(),
          foldGutter(),
          bracketMatching(),
          indentUnit.of('    '),
          python(),
          // Accessible name for the contenteditable (WCAG audit M6.1 -
          // axe aria-input-field-name).
          EditorView.contentAttributes.of({ 'aria-label': 'Python code editor' }),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          // OFF by default (M3.3): legacy CM5 had no autocomplete, and the
          // popup distracts novices. A toolbar toggle reconfigures it live.
          this.autocomplete.of([]),
          // Empty = light (parity default). Reconfigured by setTheme (M4.1).
          this.theme.of([]),
          pythonSyntaxLinter(),
          highlightField,
          highlightPlugin,
          this.readOnly.of(EditorState.readOnly.of(initialReadOnly)),
          keymap.of([
            { key: 'Tab', run: indentMore },
            { key: 'Shift-Tab', run: indentLess },
            {
              key: 'Ctrl-Enter',
              run: () => {
                this.host.run();
                return true;
              },
            },
            {
              key: 'Escape',
              run: (view) => {
                view.contentDOM.blur();
                return true;
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
            ...completionKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const quiet = update.transactions.some((tr) => tr.annotation(silentSet));
            if (quiet) return;
            this.host.onTextChanged(this.getCode());
          }),
        ],
      }),
    });
    this.view.dom.style.height = '100%';
  }

  getCode(): string {
    return this.view.state.doc.toString();
  }

  setCode(code: string, quietly = false): void {
    if (!this.isVisible()) {
      this.outOfDate_ = code;
      return;
    }
    this.applyCode(code, quietly);
  }

  private applyCode(code: string, quietly: boolean): void {
    if (code === this.getCode()) return;
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: code },
      annotations: quietly ? silentSet.of(true) : undefined,
    });
  }

  isVisible(): boolean {
    return DualTextEditor.VIEW_CONFIGURATIONS[this.mode_]!.visible;
  }

  setMode(mode: string): void {
    this.mode_ = mode as keyof typeof DualTextEditor.VIEW_CONFIGURATIONS;
    const config = DualTextEditor.VIEW_CONFIGURATIONS[mode]!;
    // Flush any pending code before revealing (legacy setMode order).
    if (config.visible && this.outOfDate_ !== null) {
      const pending = this.outOfDate_;
      this.outOfDate_ = null;
      this.applyCode(pending, true);
    }
    this.resizeResponsively();
    if (config.visible) {
      this.host.textContainer.style.display = 'block';
      this.view.requestMeasure();
    } else {
      this.host.textContainer.style.height = '0%';
      this.host.textContainer.style.display = 'none';
    }
    this.updateGutter(config);
  }

  /** Legacy responsive table: split stacks below the 675px breakpoint. */
  resizeResponsively(): void {
    const config = DualTextEditor.VIEW_CONFIGURATIONS[this.mode_]!;
    const style = this.host.textContainer.style;
    if (this.mode_ === 'split') {
      if (this.host.isWide()) {
        style.width = config.width;
        style.height = this.host.height + 'px';
      } else {
        style.width = '100%';
        style.height = this.host.height / 2 + 'px';
      }
    } else {
      style.width = config.width;
      style.height = this.host.height + 'px';
    }
  }

  /**
   * Text-mode indent sidebar: pad the gutter so code starts where it does in
   * split mode (aligned under the block toolbox), legacy `updateGutter`.
   */
  private updateGutter(config: TextEditorViewConfiguration): void {
    const sidebar = this.host.textSidebar.style;
    if (config.indentSidebar && this.host.indentSidebar && this.host.isWide()) {
      const gutters = this.view.dom.querySelector<HTMLElement>('.cm-gutters');
      const gutterWidth = gutters ? gutters.offsetWidth : 0;
      const targetWidth = this.host.getBlockToolbarWidth() - gutterWidth - 2;
      sidebar.display = 'block';
      sidebar.width = Math.max(0, targetWidth) + 'px';
    } else {
      sidebar.display = 'none';
      sidebar.width = '0px';
    }
  }

  setReadOnly(isReadOnly: boolean): void {
    this.view.dispatch({
      effects: this.readOnly.reconfigure(EditorState.readOnly.of(isReadOnly)),
    });
  }

  /** Live-toggle CM6 autocomplete (M3.3; default off). */
  setAutocomplete(enabled: boolean): void {
    this.view.dispatch({
      effects: this.autocomplete.reconfigure(enabled ? autocompletion() : []),
    });
  }

  /**
   * Live-swap the code surface theme (M4.1). Dark flags CM6's dark base
   * (selection/panel defaults) and swaps in the dark HighlightStyle - the
   * `fallback: true` default style yields to it automatically. Light and
   * win2000 (chrome-only skin) leave the parity defaults in place.
   */
  setTheme(theme: EditorTheme): void {
    this.view.dispatch({
      effects: this.theme.reconfigure(
        theme === 'dark'
          ? [EditorView.theme({}, { dark: true }), syntaxHighlighting(darkHighlightStyle)]
          : [],
      ),
    });
  }

  setHighlightedLines(lines: number[], style: string): void {
    this.view.dispatch({ effects: addHighlight.of({ lines, style }) });
  }

  clearHighlightedLines(style: string | null = null): void {
    this.view.dispatch({ effects: clearHighlight.of({ style }) });
  }

  refresh(): void {
    this.view.requestMeasure();
  }

  dispose(): void {
    this.view.destroy();
  }
}
