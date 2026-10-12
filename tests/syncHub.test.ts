import { describe, expect, it } from "vitest";

import {
  PluginSyncHub,
  SYNC_HUB_FALLBACK_GRACE_MS,
  type SyncHubSession,
  type SyncHubTicketAnswer,
} from "../src/syncHub";

/** A manual clock: the hub gets its timers and time from here. */
class Clock {
  now = 1_760_000_000_000;
  private nextId = 1;
  private timers = new Map<number, { at: number; run: () => void }>();
  set = (run: () => void, ms: number): number => {
    const id = this.nextId++;
    this.timers.set(id, { at: this.now + ms, run });
    return id;
  };
  clear = (id: number): void => {
    this.timers.delete(id);
  };
  /** Runs every timer due within `ms`, in order, letting promises settle. */
  async advance(ms: number): Promise<void> {
    const end = this.now + ms;
    await settle();
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.now = due[1].at;
      due[1].run();
      await settle();
    }
    this.now = end;
  }
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn++) await Promise.resolve();
}

const OWNER = "10000000-0000-4000-8000-000000000001";
const DEVICE = "20000000-0000-4000-8000-000000000002";
const EPOCH = "30000000-0000-4000-8000-000000000003";
const OTHER_EPOCH = "40000000-0000-4000-8000-000000000004";
const TICKET = `t1.${OWNER}.${"a".repeat(64)}`;

class FakeSocket {
  sent: string[] = [];
  closed = false;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  constructor(readonly url: string) {}
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }
  open(): void {
    this.onopen?.({} as Event);
  }
  receive(value: unknown): void {
    this.onmessage?.({
      data: typeof value === "string" ? value : JSON.stringify(value),
    } as MessageEvent);
  }
  serverClose(code: number): void {
    this.onclose?.({ code } as CloseEvent);
  }
}

function harness(
  options: {
    session?: SyncHubSession | null;
    ticket?: SyncHubTicketAnswer;
  } = {},
) {
  const clock = new Clock();
  const sockets: FakeSocket[] = [];
  const lanes: Array<{ lanes: string[]; full: boolean }> = [];
  const tokens: string[] = [];
  const state = {
    session:
      options.session === undefined
        ? { accessToken: "token-a", expiresAt: clock.now + 3_600_000, userId: OWNER }
        : options.session,
    ticket: options.ticket ?? { status: 200, ticket: TICKET },
  };
  const hub = new PluginSyncHub({
    getSession: async () => state.session,
    requestTicket: async (accessToken) => {
      tokens.push(accessToken);
      return state.ticket;
    },
    openSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    getDeviceId: () => DEVICE,
    appVersion: "plugin-1.7.0",
    onLanes: (changed, full) => lanes.push({ lanes: changed, full }),
    random: () => 0.5,
    now: () => clock.now,
    setTimer: clock.set,
    clearTimer: clock.clear,
  });
  return { hub, sockets, lanes, tokens, state, clock };
}

async function connect(h: ReturnType<typeof harness>): Promise<FakeSocket> {
  h.hub.start();
  await h.clock.advance(0);
  const socket = h.sockets.at(-1)!;
  socket.open();
  return socket;
}

function heads(socket: FakeSocket, epoch = EPOCH, changed: string[] = []) {
  socket.receive({
    t: "heads",
    epoch,
    heads: { obsidian: "3", obsidian_operations: "1", tasks: "9" },
    changed,
  });
}

