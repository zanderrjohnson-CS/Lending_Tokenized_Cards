import fs from "node:fs";
import type { ChainEvent, ChainSource, Cursor, FetchResult } from "../events.js";

/**
 * Serves a fixed list of events. It deliberately ignores the cursor and returns everything every
 * time, which is what makes it a good duplicate-safety test (and the source for the seed script).
 */
export class ReplaySource implements ChainSource {
  constructor(private events: ChainEvent[]) {}
  static fromFile(path: string) {
    return new ReplaySource(JSON.parse(fs.readFileSync(path, "utf8")));
  }
  async fetchSince(_c: Cursor): Promise<FetchResult> {
    const last = this.events[this.events.length - 1];
    return {
      events: this.events,
      cursor: { signature: last?.signature ?? null, slot: last?.slot ?? null },
    };
  }
}
