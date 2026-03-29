"use client";

export const MANAGED_TEMPLATE_SYNC_EVENT = "clips:managed-template-sync";
export const MANAGED_TEMPLATE_SYNC_STORAGE_KEY = "clips:managed-template-sync:v1";

export type ManagedTemplateSyncMessage = {
  templateId: string;
  updatedAt: string;
  reason: "saved" | "created" | "versioned" | "restored" | "deleted";
  nonce: string;
};

function isManagedTemplateSyncMessage(value: unknown): value is ManagedTemplateSyncMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ManagedTemplateSyncMessage).templateId === "string" &&
    typeof (value as ManagedTemplateSyncMessage).updatedAt === "string" &&
    typeof (value as ManagedTemplateSyncMessage).reason === "string" &&
    typeof (value as ManagedTemplateSyncMessage).nonce === "string"
  );
}

function parseManagedTemplateSyncMessage(raw: string | null): ManagedTemplateSyncMessage | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isManagedTemplateSyncMessage(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function publishManagedTemplateSync(input: Omit<ManagedTemplateSyncMessage, "nonce">): void {
  if (typeof window === "undefined") {
    return;
  }

  const payload: ManagedTemplateSyncMessage = {
    ...input,
    nonce: `${input.templateId}:${input.updatedAt}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
  };

  window.dispatchEvent(new CustomEvent<ManagedTemplateSyncMessage>(MANAGED_TEMPLATE_SYNC_EVENT, {
    detail: payload
  }));

  try {
    window.localStorage.setItem(MANAGED_TEMPLATE_SYNC_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage failures; same-tab CustomEvent still works.
  }
}

export function subscribeManagedTemplateSync(
  listener: (message: ManagedTemplateSyncMessage) => void
): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handleCustomEvent = (event: Event) => {
    if (!(event instanceof CustomEvent) || !isManagedTemplateSyncMessage(event.detail)) {
      return;
    }
    listener(event.detail);
  };

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== MANAGED_TEMPLATE_SYNC_STORAGE_KEY) {
      return;
    }
    const payload = parseManagedTemplateSyncMessage(event.newValue);
    if (payload) {
      listener(payload);
    }
  };

  window.addEventListener(MANAGED_TEMPLATE_SYNC_EVENT, handleCustomEvent as EventListener);
  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener(MANAGED_TEMPLATE_SYNC_EVENT, handleCustomEvent as EventListener);
    window.removeEventListener("storage", handleStorage);
  };
}
