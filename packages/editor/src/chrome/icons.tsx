/**
 * Toolbar/chrome icons — Lucide replacements for the legacy Font Awesome 5
 * glyphs (B6 allows icon modernization with per-glyph rationale; A8 §3.2 is
 * the legacy inventory). Each mapping is semantically equivalent:
 *
 *   fa-play          → Play           (identical glyph)
 *   (Stop state)     → Square         (universal stop glyph; legacy kept
 *                                      fa-play while running — showing a stop
 *                                      square during "Stop" is clearer)
 *   fa-th-large      → LayoutGrid     (2×2 grid = blocks)
 *   fa-columns       → Columns2       (identical glyph)
 *   fa-align-left    → AlignLeft      (identical glyph)
 *   fa-sync          → RefreshCw      (identical glyph)
 *   fa-cloud-download-alt → CloudDownload (identical glyph)
 *   fa-file-upload   → Upload         (arrow-up-from-tray equivalent)
 *   fa-download      → Download       (identical glyph)
 *   fa-history       → History        (identical glyph)
 *   fa-save          → Save           (identical glyph)
 *   fa-trash         → Trash2         (identical glyph)
 *   fa-ellipsis-v    → EllipsisVertical (identical glyph)
 *   fa-eye           → Eye            (identical glyph)
 *   fa-comment-slash → MessageSquareOff (identical semantics)
 *   fa-expand-arrows-alt → Expand     (arrows-out fullscreen glyph)
 *   fa-compress-arrows-alt → Shrink   (arrows-in exit-fullscreen glyph)
 *   fa-list-alt      → ClipboardList  (boxed list = queued inputs)
 *   fa-images        → Images         (identical glyph)
 *   fa-link          → Link           (identical glyph)
 *   fa-bug           → Bug            (identical glyph)
 *   fa-backward      → Rewind         (identical glyph, history previous)
 *   fa-forward       → FastForward    (identical glyph, history next)
 *   fa-file-import   → FileInput      (identical semantics, history "Use")
 *   fa-thumbs-up/-down → ThumbsUp/ThumbsDown (identical glyphs, feedback
 *                       rating; legacy's rated state swapped solid→regular —
 *                       Lucide has no solid pair, so rated dims instead)
 *   fa-minus-square/fa-plus-square → SquareMinus/SquarePlus (identical
 *                       glyphs, rating region collapse/expand)
 *
 * Size is fixed at 14 with the legacy 12px optical weight preserved via
 * 1.75 stroke — A8 §3.2 calls the 12px sizing layout-relevant.
 */
import type { ComponentType } from 'react';
import {
  AlignLeft,
  Bug,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  CloudDownload,
  Columns2,
  Download,
  EllipsisVertical,
  Expand,
  Eye,
  FastForward,
  FileInput,
  History,
  Images,
  LayoutGrid,
  Link,
  Rewind,
  MessageSquareOff,
  Play,
  RefreshCw,
  Save,
  Shrink,
  SkipBack,
  SkipForward,
  Square,
  SquareMinus,
  SquarePlus,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Upload,
  type LucideProps,
} from 'lucide-react';

const ICONS = {
  run: Play,
  stop: Square,
  blocks: LayoutGrid,
  split: Columns2,
  text: AlignLeft,
  reset: RefreshCw,
  datasets: CloudDownload,
  upload: Upload,
  download: Download,
  history: History,
  save: Save,
  delete: Trash2,
  extra: EllipsisVertical,
  eye: Eye,
  runQuietly: MessageSquareOff,
  // Trace/history stepping (legacy fa-step-backward/-backward/-forward/
  // -step-forward → SkipBack/ChevronLeft/ChevronRight/SkipForward).
  stepFirst: SkipBack,
  stepBack: ChevronLeft,
  stepForward: ChevronRight,
  stepLast: SkipForward,
  // Quick menu (A8 §3.2 legacy inventory).
  fullscreen: Expand,
  fullscreenExit: Shrink,
  inputs: ClipboardList,
  images: Images,
  share: Link,
  bug: Bug,
  // History toolbar (history.js HISTORY_TOOLBAR_HTML).
  historyPrev: Rewind,
  historyNext: FastForward,
  historyUse: FileInput,
  // Feedback rating region (feedback.js:46-74).
  thumbsUp: ThumbsUp,
  thumbsDown: ThumbsDown,
  rateCollapse: SquareMinus,
  rateExpand: SquarePlus,
} satisfies Record<string, ComponentType<LucideProps>>;

export type IconName = keyof typeof ICONS;

export function Icon({ name }: { name: IconName }) {
  const Component = ICONS[name];
  return (
    <Component
      size={14}
      strokeWidth={1.75}
      aria-hidden="true"
      style={{ verticalAlign: 'text-bottom', marginRight: '2px' }}
    />
  );
}
