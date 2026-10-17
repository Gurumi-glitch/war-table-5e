import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement the Pointer Events capture methods our drag/resize
// handlers call unconditionally (ShellWindow, ResizableWindow,
// CharacterCardWindow, MapBoard) — stub them as no-ops so pointer-event tests
// can render those components without a TypeError.
if (!HTMLElement.prototype.setPointerCapture) {
  HTMLElement.prototype.setPointerCapture = () => {};
}
if (!HTMLElement.prototype.releasePointerCapture) {
  HTMLElement.prototype.releasePointerCapture = () => {};
}
if (!HTMLElement.prototype.hasPointerCapture) {
  HTMLElement.prototype.hasPointerCapture = () => false;
}

// jsdom has no matchMedia; motion code reads prefers-reduced-motion.
if (typeof window.matchMedia === "undefined") {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    } as unknown as MediaQueryList);
}

// jsdom has no scrollIntoView; TurnRibbon scrolls the current turn pill.
if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = () => {};
}

// jsdom also has no PointerEvent constructor at all (jsdom/jsdom#2527), so
// Testing Library's fireEvent.pointerDown/Move/Up/Cancel silently fall back
// to a bare `Event` that drops clientX/clientY/pointerId. Polyfill it as a
// MouseEvent subclass (same trick as jsdom-testing-mocks) so drag-position
// math is actually exercisable in tests.
if (typeof window.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    public pointerId: number;
    public pointerType: string;
    public isPrimary: boolean;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
      this.pointerType = params.pointerType ?? "mouse";
      this.isPrimary = params.isPrimary ?? true;
    }
  }
  window.PointerEvent =
    PointerEventPolyfill as unknown as typeof window.PointerEvent;
}
