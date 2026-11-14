import type { Me } from "./api";

// What a person may do is a list of permission keys sent by the server (see apps/tenancy/rolekeys.py on the backend).
// The server is the real enforcement; these checks only decide which screens, tabs and buttons to show.

/** True when the person holds ANY of the given permissions. */
export function can(me: Pick<Me, "permissions"> | null | undefined, ...keys: string[]): boolean {
  const have = me?.permissions;
  if (!have) return false;
  return keys.some((k) => have.includes(k));
}

/** The Settings tabs, each shown only to people who may use it. */
export const SETTINGS_KEYS = ["set.locations", "set.catalogue", "set.pos", "set.ai", "set.roles", "set.account"] as const;

/** Anything inside Settings at all (a person with none of these never sees the Settings button). */
export function canOpenSettings(me: Pick<Me, "permissions"> | null | undefined): boolean {
  return can(me, ...SETTINGS_KEYS);
}
