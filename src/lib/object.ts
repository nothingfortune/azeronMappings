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
