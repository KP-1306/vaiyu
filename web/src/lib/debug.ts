// web/src/lib/debug.ts
// Simple FE logging helper. Turn on/off via VITE_DEBUG_LOGS.

const DEBUG = import.meta.env.VITE_DEBUG_LOGS === "true";

export function dbg(tag: string, data?: unknown) {
  if (!DEBUG) return;
  console.log(`[VAiyu_FE] ${tag}`, data ?? "");
}

export function dbgError(tag: string, error: unknown, extra?: unknown) {
  if (!DEBUG) return;
  console.error(`[VAiyu_FE_ERROR] ${tag}`, { error, extra });
}
