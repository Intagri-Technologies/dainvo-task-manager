/**
 * Dainvo sync hub (sync.dainvo.com) for the plugin's mobile-relay publisher.
 *
 * The hub tells this plugin when a phone queued a task edit
 * (`obsidian_operations`) or when the vault's relay data changed
 * (`obsidian`), so the cloud sync turn runs on those hints instead of every
 * 30 seconds. Hints carry lane names only; Supabase stays the source of
 * truth. A browser WebSocket cannot send an `Authorization` header and a token
 * must never go in a URL, so the plugin first exchanges its OAuth access
 * token (in the header) for a one-time, 30-second connect ticket.
 */
export const SYNC_HUB_ORIGIN = "https://sync.dainvo.com";
export const SYNC_HUB_PROTOCOL = "dainvo-sync.v1";
/** While the hub delivers hints, the timer only runs this often. */
export const SYNC_HUB_BACKSTOP_MS = 6 * 60 * 60_000;
/** A hub that was healthy this recently still counts (reconnects). */
export const SYNC_HUB_FALLBACK_GRACE_MS = 2 * 60_000;
const HEARTBEAT_MS = 30_000;
const PONG_TIMEOUT_MS = 10_000;
const HELLO_TIMEOUT_MS = 15_000;
const TOKEN_REFRESH_LEAD_MS = 2 * 60_000;
const HEARTBEAT = '{"t":"ping"}';
const OBSIDIAN_LANES = new Set(["obsidian", "obsidian_operations"]);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SEQUENCE = /^(0|[1-9][0-9]{0,18})$/u;

export type SyncHubSession = {
  accessToken: string;
  /** Milliseconds since the epoch. */
  expiresAt: number;
  userId: string;
};

/** The parts of a browser WebSocket the hub client uses. */
export type SyncHubSocket = Pick<
  WebSocket,
  "send" | "close" | "onopen" | "onmessage" | "onclose" | "onerror"
>;

export type SyncHubTicketAnswer = {
  status: number;
  ticket?: string;
  retryAfterSeconds?: number;
};

export type SyncHubDeps = {
  getSession(): Promise<SyncHubSession | null>;
  requestTicket(accessToken: string): Promise<SyncHubTicketAnswer>;
  openSocket(url: string): SyncHubSocket;
  getDeviceId(): string;
  appVersion: string;
  /** Lanes that changed; `full` means everything must be read once. */
  onLanes(lanes: string[], full: boolean): void;
  now?: () => number;
  random?: () => number;
  setTimer?: (callback: () => void, ms: number) => number;
  clearTimer?: (id: number) => void;
};

export class PluginSyncHub {
  private running = false;
  private generation = 0;
  private socket: SyncHubSocket | null = null;
  private helloAnswered = false;
  private epoch: string | null = null;
  private known: Record<string, string> = {};
  private owner: string | null = null;
  private attempts = 0;
  private lastHealthyAt: number | null = null;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private pongTimer: number | null = null;
  private helloTimer: number | null = null;
  private tokenTimer: number | null = null;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly setTimer: (callback: () => void, ms: number) => number;
  private readonly clearTimer: (id: number) => void;

  constructor(private readonly deps: SyncHubDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.random = deps.random ?? (() => Math.random());
    this.setTimer =
      deps.setTimer ?? ((callback, ms) => window.setTimeout(callback, ms));
    this.clearTimer = deps.clearTimer ?? ((id) => window.clearTimeout(id));
  }

  /** Connects (or keeps the connection). Safe to call repeatedly. */
  start(): void {
    if (this.running) {
      if (!this.socket && this.reconnectTimer === null) this.schedule(0);
      return;
    }
    this.running = true;
    this.schedule(0);
  }

  /** Sign-out, sync turned off or unload: close and forget what was seen. */
  stop(): void {
    this.running = false;
    this.generation += 1;
    this.clear("reconnectTimer");
    this.drop();
    this.lastHealthyAt = null;
    this.attempts = 0;
    this.epoch = null;
    this.known = {};
    this.owner = null;
  }

  /** True while hints arrive (or arrived moments ago). */
  isDelivering(): boolean {
    if (this.socket && this.helloAnswered) return true;
    return (
      this.lastHealthyAt !== null &&
      this.now() - this.lastHealthyAt < SYNC_HUB_FALLBACK_GRACE_MS
    );
  }

