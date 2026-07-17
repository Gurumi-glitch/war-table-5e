import type { zhTW } from "./locales/zh-TW";

/**
 * The complete message contract, derived from the zh-TW baseline. Every locale
 * module declares `const xx: Messages = {...}` — a missing, extra, or
 * misspelled key anywhere in the tree fails `tsc`, so an incomplete
 * translation can never ship silently.
 */
export type Messages = typeof zhTW;
