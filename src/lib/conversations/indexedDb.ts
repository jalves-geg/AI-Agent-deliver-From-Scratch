import type { ByteStore } from "./repository";

const DB_NAME = "geg-conversations";
const DB_VERSION = 1;
const STORE = "kv";

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onerror = () => reject(request.error ?? new Error("Could not open conversation storage"));
    request.onsuccess = () => resolve(request.result);
  });
}

function database(): Promise<IDBDatabase> {
  if (!databasePromise) {
    databasePromise = openDatabase().catch((error: unknown) => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}

function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return database().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = fn(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Conversation storage request failed"));
        tx.onerror = () => reject(tx.error ?? new Error("Conversation storage transaction failed"));
      }),
  );
}

export function createIndexedDbByteStore(): ByteStore {
  return {
    async get(key) {
      const value = await withStore("readonly", (store) => store.get(key));
      return typeof value === "string" ? value : null;
    },
    async set(key, value) {
      await withStore("readwrite", (store) => store.put(value, key));
    },
    async remove(key) {
      await withStore("readwrite", (store) => store.delete(key));
    },
    async keys() {
      const keys = await withStore("readonly", (store) => store.getAllKeys());
      return keys.map((key) => String(key));
    },
  };
}