describe("plugin sync hub", () => {
  it("buys a ticket with the token in a header, never puts the token in the URL", async () => {
    const h = harness();
    const socket = await connect(h);
    expect(h.tokens).toEqual(["token-a"]);
    const url = new URL(socket.url);
    expect(url.origin).toBe("wss://sync.dainvo.com");
    expect(url.pathname).toBe("/v1/connect");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      ticket: TICKET,
      device: DEVICE,
      kind: "obsidian",
      app: "plugin-1.7.0",
    });
    expect(socket.url).not.toContain("token-a");
    expect(JSON.parse(socket.sent[0])).toEqual({ t: "hello", epoch: null });
    h.hub.stop();
  });

  it("delivers after hello; first contact asks for one full read", async () => {
    const h = harness();
    const socket = await connect(h);
    expect(h.hub.isDelivering()).toBe(false);
    heads(socket);
    expect(h.hub.isDelivering()).toBe(true);
    expect(h.lanes).toEqual([{ lanes: [], full: true }]);
    socket.receive({ t: "changed", epoch: EPOCH, lanes: { obsidian_operations: "2" } });
    expect(h.lanes.at(-1)).toEqual({ lanes: ["obsidian_operations"], full: false });
    h.hub.stop();
  });

  it("a reconnect in the same epoch reports only changed Obsidian lanes", async () => {
    const h = harness();
    const first = await connect(h);
    heads(first);
    first.serverClose(1006);
    await h.clock.advance(1_000);
    const second = h.sockets.at(-1)!;
    expect(second).not.toBe(first);
    second.open();
    expect(JSON.parse(second.sent[0])).toEqual({
      t: "hello",
      epoch: EPOCH,
      known: { obsidian: "3", obsidian_operations: "1" },
    });
    heads(second, EPOCH, ["obsidian_operations", "tasks"]);
    expect(h.lanes.at(-1)).toEqual({ lanes: ["obsidian_operations"], full: false });
    // A new hub epoch reads everything once.
    second.receive({ t: "changed", epoch: OTHER_EPOCH, lanes: { obsidian: "1" } });
    expect(h.lanes.at(-1)).toEqual({ lanes: [], full: true });
    h.hub.stop();
  });

  it("keeps delivering for the grace period while reconnecting, then falls back", async () => {
    const h = harness();
    const socket = await connect(h);
    heads(socket);
    h.state.ticket = { status: 503 };
    socket.serverClose(1006);
    expect(h.hub.isDelivering()).toBe(true);
    await h.clock.advance(SYNC_HUB_FALLBACK_GRACE_MS);
    expect(h.hub.isDelivering()).toBe(false);
    h.hub.stop();
  });

  it("drops a socket whose heartbeat goes unanswered", async () => {
    const h = harness();
    const socket = await connect(h);
    heads(socket);
    await h.clock.advance(30_000);
    expect(socket.sent.at(-1)).toBe('{"t":"ping"}');
    socket.receive('{"t":"pong"}');
    await h.clock.advance(30_000);
    await h.clock.advance(10_000);
    expect(socket.closed).toBe(true);
    h.hub.stop();
  });

  it("sends a fresh token before the old one expires", async () => {
    const h = harness();
    // Expires in 3 minutes: the refresh is due at 1 minute (2 minutes early).
    h.state.session = { accessToken: "token-a", expiresAt: h.clock.now + 3 * 60_000, userId: OWNER };
    const socket = await connect(h);
    heads(socket);
    h.state.session = { accessToken: "token-b", expiresAt: h.clock.now + 70 * 60_000, userId: OWNER };
    for (let beat = 0; beat < 2; beat++) {
      await h.clock.advance(30_000);
      socket.receive('{"t":"pong"}');
    }
    expect(socket.sent.map((line) => JSON.parse(line) as { t: string; accessToken?: string }))
      .toContainEqual({ t: "token", accessToken: "token-b" });
    h.hub.stop();
  });

  it("waits by close code and ticket answer", async () => {
    const h = harness();
    const socket = await connect(h);
    heads(socket);
    socket.serverClose(4403);
    await h.clock.advance(4 * 60_000);
    expect(h.sockets).toHaveLength(1);
    await h.clock.advance(60_000);
    expect(h.sockets).toHaveLength(2);
    h.hub.stop();

    const limited = harness({ ticket: { status: 429, retryAfterSeconds: 120 } });
    limited.hub.start();
    await limited.clock.advance(0);
    expect(limited.tokens).toHaveLength(1);
    await limited.clock.advance(119_000);
    expect(limited.tokens).toHaveLength(1);
    await limited.clock.advance(1_000);
    expect(limited.tokens).toHaveLength(2);
    limited.hub.stop();
  });

  it("does nothing while signed out, and stop() closes and forgets", async () => {
    const h = harness({ session: null });
    h.hub.start();
    await h.clock.advance(0);
    expect(h.tokens).toHaveLength(0);
    expect(h.sockets).toHaveLength(0);
    h.state.session = { accessToken: "token-a", expiresAt: h.clock.now + 3_600_000, userId: OWNER };
    await h.clock.advance(2_000);
    const socket = h.sockets.at(-1)!;
    socket.open();
    heads(socket);
    h.hub.stop();
    expect(socket.closed).toBe(true);
    expect(h.hub.isDelivering()).toBe(false);
    await connect(h);
    expect(JSON.parse(h.sockets.at(-1)!.sent[0])).toEqual({ t: "hello", epoch: null });
    h.hub.stop();
  });

  it("ignores malformed or foreign messages", async () => {
    const h = harness();
    const socket = await connect(h);
    heads(socket);
    const before = h.lanes.length;
    socket.receive("not json");
    socket.receive({ t: "changed", epoch: "nope", lanes: { obsidian: "2" } });
    socket.receive({ t: "changed", epoch: EPOCH, lanes: { obsidian: "x" } });
    socket.receive({ t: "changed", epoch: EPOCH, lanes: { tasks: "5" } });
    socket.receive({ t: "relay", client: "claude" });
    expect(h.lanes).toHaveLength(before);
    h.hub.stop();
  });
});
