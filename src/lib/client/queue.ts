export type QueuedPhoto = {
  id: string;
  display: Blob;
  thumb: Blob;
  width: number;
  height: number;
  name: string;
  createdAt: number;
  attempts: number;
};

const DB_NAME = 'fotobag';
const STORE = 'queue';
const memory = new Map<string, QueuedPhoto>();
let opening: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (opening) return opening;

  opening = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);

    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });

  return opening;
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(STORE, mode);
      const request = run(transaction.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function putQueued(photo: QueuedPhoto): Promise<void> {
  memory.set(photo.id, photo);
  await withStore('readwrite', (store) => store.put(photo));
}

export async function getQueued(id: string): Promise<QueuedPhoto | null> {
  if (memory.has(id)) return memory.get(id) ?? null;
  const result = await withStore<QueuedPhoto | undefined>('readonly', (store) => store.get(id));
  return result ?? null;
}

export async function allQueued(): Promise<QueuedPhoto[]> {
  const result = await withStore<QueuedPhoto[]>('readonly', (store) => store.getAll());
  return result ?? [...memory.values()];
}

export async function removeQueued(id: string): Promise<void> {
  memory.delete(id);
  await withStore('readwrite', (store) => store.delete(id));
}

export async function markAttempt(id: string): Promise<void> {
  const photo = await getQueued(id);
  if (!photo) return;
  await putQueued({ ...photo, attempts: photo.attempts + 1 });
}
