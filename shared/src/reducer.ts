import { z } from "zod";
import { SessionStatus, ThreadEvent, type SequencedEvent } from "./events";
import { ThreadItem } from "./items";

export const ThreadState = z.object({
  items: z.array(ThreadItem),
  status: SessionStatus,
  activeTurnId: z.string().nullable(),
  lastSeq: z.number().int().nonnegative(),
});
export type ThreadState = z.infer<typeof ThreadState>;

export const emptyThread: ThreadState = {
  items: [],
  status: "idle",
  activeTurnId: null,
  lastSeq: 0,
};

export function applyEvent(state: ThreadState, { seq, event }: SequencedEvent): ThreadState {
  if (seq <= state.lastSeq) return state;
  return { ...reduce(state, event), lastSeq: seq };
}

function reduce(state: ThreadState, event: ThreadEvent): ThreadState {
  switch (event.type) {
    case "turn.started":
      return { ...state, activeTurnId: event.turnId, status: "running" };
    case "turn.completed":
    case "turn.failed":
      return { ...state, activeTurnId: null, status: "idle" };
    case "item.started":
      return { ...state, items: [...state.items, event.item] };
    case "item.delta":
      return updateItem(state, event.itemId, appendDelta(event.delta));
    case "item.completed":
      return updateItem(state, event.itemId, (item) =>
        ThreadItem.parse({ ...item, ...event.patch }),
      );
    case "session.status":
      return { ...state, status: event.status };
  }
}

function appendDelta(delta: string) {
  return (item: ThreadItem): ThreadItem => {
    switch (item.kind) {
      case "assistant_message":
      case "reasoning":
      case "plan":
        return { ...item, text: item.text + delta };
      case "tool_call":
        return { ...item, output: item.output + delta };
      default:
        return item;
    }
  };
}

function updateItem(
  state: ThreadState,
  itemId: string,
  update: (item: ThreadItem) => ThreadItem,
): ThreadState {
  const index = state.items.findIndex((item) => item.id === itemId);
  if (index === -1) return state;
  const items = [...state.items];
  items[index] = update(items[index]!);
  return { ...state, items };
}
