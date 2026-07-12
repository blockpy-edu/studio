/**
 * Loading screen (spec §13) — the editor.html:20-23 notice shown until the
 * app mounts, removed by `$('.delete-on-load').remove()` (editor.html:383).
 * Host pages (unmodified templates) ship their own span; app-owned pages
 * can render `loadingNoticeHtml` into the shell before mounting.
 */

/** The verbatim notice text (editor.html:21). */
export const LOADING_NOTICE_TEXT =
  "Loading! Please wait. If this doesn't load, and you are using Safari, then please stop using Safari!";

/** The notice markup: Safari warning + optional retry link to the legacy
 *  load_assignment URL (editor.html:20-23). */
export function loadingNoticeHtml(retryUrl?: string): string {
  const link = retryUrl
    ? ` <a target="_blank" href="${retryUrl}">Click here to try again</a>.`
    : '';
  return `<span class='delete-on-load'>${LOADING_NOTICE_TEXT}${link}</span>`;
}

/** `$('.delete-on-load').remove()` — fired when the app mounts. */
export function removeLoadingScreen(doc: Document = document): void {
  doc.querySelectorAll('.delete-on-load').forEach((element) => element.remove());
}
