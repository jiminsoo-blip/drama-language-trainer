// File System Access API handles persisted in IndexedDB, so a recent session
// can reopen the actual files with one click + browser permission prompt.

const DB_NAME = 'cdt-handles'
const STORE = 'handles'

export interface StoredHandles {
  video?: FileSystemFileHandle
  subs?: FileSystemFileHandle
  trans?: FileSystemFileHandle
  pdf?: FileSystemFileHandle
}

export function hasFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && 'showOpenFilePicker' in window
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveHandles(id: string, handles: StoredHandles): Promise<void> {
  if (Object.keys(handles).length === 0) return
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(handles, id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    // IDB unavailable (private mode etc.) — resume falls back to re-pick
  }
}

export async function loadHandles(id: string): Promise<StoredHandles | null> {
  try {
    const db = await openDb()
    const result = await new Promise<StoredHandles | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(id)
      req.onsuccess = () => resolve((req.result as StoredHandles) ?? null)
      req.onerror = () => reject(req.error)
    })
    db.close()
    return result
  } catch {
    return null
  }
}

interface PermissionCapableHandle {
  queryPermission(opts: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission(opts: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
}

/** request read permission for a handle (must be called from a user gesture) */
export async function ensureReadPermission(handle: FileSystemFileHandle): Promise<boolean> {
  try {
    const h = handle as unknown as PermissionCapableHandle
    if (typeof h.queryPermission !== 'function') return true // assume usable
    const opts = { mode: 'read' } as const
    if ((await h.queryPermission(opts)) === 'granted') return true
    return (await h.requestPermission(opts)) === 'granted'
  } catch {
    return false
  }
}
