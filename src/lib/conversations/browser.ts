import { createIndexedDbByteStore } from "./indexedDb";
import { createConversationRepository, createLocalStorageByteStore, createMemoryByteStore } from "./repository";
import type { ConversationRepository } from "./model";

export type OpenedConversationRepository = {
  repo: ConversationRepository;
  durable: boolean;
};

export async function openConversationRepository(): Promise<OpenedConversationRepository> {
  if (typeof indexedDB !== "undefined") {
    try {
      const repo = createConversationRepository(createIndexedDbByteStore());
      await repo.getActiveId();
      return { repo, durable: true };
    } catch {
      // IndexedDB can be blocked; localStorage is the fallback.
    }
  }
  if (typeof localStorage !== "undefined") {
    try {
      const probe = "geg.storage.probe";
      localStorage.setItem(probe, "1");
      localStorage.removeItem(probe);
      const repo = createConversationRepository(createLocalStorageByteStore(localStorage));
      await repo.getActiveId();
      return { repo, durable: true };
    } catch {
      // Quota or a locked storage area. The page can still chat in memory.
    }
  }
  return { repo: createConversationRepository(createMemoryByteStore()), durable: false };
}
