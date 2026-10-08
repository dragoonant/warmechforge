// Browser storage behind one tiny adapter. localStorage can be missing (node tests), blocked (private windows) or
// throw on access, so every read and write goes through here and falls back to an in-memory map.

export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  keys(): string[]
}

export function memoryStorage(): KeyValueStorage {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => { m.set(k, v) },
    removeItem: (k) => { m.delete(k) },
    keys: () => [...m.keys()],
  }
}

function browserStorage(): KeyValueStorage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage
    if (!ls) return null
    const probe = '__wmf_probe__'
    ls.setItem(probe, '1')
    ls.removeItem(probe)
    return {
      getItem: (k) => { try { return ls.getItem(k) } catch { return null } },
      setItem: (k, v) => { try { ls.setItem(k, v) } catch { /* quota or blocked: drop */ } },
      removeItem: (k) => { try { ls.removeItem(k) } catch { /* ignore */ } },
      keys: () => {
        try {
          const out: string[] = []
          for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k !== null) out.push(k) }
          return out
        } catch { return [] }
      },
    }
  } catch {
    return null
  }
}

let current: KeyValueStorage | null = null

/** The storage every client store uses (localStorage when it works, memory otherwise). */
export function getStorage(): KeyValueStorage {
  current ??= browserStorage() ?? memoryStorage()
  return current
}

/** Tests: swap the storage (pass null to go back to auto-detect). */
export function setStorage(s: KeyValueStorage | null): void { current = s }

export function readJson<T>(key: string): T | null {
  const raw = getStorage().getItem(key)
  if (raw === null) return null
  try { return JSON.parse(raw) as T } catch { return null }
}

export function writeJson(key: string, value: unknown): void {
  try { getStorage().setItem(key, JSON.stringify(value)) } catch { /* unserialisable: drop */ }
}