  private schedule(delayMs: number): void {
    this.clear("reconnectTimer");
    this.reconnectTimer = this.setTimer(() => {
      this.reconnectTimer = null;
      void this.open();
    }, delayMs);
  }

  private async open(): Promise<void> {
    const generation = ++this.generation;
    if (!this.running) return;
    let session: SyncHubSession | null;
    try {
      session = await this.deps.getSession();
    } catch {
      session = null;
    }
    if (!this.running || generation !== this.generation) return;
    if (!session) return this.retry(this.backoff());
    if (this.owner !== session.userId) {
      // Another account: what the hub said about the previous one is void.
      this.owner = session.userId;
      this.epoch = null;
      this.known = {};
    }
    let answer: SyncHubTicketAnswer;
    try {
      answer = await this.deps.requestTicket(session.accessToken);
    } catch {
      answer = { status: 0 };
    }
    if (!this.running || generation !== this.generation) return;
    if (answer.status !== 200 || !answer.ticket) {
      return this.retry(this.ticketDelay(answer));
    }
    let deviceId: string;
    try {
      deviceId = this.deps.getDeviceId();
    } catch {
      return this.retry(this.backoff());
    }
    if (!UUID.test(deviceId)) return this.retry(SYNC_HUB_BACKSTOP_MS);
    const url = new URL("/v1/connect", SYNC_HUB_ORIGIN.replace(/^https:/u, "wss:"));
    url.searchParams.set("ticket", answer.ticket);
    url.searchParams.set("device", deviceId.toLowerCase());
    url.searchParams.set("kind", "obsidian");
    url.searchParams.set("app", this.deps.appVersion.slice(0, 40));
    let socket: SyncHubSocket;
    try {
      socket = this.deps.openSocket(url.toString());
    } catch {
      return this.retry(this.backoff());
    }
    this.socket = socket;
    this.helloAnswered = false;
    socket.onopen = () => {
      if (socket !== this.socket) return;
      this.send({
        t: "hello",
        epoch: this.epoch,
        ...(this.epoch ? { known: this.known } : {}),
      });
    };
    socket.onmessage = (event: MessageEvent) => this.onMessage(socket, event.data);
    socket.onclose = (event: CloseEvent) => this.gone(socket, event.code);
    socket.onerror = () => undefined;
    this.helloTimer = this.setTimer(() => {
      this.helloTimer = null;
      if (socket === this.socket && !this.helloAnswered) this.gone(socket, 0);
    }, HELLO_TIMEOUT_MS);
    this.scheduleTokenRefresh(session.expiresAt);
  }

