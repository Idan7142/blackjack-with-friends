import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { io as ioClient } from "socket.io-client";
import { createShoe } from "../src/engine.js";
import { startServer, testGetTable, testSetShoe } from "../src/server.js";

process.env.DEALER_DELAY_MS = "0";
process.env.AUTOSTAND_MS = "400";
process.env.RESULT_PAUSE_MS = "30000";

let server;
let url;

function connect() {
  const socket = ioClient(url, { transports: ["websocket"], forceNew: true });
  socket.on("state", (state) => {
    socket._state = state;
  });
  return socket;
}

function emit(socket, event, body = {}) {
  return new Promise((resolve) => socket.emit(event, body, resolve));
}

function waitFor(get, pred, ms = 6000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      const value = get();
      if (value && pred(value)) {
        clearInterval(timer);
        resolve(value);
      } else if (Date.now() - start > ms) {
        clearInterval(timer);
        reject(new Error(`timeout ${JSON.stringify(value && { phase: value.phase, turn: value.turn, you: value.you })}`));
      }
    }, 20);
  });
}

describe("socket table", () => {
  before(async () => {
    server = await startServer({ port: 0 });
    url = `http://127.0.0.1:${server.port}`;
  });

  after(async () => {
    await server.close();
  });

  it("serves health", async () => {
    const response = await fetch(`${url}/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
  });

  it("plays a hidden-hole round for two players and restores a seat after reconnect", async () => {
    const dealer = connect();
    const noa = connect();
    const yossi = connect();
    await Promise.all([
      waitFor(() => dealer.connected, Boolean),
      waitFor(() => noa.connected, Boolean),
      waitFor(() => yossi.connected, Boolean),
    ]);

    const created = await emit(dealer, "create-table", { dealerName: "רוני" });
    assert.equal(created.ok, true);
    const denied = await emit(noa, "open-round", {});
    assert.equal(denied.ok, false);
    const missing = await emit(yossi, "join-table", { code: "ZZZZZ", nickname: "יוסי", bankroll: 1000 });
    assert.equal(missing.ok, false);

    const joinNoa = await emit(noa, "join-table", { code: created.code, nickname: "נועה", bankroll: 1000 });
    const joinYossi = await emit(yossi, "join-table", { code: created.code, nickname: "יוסי", bankroll: 800 });
    assert.equal(joinNoa.ok, true);
    assert.equal(joinYossi.ok, true);
    assert.equal((await emit(dealer, "place-bet", { amount: 10 })).ok, false);

    const opened = await emit(dealer, "open-round", {});
    assert.equal(opened.ok, true);
    testSetShoe(created.code, createShoe({
      cards: [
        { rank: "10", suit: "H", id: "p1a" },
        { rank: "9", suit: "H", id: "p2a" },
        { rank: "10", suit: "C", id: "up" },
        { rank: "7", suit: "D", id: "p1b" },
        { rank: "8", suit: "D", id: "p2b" },
        { rank: "7", suit: "S", id: "HOLE-SECRET" },
        { rank: "2", suit: "C", id: "NEXT-SECRET" },
      ],
      cutIndex: 6,
    }));

    assert.equal((await emit(noa, "place-bet", { amount: 100 })).ok, true);
    const early = await emit(yossi, "action", { type: "hit" });
    assert.equal(early.ok, false);
    assert.equal((await emit(yossi, "place-bet", { amount: 50 })).ok, true);

    const acting = await waitFor(() => noa._state, (state) => state.phase === "acting");
    assert.deepEqual(acting.dealer.cards[1], { faceDown: true });
    assert.equal(acting.dealer.holeHidden, true);
    const internal = testGetTable(created.code);
    const blob = JSON.stringify(acting);
    assert.equal(blob.includes("HOLE-SECRET"), false);
    assert.equal(blob.includes("NEXT-SECRET"), false);
    assert.equal(blob.includes(internal.shoe.cards.find((card) => !card.cut).id), false);
    assert.equal(acting.you.yourTurn, true);
    assert.equal((await emit(yossi, "action", { type: "hit" })).ok, false);

    assert.equal((await emit(noa, "action", { type: "stand" })).ok, true);
    await waitFor(() => yossi._state, (state) => state.you.yourTurn);
    assert.equal((await emit(yossi, "action", { type: "stand" })).ok, true);
    const done = await waitFor(() => dealer._state, (state) => state.phase === "results");
    assert.equal(done.dealer.cards[1].rank, "7");
    assert.equal(done.dealer.holeHidden, false);
    assert.equal(done.players.find((player) => player.nickname === "נועה").bankroll, 1000);
    assert.equal(done.players.find((player) => player.nickname === "יוסי").bankroll, 800);
    assert.equal(done.shoe.remaining > 0, true);

    noa.disconnect();
    await waitFor(() => testGetTable(created.code), (table) => table.players[0].connected === false);
    const again = connect();
    await waitFor(() => again.connected, Boolean);
    const resumed = await emit(again, "resume", { code: created.code, token: joinNoa.token });
    assert.equal(resumed.ok, true);
    const restored = await waitFor(() => again._state, (state) => state.you?.nickname === "נועה" && state.you.connected);
    assert.equal(restored.you.bankroll, 1000);
    assert.equal(restored.players.length, 2);

    dealer.disconnect();
    noa.disconnect();
    yossi.disconnect();
    again.disconnect();
  });

  it("opens the next round on its own and keeps the seat and balance", async () => {
    process.env.RESULT_PAUSE_MS = "0";
    const dealer = connect();
    const noa = connect();
    try {
      await Promise.all([
        waitFor(() => dealer.connected, Boolean),
        waitFor(() => noa.connected, Boolean),
      ]);
      const created = await emit(dealer, "create-table", { dealerName: "רוני" });
      assert.equal(created.ok, true);
      const join = await emit(noa, "join-table", { code: created.code, nickname: "נועה", bankroll: 1000 });
      assert.equal(join.ok, true);
      assert.equal((await emit(dealer, "open-round", {})).ok, true);
      testSetShoe(created.code, createShoe({
        cards: [
          { rank: "10", suit: "H", id: "a" },
          { rank: "10", suit: "D", id: "b" },
          { rank: "9", suit: "C", id: "c" },
          { rank: "9", suit: "S", id: "d" },
          { rank: "2", suit: "H", id: "e" },
        ],
        cutIndex: 4,
      }));
      assert.equal((await emit(noa, "place-bet", { amount: 100 })).ok, true);
      const acting = await waitFor(() => noa._state, (state) => state.phase === "acting");
      assert.equal((await emit(noa, "action", { type: "stand" })).ok, true);
      const next = await waitFor(
        () => dealer._state,
        (state) => state.phase === "betting" && state.round === 2,
      );
      assert.equal(next.players.length, 1);
      assert.equal(next.players[0].nickname, "נועה");
      assert.equal(next.players[0].id, acting.players[0].id);
      assert.equal(next.players[0].bankroll, 1000);
      assert.equal(next.players[0].hands.length, 0);
      assert.equal(testGetTable(created.code).players[0].bankroll, 1000);
      assert.equal(next.reshuffled, true);
    } finally {
      process.env.RESULT_PAUSE_MS = "30000";
      dealer.disconnect();
      noa.disconnect();
    }
  });
});
