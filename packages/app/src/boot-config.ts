/**
 * BootConfig - the typed union of everything the server's editor.html
 * currently injects (spec §5.2). This is the single contract between the
 * server's bootstrap page and the React app.
 */

/**
 * Exactly the keys of window.$blockPyUrls (spec §14.2). Tightened to a
 * literal-key interface in Milestone 1.2, once the golden transcripts (A5)
 * confirm the inventory.
 */
export type LegacyUrlMap = Record<string, string>;

/**
 * Raw loadAssignment / inline assignment_data payload. Parsed through the
 * versioned decoder (Milestone 1.2, spec §14.5), which must round-trip
 * unknown fields losslessly.
 */
export type LegacyAssignmentPayload = Record<string, unknown>;

/** Replaces the Jinja-rendered assignment-group header data (spec §9.2). */
export interface GroupBootData {
  assignments: Array<{
    id: number;
    name: string;
    /** Legacy URL_MAP[id]; full-page navigation fallback (spec §9.3). */
    url: string;
    subordinate: boolean;
    hidden: boolean;
    /** From the paired submission. */
    correct: boolean;
  }>;
  /** OR of hidden - masks all statuses in the group (spec §3, §9.1). */
  anySecretive: boolean;
  currentAssignmentId: number;
}

/**
 * Replaces the QUIZZES/READINGS/TEXTBOOKS/JAVAS/KETTLES/EXPLAINS/BLOCKPYS
 * globals; membership drives assignment-type dispatch (spec §5.3).
 */
export interface AssignmentTypeIndex {
  quiz: number[];
  reading: number[];
  textbook: number[];
  java: number[];
  typescript: number[];
  explain: number[];
  blockpy: number[];
}

export interface BootConfig {
  urls: LegacyUrlMap;
  user: {
    id: number | null;
    name?: string;
    role: string;
    courseId: number | null;
  };
  /** window.accessToken passthrough. */
  accessToken?: string;
  assignment: {
    currentAssignmentId: number | null;
    assignmentGroupId: number | null;
    /** For the legacy editor.loadAssignmentData_ path. */
    assignmentData?: LegacyAssignmentPayload;
    /**
     * Standalone textbook route (M4.7): the raw `<path>` segment of
     * `/blockpy/assignments/textbook/<path>?page=…` - resolved client-side
     * by url THEN numeric id (the load_textbook contract). Used only when
     * `currentAssignmentId` is null; the flagged server template supplies
     * it instead of resolving the assignment itself.
     */
    textbookPath?: string;
    typeIndex: AssignmentTypeIndex;
  };
  group?: GroupBootData;
  display: {
    instructor: boolean;
    readOnly: boolean;
    embed: boolean;
    /**
     * Studio-only, default false: show the dev-shell chrome - the
     * "Dev harness - …" header line (with the minified-editor swap button)
     * and, in the dev/demo entry, the assignment-group picker bar. Real
     * applications mounting the app omit this and get no harness chrome;
     * only the harness page (packages/app/index.html) turns it on.
     */
    devHarness?: boolean;
  };
  passcodeProtected: boolean;
  /** Epoch ms; drives the "time spent" clock (spec §9.4). */
  sessionStartTime: number | null;
  paths: {
    blocklyMedia: string;
    emojiProxy: string;
    pyodideIndexURL: string;
    /**
     * Where the deployed server hosts the build's `assets/` directory
     * (the engine's module worker, `worker.entry.js`, lives there under a
     * stable name). Optional: unset keeps the build-time URL baked into
     * the bundle. Same-origin only - module workers cannot be
     * instantiated cross-origin.
     */
    assets?: string;
  };
  /**
   * `settings-*` query params, prefix stripped (spec §15.2). Values are RAW
   * STRINGS, not parsed JSON: the legacy Jinja loop passes each query value
   * through verbatim and the client coerces per key (e.g. `"" + v === "true"`).
   * Parsing them as JSON here would change behavior - see
   * docs/appendices/A4-settings-inventory.md.
   */
  settings: Record<string, string>;
  /** urls.importDatasets (spec §10.4). */
  corgisUrl: string;
}
