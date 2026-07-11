/**
 * Runnable code-block hydration (spec §11.2, A6 §2.3).
 *
 * The markdown pipeline emits `.reader-runnable-slot` divs after each
 * python/ts/r fence; the legacy knockout `blockPyEditor` binding put a Run
 * button there that swapped the highlighted <pre> for a full BlockPy
 * instance (plugins.ts:350-368). The rewrite hydrates the slot with the
 * §8.4 minified editor sharing the page engine instead; runnable = python
 * fence with a NON-EMPTY info-string part id (the binding refused a Run
 * button when partId was falsy, plugins.ts:353). Kettle (ts/r) slots stay
 * inert until the M2.5 legacy island. Save/submit endpoints are stripped
 * (the legacy instance dropped saveAssignment/updateSubmission*,
 * plugins.ts:321-326; the minified editor has no persistence at all — the
 * part-id saveFile composition is noted in the plan as pending).
 */
import { useState } from 'react';
import { MinifiedEditor, type RunController } from '@blockpy/editor';
import { Play } from 'lucide-react';

export interface RunnableSlot {
  /** The portal target emitted by the markdown pipeline. */
  slot: HTMLElement;
  /** The highlighted <pre> to hide on launch (plugins.ts:362). */
  pre: HTMLElement | null;
  /** Raw fence source (the hidden sibling div, plugins.ts:359). */
  source: string;
  partId: string;
  kind: 'blockpy' | 'kettle';
}

/** Scan a rendered reading body for hydratable blocks. Only blockpy slots
 *  with a part id are runnable; the rest render as plain highlighted code. */
export function collectRunnableSlots(container: HTMLElement): RunnableSlot[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('.reader-runnable-slot'),
  )
    .map((slot) => {
      const hidden = slot.previousElementSibling as HTMLElement | null;
      const pre = (hidden?.previousElementSibling as HTMLElement | null) ?? null;
      return {
        slot,
        pre,
        source: hidden?.textContent ?? '',
        partId: slot.dataset['partId'] ?? '',
        kind: (slot.dataset['kind'] === 'kettle' ? 'kettle' : 'blockpy') as
          | 'blockpy'
          | 'kettle',
      };
    })
    .filter((candidate) => candidate.kind === 'blockpy' && candidate.partId !== '');
}

export interface RunnableBlockProps {
  pre: HTMLElement | null;
  source: string;
  runController?: RunController;
  blocklyMediaPath?: string;
}

export function RunnableBlock({ pre, source, runController, blocklyMediaPath }: RunnableBlockProps) {
  const [launched, setLaunched] = useState(false);
  if (launched) {
    return (
      <MinifiedEditor
        initialCode={source}
        runController={runController}
        blocklyMediaPath={blocklyMediaPath}
      />
    );
  }
  return (
    <button
      type="button"
      className="btn btn-sm blockpy-run reader-run-button"
      onClick={() => {
        if (pre) pre.style.display = 'none';
        setLaunched(true);
      }}
    >
      <Play size={14} strokeWidth={1.75} aria-hidden style={{ verticalAlign: 'text-bottom' }} />{' '}
      Run
    </button>
  );
}
