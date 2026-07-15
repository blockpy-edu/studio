/**
 * LTI frame resize (spec §13) - port of the editor.html:350-380 "intelligent
 * resizing" snippet: post `{subject: "lti.frameResize", height: bodyHeight
 * + 50}` (JSON-STRINGIFIED, matching the legacy postMessage) to
 * `window.parent` with origin `'*'` (tightening the origin is a §17 opt-in),
 * once at install and again via a ResizeObserver on `document.body`
 * debounced 500 ms.
 *
 * Legacy gates this on `{% if embed %}` in editor.html - but note
 * textbook.html:213 gates it on `{% if not embed %}` (inverted; harmless
 * unframed since parent === self). The caller owns the gating.
 */
export const FRAME_RESIZE_DEBOUNCE = 500;
export const FRAME_RESIZE_PADDING = 50;

export interface FrameResizeMessage {
  subject: 'lti.frameResize';
  height: number;
}

/** jQuery `$("body").height()` - the computed content-box height. */
const bodyHeight = (win: Window): number => {
  const body = win.document.body;
  const computed = Number.parseFloat(win.getComputedStyle(body).height);
  return Number.isFinite(computed) ? computed : body.getBoundingClientRect().height;
};

/**
 * Install the resize loop. Returns a disposer (legacy never disconnects;
 * the disposer exists for React lifecycles). The whole install is wrapped
 * in the legacy try/catch → console.error (editor.html:358-379).
 */
export function installFrameResize(win: Window = window): () => void {
  const fixCanvasSize = () => {
    win.parent.postMessage(
      JSON.stringify({
        subject: 'lti.frameResize',
        height: bodyHeight(win) + FRAME_RESIZE_PADDING,
      } satisfies FrameResizeMessage),
      '*',
    );
  };
  try {
    fixCanvasSize();
    let resizeId: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === win.document.body) {
          clearTimeout(resizeId);
          resizeId = setTimeout(fixCanvasSize, FRAME_RESIZE_DEBOUNCE);
        }
      }
    });
    observer.observe(win.document.body);
    return () => {
      clearTimeout(resizeId);
      observer.disconnect();
    };
  } catch (error) {
    console.error(error);
    return () => undefined;
  }
}
