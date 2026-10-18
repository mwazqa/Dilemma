// One local timer for known work. An empty queue never wakes the database.
export class DeadlineQueue {
  private readonly deadlines = new Map<string, number>();
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopped = false;
  private active?: { key: string; superseded: boolean };

  constructor(private readonly work: (key: string, current: () => boolean) => Promise<void>,
    private readonly onError: (error: unknown) => void) {}

  schedule(key: string, at: Date | number) {
    const timestamp = +at;
    if (this.stopped || !Number.isFinite(timestamp)) return;
    if (this.active?.key === key) this.active.superseded = true;
    this.deadlines.set(key, timestamp);
    this.arm();
  }

  cancel(key: string) {
    if (this.active?.key === key) this.active.superseded = true;
    this.deadlines.delete(key);
    this.arm();
  }

  stop() {
    this.stopped = true;
    this.deadlines.clear();
    clearTimeout(this.timer);
  }

  private arm() {
    if (this.stopped || this.running) return;
    clearTimeout(this.timer);
    let next = Infinity;
    for (const at of this.deadlines.values()) next = Math.min(next, at);
    if (!Number.isFinite(next)) return;
    // Node timers overflow above ~24.8 days. Long waits are re-armed locally.
    this.timer = setTimeout(() => void this.drain(), Math.max(0, Math.min(next - Date.now(), 2_147_483_647)));
    this.timer.unref();
  }

  private async drain() {
    this.running = true;
    try {
      while (!this.stopped) {
        let key: string | undefined;
        let next = Infinity;
        for (const [candidate, at] of this.deadlines) {
          if (at < next) { key = candidate; next = at; }
        }
        if (key === undefined || next > Date.now()) break;
        this.deadlines.delete(key);
        const active = this.active = { key, superseded: false };
        const current = () => !this.stopped && !active.superseded;
        try { await this.work(key, current); }
        catch (error) {
          this.onError(error);
          if (current()) this.schedule(key, Date.now() + 60_000);
        } finally { this.active = undefined; }
      }
    } finally {
      this.running = false;
      this.arm();
    }
  }
}

export function retryDelay(attempt: number, initialMs = 60_000) {
  return Math.min(initialMs * 2 ** Math.min(attempt, 10), 3_600_000);
}
