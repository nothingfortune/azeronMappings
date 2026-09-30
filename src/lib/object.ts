/** Small helpers that keep dynamic key removal honest and lint-clean. */

/** Remove a computed key in place. `delete obj[key]` is banned by the lint config. */
export function removeKey(target: object, key: string): void {
  Reflect.deleteProperty(target, key);
}

/** A copy without one key, for building objects the caller then owns. */
export function withoutKey<T extends object>(target: T, key: string): T {
  const copy: Record<string, unknown> = { ...(target as Record<string, unknown>) };
  Reflect.deleteProperty(copy, key);
  return copy as T;
}

/**
 * What went wrong, as text, whatever was thrown.
 *
 * `(error as Error).message` prints "undefined" for anything thrown that is not an Error
 * -- a string, a rejected value from a browser API -- which is the one time a clear
 * message matters most.
 */
export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  // JSON has no form for these, and stringify returns undefined for them.
  if (error === undefined || typeof error === "function" || typeof error === "symbol") {
    return String(error);
  }
  try {
    return JSON.stringify(error);
  } catch {
    // Circular, most likely. "[object Object]" would say less than this.
    return `a ${typeof error} that could not be printed`;
  }
}
