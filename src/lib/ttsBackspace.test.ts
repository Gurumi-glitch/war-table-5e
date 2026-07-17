import { test, expect, beforeEach, vi, afterEach, type Mock } from "vitest";
import { installTtsBackspaceFix } from "./ttsBackspace";
type ExecCommand = (command: string) => boolean;

/** The TTS in-game tablet's embedded Chromium swallows Backspace's default
 *  deletion action — the keydown fires but no char is removed and React's
 *  controlled inputs never get an updated value. jsdom likewise performs no
 *  default text deletion on keydown, so it models the broken host faithfully:
 *  without the fix, Backspace does nothing; with it, the char is removed and an
 *  "input" event fires so React's onChange sees the new value.
 *
 *  Number/date inputs expose no caret (selectionStart is null), so they take a
 *  separate manual-delete-last-char path instead of the text path's caret-aware
 *  slice — execCommand("delete") is a no-op on these input types in real
 *  Chromium (no queryable Selection), so it's not used at all; the execMock
 *  below only exists to prove that. */

let onChangeCalls: string[];
let execMock: Mock<ExecCommand>;
let originalExecCommand: ExecCommand | undefined;

function mountInput(
  doc: Document,
  attrs: Record<string, string> = {},
): HTMLInputElement {
  const input = doc.createElement("input");
  for (const [k, v] of Object.entries(attrs)) input.setAttribute(k, v);
  doc.body.appendChild(input);
  return input;
}

function pressBackspace(el: HTMLElement, opts: { ctrlKey?: boolean } = {}): void {
  el.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Backspace",
      bubbles: true,
      cancelable: true,
      ctrlKey: opts.ctrlKey ?? false,
    }),
  );
}

beforeEach(() => {
  onChangeCalls = [];
  // jsdom doesn't implement execCommand — install a mock so tests can assert
  // it's never called (the number/date path deletes manually, not via this).
  originalExecCommand = (document as unknown as { execCommand?: ExecCommand })
    .execCommand;
  execMock = vi.fn<ExecCommand>().mockReturnValue(true);
  (document as unknown as { execCommand: ExecCommand }).execCommand = execMock;
  // Idempotent: safe to call every test (the fix guards against double-install).
  installTtsBackspaceFix();
});

afterEach(() => {
  if (originalExecCommand === undefined) {
    delete (document as unknown as { execCommand?: ExecCommand }).execCommand;
  } else {
    (document as unknown as { execCommand: ExecCommand }).execCommand =
      originalExecCommand;
  }
});

test("Backspace deletes the char before the caret and fires input (text path)", () => {
  const input = mountInput(document, { value: "goblin" });
  input.value = "goblin";
  input.setSelectionRange(6, 6); // caret after "n"
  input.addEventListener("input", () => onChangeCalls.push(input.value));

  pressBackspace(input);

  expect(input.value).toBe("gobli");
  expect(onChangeCalls).toEqual(["gobli"]);
  // Text inputs use the manual slice path, not execCommand.
  expect(execMock).not.toHaveBeenCalled();
});

test("Backspace deletes the selected range", () => {
  const input = mountInput(document);
  input.value = "goblin";
  input.setSelectionRange(1, 4); // select "obl"
  input.addEventListener("input", () => onChangeCalls.push(input.value));

  pressBackspace(input);

  expect(input.value).toBe("gin");
  expect(onChangeCalls).toEqual(["gin"]);
});

test("Backspace at start of field is a no-op (no input event)", () => {
  const input = mountInput(document);
  input.value = "goblin";
  input.setSelectionRange(0, 0);
  input.addEventListener("input", () => onChangeCalls.push(input.value));

  pressBackspace(input);

  expect(input.value).toBe("goblin");
  expect(onChangeCalls).toEqual([]);
  expect(execMock).not.toHaveBeenCalled();
});

test("Ctrl+Backspace is left to the browser (not handled)", () => {
  const input = mountInput(document);
  input.value = "goblin";
  input.setSelectionRange(6, 6);
  let defaultNotPrevented = true;
  input.addEventListener(
    "keydown",
    (e) => {
      if (e.defaultPrevented) defaultNotPrevented = false;
    },
    true,
  );

  pressBackspace(input, { ctrlKey: true });

  // Our handler bails on modifier chords, so it must NOT have preventDefault'd.
  expect(defaultNotPrevented).toBe(true);
  expect(input.value).toBe("goblin");
  expect(execMock).not.toHaveBeenCalled();
});

test("readonly inputs are ignored", () => {
  const ro = mountInput(document, { value: "goblin" });
  (ro as HTMLInputElement).readOnly = true;
  ro.value = "goblin";
  ro.setSelectionRange(6, 6);
  pressBackspace(ro);
  expect(ro.value).toBe("goblin");
  expect(execMock).not.toHaveBeenCalled();
});

test("number inputs delete the last char and fire input (no caret exposed)", () => {
  const num = mountInput(document, { type: "number", value: "42" });
  num.value = "42";
  // jsdom returns null for selectionStart on type=number, as real Chrome does.
  expect(num.selectionStart).toBeNull();
  num.addEventListener("input", () => onChangeCalls.push(num.value));

  pressBackspace(num);

  expect(num.value).toBe("4");
  expect(onChangeCalls).toEqual(["4"]);
  // execCommand("delete") is a no-op on number/date inputs in real Chromium
  // (no queryable selection), so the fallback must not rely on it.
  expect(execMock).not.toHaveBeenCalled();
});

test("number input backspace on an empty value is a no-op (no input event)", () => {
  const num = mountInput(document, { type: "number", value: "" });
  num.value = "";
  num.addEventListener("input", () => onChangeCalls.push(num.value));

  pressBackspace(num);

  expect(num.value).toBe("");
  expect(onChangeCalls).toEqual([]);
});
