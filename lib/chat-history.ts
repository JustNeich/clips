import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export type ChatEventRole = "user" | "assistant" | "system";

export type ChatEventType =
  | "link"
  | "download"
  | "comments"
  | "stage2"
  | "error"
  | "note";

export type ChatEvent = {
  id: string;
  role: ChatEventRole;
  type: ChatEventType;
  text: string;
  data?: unknown;
  createdAt: string;
};

export type ChatThread = {
  id: string;
  url: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  events: ChatEvent[];
};

type ChatStore = {
  threads: ChatThread[];
};

const DATA_DIR = path.join(process.cwd(), ".data");
const STORE_PATH = path.join(DATA_DIR, "chat-history.json");

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeUrl(raw: string): string {
  return raw.trim();
}

async function ensureStoreExists(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(STORE_PATH);
  } catch {
    const initial: ChatStore = { threads: [] };
    await fs.writeFile(STORE_PATH, JSON.stringify(initial, null, 2), "utf-8");
  }
}

async function readStore(): Promise<ChatStore> {
  await ensureStoreExists();
  const raw = await fs.readFile(STORE_PATH, "utf-8");
  const parsed = JSON.parse(raw) as Partial<ChatStore>;
  const allowedTypes = new Set<ChatEventType>([
    "link",
    "download",
    "comments",
    "stage2",
    "error",
    "note"
  ]);

  const sanitizedThreads = Array.isArray(parsed.threads)
    ? parsed.threads
        .map((thread) => {
          if (!thread || typeof thread !== "object") {
            return null;
          }
          const events = Array.isArray((thread as ChatThread).events)
            ? (thread as ChatThread).events.filter((event) => allowedTypes.has(event.type))
            : [];
          return {
            ...(thread as ChatThread),
            events
          };
        })
        .filter((thread): thread is ChatThread => Boolean(thread))
    : [];

  return {
    threads: sanitizedThreads
  };
}

async function writeStore(store: ChatStore): Promise<void> {
  await ensureStoreExists();
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
}

export async function listChats(): Promise<ChatThread[]> {
  const store = await readStore();
  return [...store.threads].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function getChatById(chatId: string): Promise<ChatThread | null> {
  const store = await readStore();
  return store.threads.find((thread) => thread.id === chatId) ?? null;
}

export async function createOrGetChatByUrl(rawUrl: string): Promise<ChatThread> {
  const url = normalizeUrl(rawUrl);
  const store = await readStore();
  const existing = store.threads.find((thread) => thread.url === url);
  if (existing) {
    return existing;
  }

  const createdAt = nowIso();
  const thread: ChatThread = {
    id: randomUUID().replace(/-/g, ""),
    url,
    title: url,
    createdAt,
    updatedAt: createdAt,
    events: [
      {
        id: randomUUID().replace(/-/g, ""),
        role: "user",
        type: "link",
        text: `Ссылка добавлена: ${url}`,
        createdAt
      }
    ]
  };

  store.threads.push(thread);
  await writeStore(store);
  return thread;
}

export async function appendChatEvent(
  chatId: string,
  event: Omit<ChatEvent, "id" | "createdAt">
): Promise<ChatThread> {
  const store = await readStore();
  const thread = store.threads.find((item) => item.id === chatId);
  if (!thread) {
    throw new Error("Chat not found.");
  }

  const createdAt = nowIso();
  thread.events.push({
    id: randomUUID().replace(/-/g, ""),
    createdAt,
    ...event
  });
  thread.updatedAt = createdAt;

  if (event.type === "stage2" || event.type === "comments") {
    thread.title =
      typeof event.data === "object" &&
      event.data &&
      "title" in (event.data as Record<string, unknown>) &&
      typeof (event.data as Record<string, unknown>).title === "string"
        ? String((event.data as Record<string, unknown>).title)
        : thread.title;
  }

  await writeStore(store);
  return thread;
}

export async function deleteChatById(chatId: string): Promise<boolean> {
  const store = await readStore();
  const prevLength = store.threads.length;
  store.threads = store.threads.filter((thread) => thread.id !== chatId);

  if (store.threads.length === prevLength) {
    return false;
  }

  await writeStore(store);
  return true;
}
