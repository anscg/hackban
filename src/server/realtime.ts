import { EventEmitter } from "node:events";

import postgres from "postgres";

import { env } from "~/env";
import { db } from "~/server/db";

export type BoardEvent = {
  boardId: string;
  cardId?: string;
  // client id of the tab that caused the change, so it can skip its own echo
  origin?: string;
  kind: "board" | "card" | "deleted";
};

// Events travel through Postgres NOTIFY so every app replica hears every change;
// each replica re-emits them on its local bus for its own live-update streams.
const CHANNEL = "hackban_board";

const g = globalThis as unknown as { boardBus?: EventEmitter; boardListen?: Promise<unknown> };

export const boardBus = g.boardBus ?? new EventEmitter();
boardBus.setMaxListeners(0);
g.boardBus = boardBus;

const emit = (event: BoardEvent) => boardBus.emit(`board:${event.boardId}`, event);

/** Start this process's LISTEN connection (once). postgres.js reconnects and re-listens on its own. */
export function listenForEvents() {
  g.boardListen ??= postgres(env.DATABASE_URL, { max: 1 })
    .listen(CHANNEL, (payload) => emit(JSON.parse(payload) as BoardEvent))
    .catch((e: unknown) => {
      g.boardListen = undefined; // try again on the next subscription
      console.error("[realtime] LISTEN failed", e);
    });
  return g.boardListen;
}

export function publish(event: BoardEvent) {
  // If NOTIFY fails, at least this replica's viewers still get the update.
  db.$executeRaw`SELECT pg_notify(${CHANNEL}, ${JSON.stringify(event)})`.catch((e: unknown) => {
    console.error("[realtime] NOTIFY failed", e);
    emit(event);
  });
}
