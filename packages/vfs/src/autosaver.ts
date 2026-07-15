/**
 * Debounced autosave binding: VFS change events → legacy persistence
 * (spec §7.4, A1 §4d). Structurally typed against @blockpy/api's ApiClient
 * so the packages stay decoupled (the editor wires them together).
 *
 * Legacy semantics preserved: 1000 ms debounce per wire file (TIMER_DELAY,
 * server.js:43); `answer.py` additionally saves immediately on Run;
 * autosave gated by `display.autoSave` and blocked in read-only mode;
 * bundle members coalesce into one save of their `#` bundle. The response's
 * `version_change: true` surfaces as the stale-version callback (the
 * "your code is out of date / reload" banner, spec §7.4).
 */
import { persistencePlan } from './legacy-names';
import type { Vfs } from './vfs';

export interface FileSaver {
  saveFile(filename: string, code: string): Promise<{ [key: string]: unknown }>;
}

export interface AutosaverOptions {
  vfs: Vfs;
  api: FileSaver;
  /** display.autoSave - when false, nothing persists automatically. */
  autoSave?: () => boolean;
  /** display.readOnly - blocks all persistence (A1 §2). */
  readOnly?: () => boolean;
  /** Called when the server reports a version conflict on save. */
  onVersionChange?: (filename: string) => void;
  debounceMs?: number;
  /** Scheduler injection for tests. */
  schedule?: (fn: () => void, ms: number) => () => void;
}

const DEFAULT_DEBOUNCE_MS = 1000; // legacy TIMER_DELAY

export class Autosaver {
  private pending = new Map<string, () => void>(); // wireName -> cancel
  private schedule: (fn: () => void, ms: number) => () => void;
  private unsubscribe: () => void;

  constructor(private options: AutosaverOptions) {
    this.schedule =
      options.schedule ??
      ((fn, ms) => {
        const handle = setTimeout(fn, ms);
        return () => clearTimeout(handle);
      });
    this.unsubscribe = options.vfs.onChange((change) => this.onVfsChange(change.legacyName));
  }

  dispose(): void {
    this.unsubscribe();
    for (const cancel of this.pending.values()) cancel();
    this.pending.clear();
  }

  private gated(): boolean {
    return this.options.readOnly?.() === true || this.options.autoSave?.() === false;
  }

  private onVfsChange(legacyName: string): void {
    if (this.gated()) return;
    const plan = persistencePlan(legacyName);
    if (plan.kind !== 'saveFile' && plan.kind !== 'bundle') return; // manual/none channels
    const wireName = plan.wireName!;
    // coalesce: one timer per wire file (bundle members share their bundle's)
    this.pending.get(wireName)?.();
    const cancel = this.schedule(() => {
      this.pending.delete(wireName);
      void this.save(wireName);
    }, this.options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
    this.pending.set(wireName, cancel);
  }

  /** Immediate save of answer.py (legacy: fired on every Run, run.js:13). */
  saveAnswerNow(): Promise<void> {
    this.pending.get('answer.py')?.();
    this.pending.delete('answer.py');
    return this.save('answer.py');
  }

  private async save(wireName: string): Promise<void> {
    if (this.options.readOnly?.() === true) return;
    const contents = wireName.startsWith('#')
      ? this.options.vfs.encodeBundle(wireName as never)
      : this.options.vfs.read(wireName);
    if (contents === undefined) return;
    const response = await this.options.api.saveFile(wireName, contents);
    if (response['version_change'] === true) {
      this.options.onVersionChange?.(wireName);
      return;
    }
    if (response['success'] !== false && !wireName.startsWith('#')) {
      this.options.vfs.markClean(wireName);
    }
  }
}
