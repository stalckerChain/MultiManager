const DEFAULT_PAGE_SIZE = 50;
const PAGE_SIZES = ['10', '20', '50', '100'];

export function createPageSizeStore(key, options = {}) {
  const allowed = options.allowed || PAGE_SIZES;
  const fallback = options.fallback ?? DEFAULT_PAGE_SIZE;

  function get() {
    try {
      const value = localStorage.getItem(key);
      if (allowed.includes(String(value))) return Number(value);
    } catch {
      // ignore: localStorage may be unavailable or corrupted
    }
    return fallback;
  }

  function set(value) {
    try {
      localStorage.setItem(key, String(value));
    } catch {
      // ignore: write errors must not break the table or local state
    }
  }

  return { get, set };
}
