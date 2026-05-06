export const safeGetJSON = (key: string) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  } catch (err) {
    // localStorage access can throw in some privacy modes
    console.warn('safeGetJSON error', err);
    return null;
  }
};

const clearCandidateLargeKeys = () => {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      // heuristics: snapshots, progress, large caches
      if (k.includes('snapshot') || k.includes('snapshots') || k.includes('siteforge') || k.includes('progress')) {
        keysToRemove.push(k);
      }
    }
    // remove oldest-ish keys first (best-effort)
    keysToRemove.slice(0, Math.min(keysToRemove.length, 5)).forEach(k => localStorage.removeItem(k));
    return keysToRemove.length > 0;
  } catch (e) {
    return false;
  }
};

export const safeSetJSON = (key: string, value: any): boolean => {
  try {
    const raw = JSON.stringify(value);
    try {
      localStorage.setItem(key, raw);
      return true;
    } catch (err: any) {
      // quota exceeded or other storage errors
      if (err && (err.name === 'QuotaExceededError' || err.code === 22 || err.code === 1014)) {
        // attempt to free space by removing candidate large keys
        const cleared = clearCandidateLargeKeys();
        if (cleared) {
          try { localStorage.setItem(key, raw); return true; } catch { /* fallthrough */ }
        }
        // if value is array or object with snapshots, try trimming
        try {
          if (Array.isArray(value)) {
            const trimmed = value.slice(0, Math.max(1, Math.floor(value.length / 2)));
            localStorage.setItem(key, JSON.stringify(trimmed));
            return true;
          }
          if (value && typeof value === 'object') {
            // shallow trim large arrays inside
            const copy: any = { ...value };
            for (const k of Object.keys(copy)) {
              if (Array.isArray(copy[k])) copy[k] = copy[k].slice(0, Math.max(1, Math.floor(copy[k].length / 2)));
            }
            localStorage.setItem(key, JSON.stringify(copy));
            return true;
          }
        } catch (e) {
          // ignore
        }
      }
      // other errors fallthrough
      console.warn('safeSetJSON failed', err);
      return false;
    }
  } catch (e) {
    console.warn('safeSetJSON stringify failed', e);
    return false;
  }
};

export const safeRemove = (key: string) => {
  try { localStorage.removeItem(key); } catch { }
};
