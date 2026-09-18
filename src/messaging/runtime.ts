import type { MessageType, RequestOf, ResponseOf, RuntimeMessage } from '@/types/messages';

/** Typed chrome.runtime messaging. */

export function sendMessage<T extends MessageType>(type: T, payload: RequestOf<T>): Promise<ResponseOf<T>> {
  return chrome.runtime.sendMessage({ type, payload } as RuntimeMessage);
}

export function sendTabMessage<T extends MessageType>(tabId: number, type: T, payload: RequestOf<T>): Promise<ResponseOf<T>> {
  return chrome.tabs.sendMessage(tabId, { type, payload } as RuntimeMessage);
}

export type MessageHandlers = {
  [T in MessageType]?: (payload: RequestOf<T>, sender: chrome.runtime.MessageSender) => Promise<ResponseOf<T>> | ResponseOf<T>;
};

export function listen(handlers: MessageHandlers): void {
  chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
    const handler = message && (handlers[message.type] as ((p: unknown, s: chrome.runtime.MessageSender) => unknown) | undefined);
    if (!handler) return false;
    Promise.resolve()
      .then(() => handler(message.payload, sender))
      .then(sendResponse, (err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    return true; // async response
  });
}

/** True when running inside an extension context whose runtime is still valid. */
export const extensionAlive = () => {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
};
