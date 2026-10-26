import type { Comparison, Lang, PublicUnderstanding, ToolTrace, UiMessage } from "./types";

export type SessionSnapshot = {
  sessionId: string;
  lang: Lang;
  messages: UiMessage[];
  understanding: PublicUnderstanding | null;
  confirmed: boolean;
  folderCount: number;
  comparison: Comparison | null;
  demoMode: boolean;
  provider: string;
  model: string;
};

export type ChatEvent =
  | { type: "progress"; text: string }
  | { type: "tool"; tool: ToolTrace }
  | {
      type: "context";
      understanding: PublicUnderstanding | null;
      confirmed: boolean;
      folderCount: number;
      comparison: Comparison | null;
    }
  | { type: "error"; message: string }
  | { type: "done"; session: SessionSnapshot };

export async function consumeChatEvents(
  response: Response,
  onEvent: (event: ChatEvent) => void,
): Promise<void> {
  const emit = (chunk: string) => {
    for (const line of chunk.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      onEvent(JSON.parse(trimmed) as ChatEvent);
    }
  };
  if (!response.body) {
    emit(await response.text());
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    if (lines.length > 0) emit(`${lines.join("\n")}\n`);
  }
  buffer += decoder.decode();
  if (buffer.trim()) emit(buffer);
}

export async function readChatEvents(response: Response): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  await consumeChatEvents(response, (event) => events.push(event));
  return events;
}
