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
  /**
   * A save request threw (network/transport failure) or the server answered
   * `success: false`. The file stays dirty; without this hook the failure is
   * only logged to the console.
   */
  onSaveError?: (filename: string, error: unknown) => void;
  debounceMs?: number;
  /** Scheduler injection for tests. */
  schedule?: (fn: () => void, ms: number) => () => void;
}

const DEFAULT_DEBOUNCE_MS = 1000; // legacy TIMER_DELAY

export class Autosaver {
  private pending = new Map<string, () => void>(); // wireName -> cancel
  /** Per-wire-file save chain: requests for one file never overlap, so a
   *  slow earlier POST cannot land after (and be mistaken for) a newer one. */
  private chains = new Map<string, Promise<void>>();
  /** Bumped on every VFS change of a wire file; a save only marks clean if
   *  no write happened after it read the payload. */
  private writeGenerations = new Map<string, number>();
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

  /**
   * Run every pending debounced save now (edits in the last debounce window
   * must not be lost on teardown / navigation). Resolves once the flushed
   * saves have settled; failures go through onSaveError as usual.
   */
  flush(): Promise<void> {
    const wireNames = Array.from(this.pending.keys());
    for (const cancel of this.pending.values()) cancel();
    this.pending.clear();
    return Promise.all(wireNames.map((wireName) => this.enqueue(wireName))).then(() => undefined);
  }

  dispose(): void {
    this.unsubscribe();
    void this.flush();
  }

  private gated(): boolean {
    return this.options.readOnly?.() === true || this.options.autoSave?.() === false;
  }

  private onVfsChange(legacyName: string): void {
    if (this.gated()) return;
    const plan = persistencePlan(legacyName);
    if (plan.kind !== 'saveFile' && plan.kind !== 'bundle') return; // manual/none channels
    const wireName = plan.wireName!;
    this.writeGenerations.set(wireName, (this.writeGenerations.get(wireName) ?? 0) + 1);
    // coalesce: one timer per wire file (bundle members share their bundle's)
    this.pending.get(wireName)?.();
    const cancel = this.schedule(() => {
      this.pending.delete(wireName);
      void this.enqueue(wireName);
    }, this.options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
    this.pending.set(wireName, cancel);
  }

  /** Immediate save of answer.py (legacy: fired on every Run, run.js:13). */
  saveAnswerNow(): Promise<void> {
    this.pending.get('answer.py')?.();
    this.pending.delete('answer.py');
    return this.enqueue('answer.py');
  }

  /** Serialize saves per wire file; errors are reported, never thrown. */
  private enqueue(wireName: string): Promise<void> {
    const previous = this.chains.get(wireName) ?? Promise.resolve();
    const next = previous
      .then(() => this.save(wireName))
      .catch((error: unknown) => this.reportError(wireName, error));
    this.chains.set(wireName, next);
    return next;
  }

  private reportError(wireName: string, error: unknown): void {
    if (this.options.onSaveError) this.options.onSaveError(wireName, error);
    else console.error(`[autosave] failed to save ${wireName}`, error);
  }

  private async save(wireName: string): Promise<void> {
    if (this.options.readOnly?.() === true) return;
    const vfs = this.options.vfs;
    const isBundle = wireName.startsWith('#');
    let contents: string | undefined;
    if (isBundle) {
      contents = vfs.encodeBundle(wireName as never);
    } else {
      contents = vfs.read(wireName);
      // A DELETED individually-persisted file (`!on_change.py` /
      // `!on_eval.py`, the only deletable magic names) is dirty with no
      // contents. The server has no delete endpoint - the assignment
      // column simply holds the text (Assignment.save_file) - and legacy
      // pushed the emptied observable through the same saveFile watch, so
      // persisting the deletion means saving an empty string.
      if (contents === undefined && vfs.isDirty(wireName)) contents = '';
    }
    if (contents === undefined) return;
    const generation = this.writeGenerations.get(wireName) ?? 0;
    const response = await this.options.api.saveFile(wireName, contents);
    if (response['version_change'] === true) {
      this.options.onVersionChange?.(wireName);
      return;
    }
    if (response['success'] === false) {
      // A well-formed refusal: the file stays dirty - surface it like a
      // transport failure instead of failing silently.
      throw new Error(
        typeof response['message'] === 'string'
          ? response['message']
          : `server rejected the save of ${wireName}`,
      );
    }
    // A newer write landed while this request was in flight: its own save
    // is queued behind us and owns the clean flag.
    if ((this.writeGenerations.get(wireName) ?? 0) !== generation) return;
    if (isBundle) {
      // Every member (including deleted ones, dirty by name) rode along.
      for (const legacyName of vfs.dirty()) {
        if (vfs.bundleFor(legacyName) === wireName) vfs.markClean(legacyName);
      }
    } else {
      vfs.markClean(wireName);
    }
  }
}
