/* ------------------------------ env helpers ------------------------------- */

export const reqEnv = (name: string): string => {
  const v = process.env[name];
  if (!v || !String(v).trim())
    throw new Error(`[shared:s2s] Missing env ${name}`);
  return String(v).trim();
};

export const numEnv = (name: string, def: number): number => {
  const raw = process.env[name];
  const n = raw ? Number(raw) : def;
  return Number.isFinite(n) ? n : def;
};
