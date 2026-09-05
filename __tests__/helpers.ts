// Shared fake Plugin.Context harness for controller tests.
import type { Plugin } from "@opencode-ai/plugin";

export interface FakeAssistantMessage {
  type: "assistant";
  id: string;
  agent: string;
  time: { created: number };
  content: Array<{ type: "text"; text: string }>;
  tokens?: {
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
  };
}

export function assistantMessage(options: {
  text: string;
  created?: number;
  output?: number;
  input?: number;
}): FakeAssistantMessage {
  return {
    type: "assistant",
    id: `msg-${Math.random().toString(36).slice(2)}`,
    agent: "pi",
    time: { created: options.created ?? Date.now() + 60_000 },
    content: [{ type: "text", text: options.text }],
    tokens: {
      input: options.input ?? 10,
      output: options.output ?? 100,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  };
}

interface EventQueue {
  push(event: unknown): void;
  subscribe(options?: { signal?: AbortSignal }): AsyncIterable<unknown>;
}

function createEventQueue(): EventQueue {
  const waiting: Array<(event: unknown) => void> = [];
  const buffer: unknown[] = [];
  return {
    push(event: unknown) {
      const waiter = waiting.shift();
      if (waiter) waiter(event);
      else buffer.push(event);
    },
    subscribe(options?: { signal?: AbortSignal }) {
      const signal = options?.signal;
      return {
        [Symbol.asyncIterator]() {
          return {
            async next(): Promise<IteratorResult<unknown>> {
              if (signal?.aborted) return { value: undefined, done: true };
              if (buffer.length > 0) return { value: buffer.shift(), done: false };
              const value = await new Promise<unknown | typeof DONE>((resolve) => {
                waiting.push(resolve);
                signal?.addEventListener("abort", () => resolve(DONE), { once: true });
              });
              if (value === DONE || signal?.aborted) return { value: undefined, done: true };
              return { value, done: false };
            },
          };
        },
      };
    },
  };
}

const DONE = Symbol("queue-done");

export interface CommandDef {
  name: string;
  description?: string;
  execute: (input: {
    sessionID: string;
    prompt: { text: string };
    delivery: string;
  }) => Promise<void>;
}

export interface ToolDef {
  name: string;
  description: string;
  input: unknown;
  execute: (input: unknown, context: { sessionID: string }) => Promise<{ content?: string }>;
}

export function createFakeContext(options: { agent?: string; directory?: string } = {}) {
  const storageMap = new Map<string, unknown>();
  const syntheticCalls: Array<{ sessionID: string; text: string; description?: string }> = [];
  const interruptCalls: Array<{ sessionID: string; continue?: boolean }> = [];
  const switchAgentCalls: Array<{ sessionID: string; agent: string }> = [];
  const notices: Array<Record<string, unknown>> = [];
  const cards: Array<Record<string, unknown>> = [];
  const commands: CommandDef[] = [];
  const tools: ToolDef[] = [];
  const contextHooks: Array<(input: unknown) => void | Promise<void>> = [];
  const permissionHooks: Array<(input: unknown) => void | Promise<void>> = [];
  let contextMessages: unknown[] = [];
  let rpcHandlers: { status: (input: unknown, context: unknown) => Promise<unknown> } | undefined;
  const queue = createEventQueue();

  const registration = { dispose: async () => {} };

  const ctx = {
    location: { directory: options.directory ?? "/tmp" },
    command: {
      transform: async (cb: (editor: { add: (d: CommandDef) => void }) => void) => {
        cb({ add: (definition) => commands.push(definition) });
        return registration;
      },
    },
    tool: {
      transform: async (cb: (editor: { add: (d: ToolDef) => void }) => void) => {
        cb({ add: (definition) => tools.push(definition) });
        return registration;
      },
    },
    session: {
      get: async (input: { sessionID: string }) => ({
        id: input.sessionID,
        projectID: "p1",
        agent: options.agent ?? "pi",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: Date.now(), updated: Date.now() },
        location: { directory: options.directory ?? "/tmp" },
      }),
      switchAgent: async (input: { sessionID: string; agent: string }) => {
        switchAgentCalls.push(input);
      },
      synthetic: async (input: { sessionID: string; text: string; description?: string }) => {
        syntheticCalls.push(input);
        return { id: "inbox-1" };
      },
      interrupt: async (input: { sessionID: string; continue?: boolean }) => {
        interruptCalls.push(input);
        return {};
      },
      context: async () => contextMessages,
      hook: async (name: string, cb: (input: unknown) => void | Promise<void>) => {
        if (name === "context") contextHooks.push(cb);
        return registration;
      },
    },
    permission: {
      hook: async (name: string, cb: (input: unknown) => void | Promise<void>) => {
        if (name === "evaluate") permissionHooks.push(cb);
        return registration;
      },
    },
    event: {
      subscribe: (options?: { signal?: AbortSignal }) => queue.subscribe(options),
    },
    storage: {
      get: async (key: string) => storageMap.get(key),
      set: async (key: string, value: unknown) => {
        storageMap.set(key, value);
      },
      remove: async (key: string) => {
        storageMap.delete(key);
      },
      scan: async ({ prefix }: { prefix: string }) => ({
        entries: [...storageMap.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, value]) => ({ key, value })),
      }),
    },
    rpc: {
      register: async (
        _definition: unknown,
        handlers: { status: (input: unknown, context: unknown) => Promise<unknown> },
      ) => {
        rpcHandlers = handlers;
        return {
          dispose: async () => {},
          events: {
            emit: async (name: string, data: Record<string, unknown>) => {
              (name === "notice" ? notices : cards).push(data);
            },
          },
        };
      },
    },
  };

  return {
    // The controller only uses the domains stubbed above.
    ctx: ctx as unknown as Plugin.Context,
    storageMap,
    syntheticCalls,
    interruptCalls,
    switchAgentCalls,
    notices,
    cards,
    commands,
    tools,
    contextHooks,
    permissionHooks,
    pushEvent: (event: unknown) => queue.push(event),
    setContextMessages: (messages: unknown[]) => {
      contextMessages = messages;
    },
    status: async (sessionID: string) => {
      if (!rpcHandlers) throw new Error("rpc not registered");
      return (await rpcHandlers.status({ sessionID }, {})) as { text: string; active: boolean };
    },
  };
}

export type FakeContext = ReturnType<typeof createFakeContext>;

/** Flushes pending microtasks/macrotasks so the event loop settles. */
export async function settle(rounds = 8): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

export function executionSucceeded(sessionID: string, created = Date.now() + 120_000) {
  return {
    id: "evt",
    created,
    type: "session.execution.succeeded",
    durable: { aggregateID: sessionID, seq: 1, version: 1 },
    data: { sessionID },
  };
}

export function executionFailed(
  sessionID: string,
  message: string,
  created = Date.now() + 120_000,
) {
  return {
    id: "evt",
    created,
    type: "session.execution.failed",
    durable: { aggregateID: sessionID, seq: 1, version: 1 },
    data: { sessionID, error: { type: "unknown", message } },
  };
}

export function executionInterrupted(
  sessionID: string,
  reason: "user" | "shutdown" | "superseded",
  created = Date.now() + 120_000,
) {
  return {
    id: "evt",
    created,
    type: "session.execution.interrupted",
    durable: { aggregateID: sessionID, seq: 1, version: 1 },
    data: { sessionID, reason },
  };
}
