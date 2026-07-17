/* TTS in-game tablet fix: Backspace doesn't delete text.
 *
 * The TTS embedded Chromium host swallows the Backspace key's default
 * editing action — the keydown fires (typing, arrows, etc. all work) but the
 * browser never performs the actual deletion, so the char stays and React's
 * controlled inputs never receive an updated value. We listen for Backspace
 * ourselves, perform the deletion manually, and dispatch a synthetic "input"
 * event so React's onChange fires with the new value.
 *
 * Why we always preventDefault + redo it: on a modern browser this reproduces
 * the native action exactly (same value, same caret), so it's a no-op-equivalent
 * there and only meaningfully changes behavior on the broken TTS host.
 *
 * Coverage = anywhere you can type: text inputs, textareas, AND number/date
 * inputs (HP, AC, ability scores…). Two paths:
 *  - text inputs + textareas expose selectionStart, so we slice the value
 *    ourselves and dispatch "input" (predictable, no deprecated APIs).
 *  - number/date/etc. return null for selectionStart (Chrome doesn't expose
 *    the caret there) and have no queryable Selection either, so
 *    document.execCommand("delete") is a silent no-op on them — instead we
 *    treat these fields as end-typed and manually delete the last char,
 *    same manual-slice-plus-dispatch approach as the text path.
 *
 * We bail on modifier chords (Ctrl+Backspace = delete word), active IME
 * composition, and readonly/disabled fields — our manual path can't model those.
 *
 * MUST be imported in main.tsx (after polyfills) so the listener is armed
 * before any input is mounted. */
const EDITABLE_INPUT_TYPES = new Set([
  "text",
  "search",
  "url",
  "tel",
  "password",
  "email",
  "number",
  "date",
  "datetime-local",
  "month",
  "time",
  "week",
  "",
]);

function isEditableTextTarget(el: EventTarget | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!(el instanceof HTMLElement)) return false;
  if ((el as HTMLInputElement).readOnly || (el as HTMLInputElement).disabled) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return EDITABLE_INPUT_TYPES.has(el.type);
  return false;
}

/**
 * Set a controlled input/textarea's value bypassing React's value tracker,
 * so a subsequently-dispatched "input" event is picked up by React's onChange.
 * (React's tracked setter would no-op a programmatic change to a controlled
 * field; the native prototype setter actually mutates the DOM.)
 */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, next: string): void {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, next);
  else (el as HTMLInputElement).value = next;
}

function handleBackspace(el: HTMLInputElement | HTMLTextAreaElement): void {
  const start = el.selectionStart;
  const end = el.selectionEnd;
  // number/date/etc. don't expose the caret (selectionStart is null in Chrome)
  // and have no queryable Selection for execCommand to act on either, so we
  // treat these as end-typed fields and delete the last character manually.
  if (start === null || end === null) {
    const value = el.value;
    if (value.length > 0) {
      setNativeValue(el, value.slice(0, -1));
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    return;
  }

  const value = el.value;
  let next: string;
  let caret: number;
  if (start !== end) {
    // Delete the selected range.
    next = value.slice(0, start) + value.slice(end);
    caret = start;
  } else if (start > 0) {
    // Delete the char before the caret.
    next = value.slice(0, start - 1) + value.slice(start);
    caret = start - 1;
  } else {
    // Nothing to delete (caret at start).
    return;
  }

  setNativeValue(el, next);
  el.setSelectionRange(caret, caret);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

let installed = false;

export function installTtsBackspaceFix(): void {
  if (typeof document === "undefined" || installed) return;
  installed = true;

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Backspace") return;
      // Let the browser handle modifier chord shortcuts (Ctrl+Backspace = delete
      // word, etc.) and active IME composition — our manual path can't model them.
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if ((e as KeyboardEvent).isComposing || e.keyCode === 229) return;

      const el = e.target;
      if (!isEditableTextTarget(el)) return;

      // We're handling it: stop the host's (broken or default) action and do it
      // ourselves so the result is identical on every browser.
      e.preventDefault();
      handleBackspace(el);
    },
    // Capture so we run before any React/SyntheticEvent consumer can reformat
    // or swallow the key — the deletion must land before their handlers run.
    true,
  );
}