  private onMessage(socket: SyncHubSocket, data: unknown): void {
    if (socket !== this.socket || typeof data !== "string" || data.length > 65_536) {
      return;
    }
    if (data === '{"t":"pong"}') {
      this.clear("pongTimer");
      return;
    }
    let message: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(data);
      if (!parsed || typeof parsed !== "object") return;
      message = parsed as Record<string, unknown>;
    } catch {
      return;
    }
    if (message.t === "heads") {
      const epoch = readEpoch(message.epoch);
      const heads = readHeads(message.heads);
      if (!epoch || !heads || !Array.isArray(message.changed)) return;
      const full = this.epoch !== epoch;
      this.epoch = epoch;
      this.known = heads;
      this.helloAnswered = true;
      this.attempts = 0;
      this.lastHealthyAt = this.now();
      this.clear("helloTimer");
      this.startHeartbeat();
      const changed = message.changed.filter(
        (lane): lane is string => typeof lane === "string" && OBSIDIAN_LANES.has(lane),
      );
      if (full) this.deps.onLanes([], true);
      else if (changed.length) this.deps.onLanes(changed, false);
      return;
    }
    if (message.t === "changed") {
      const epoch = readEpoch(message.epoch);
      const lanes = readHeads(message.lanes);
      if (!epoch || !lanes) return;
      this.lastHealthyAt = this.now();
      if (epoch !== this.epoch) {
        this.epoch = epoch;
        this.known = lanes;
        this.deps.onLanes([], true);
        return;
      }
      this.known = { ...this.known, ...lanes };
      const names = Object.keys(lanes);
      if (names.length) this.deps.onLanes(names, false);
    }
    // token_ok, ack and anything newer: nothing to do.
  }

  private startHeartbeat(): void {
    this.clear("heartbeatTimer");
    const beat = () => {
      this.heartbeatTimer = this.setTimer(() => {
        const socket = this.socket;
        if (!socket || !this.helloAnswered) return;
        this.send(HEARTBEAT, true);
        this.lastHealthyAt = this.now();
        this.clear("pongTimer");
        this.pongTimer = this.setTimer(() => {
          this.pongTimer = null;
          if (socket === this.socket) this.gone(socket, 0);
        }, PONG_TIMEOUT_MS);
        beat();
      }, HEARTBEAT_MS);
    };
    beat();
  }

  /** The hub needs a fresh token before this one expires (close 4401). */
  private scheduleTokenRefresh(expiresAt: number): void {
    this.clear("tokenTimer");
    const wait = Math.max(30_000, expiresAt - this.now() - TOKEN_REFRESH_LEAD_MS);
    this.tokenTimer = this.setTimer(() => {
      this.tokenTimer = null;
      void this.refreshToken();
    }, wait);
  }

  private async refreshToken(): Promise<void> {
    const socket = this.socket;
    if (!socket) return;
    let session: SyncHubSession | null;
    try {
      session = await this.deps.getSession();
    } catch {
      session = null;
    }
    if (socket !== this.socket) return;
    if (!session || session.userId !== this.owner) {
      this.gone(socket, 4403);
      return;
    }
    this.send({ t: "token", accessToken: session.accessToken });
    this.scheduleTokenRefresh(session.expiresAt);
  }

  private gone(socket: SyncHubSocket, code: number): void {
    if (socket !== this.socket) return;
    this.drop();
    if (!this.running) return;
    this.retry(this.closeDelay(code));
  }

  private retry(delayMs: number): void {
    if (this.running) this.schedule(delayMs);
  }

  private closeDelay(code: number): number {
    switch (code) {
      case 4401: // Token expired or refused: the next ticket uses a fresh one.
        this.attempts = 0;
        return 1_000;
      case 4403: // Removed session or another account.
        return 5 * 60_000;
      case 1008: // Over the message budget.
        return 60_000;
      case 1001:
      case 1012: // Going away (deploys).
        this.attempts = 0;
        return Math.round(this.random() * 30_000);
      default:
        return this.backoff();
    }
  }

  private ticketDelay(answer: SyncHubTicketAnswer): number {
    if (answer.status === 429 && answer.retryAfterSeconds) {
      return Math.min(answer.retryAfterSeconds, 600) * 1000;
    }
    // Tickets switched off at the hub: try again much later.
    if (answer.status === 404) return SYNC_HUB_BACKSTOP_MS;
    if (answer.status === 401 || answer.status === 403) return 5 * 60_000;
    return this.backoff();
  }

  /** Full jitter, capped at 60 s; 2.5 to 5 minutes after repeated failures. */
  private backoff(): number {
    const attempt = this.attempts++;
    if (attempt >= 8) return Math.round(150_000 + this.random() * 150_000);
    const cap = Math.min(60_000, 1000 * 2 ** attempt);
    return Math.round(this.random() * cap);
  }

  private send(value: Record<string, unknown> | string, raw = false): void {
    try {
      this.socket?.send(raw ? (value as string) : JSON.stringify(value));
    } catch {
      // The close event follows.
    }
  }

  private drop(): void {
    const socket = this.socket;
    this.socket = null;
    this.helloAnswered = false;
    this.clear("heartbeatTimer");
    this.clear("pongTimer");
    this.clear("helloTimer");
    this.clear("tokenTimer");
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      try {
        socket.close(1000, "gone");
      } catch {
        // Already closed.
      }
    }
  }

  private clear(
    name: "reconnectTimer" | "heartbeatTimer" | "pongTimer" | "helloTimer" | "tokenTimer",
  ): void {
    const id = this[name];
    if (id !== null) this.clearTimer(id);
    this[name] = null;
  }
}

function readEpoch(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
}

/** Only the Obsidian lanes; anything malformed is ignored. */
function readHeads(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const heads: Record<string, string> = {};
  for (const [lane, sequence] of Object.entries(value as Record<string, unknown>)) {
    if (typeof sequence !== "string" || !SEQUENCE.test(sequence)) return null;
    if (OBSIDIAN_LANES.has(lane)) heads[lane] = sequence;
  }
  return heads;
}
