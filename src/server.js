import { createServer } from "node:http";
import { randomBytes, randomInt } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server } from "socket.io";
import {
  act,
  addPlayer,
  cleanName,
  createTable,
  deal,
  dealerShouldHit,
  drawCard,
  handValue,
  needsDealerDraw,
  openBetting,
  placeBet,
  publicView,
  readyToDeal,
  removePlayer,
  settle,
  sitIn,
  sitOut,
} from "./engine.js";

const tables = new Map();
const sessions = new Map();
const standTimers = new Map();
const sweepTimers = new Map();

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function roomOf(code) {
  return `table:${code}`;
}

function dealerDelay() {
  return Number(process.env.DEALER_DELAY_MS ?? 700);
}

function autoStandMs() {
  return Number(process.env.AUTOSTAND_MS ?? 20000);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeCode() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let code = "";
    for (let i = 0; i < 5; i += 1) code += ALPHABET[randomInt(ALPHABET.length)];
    if (!tables.has(code)) return code;
  }
  return randomBytes(3).toString("hex").toUpperCase();
}

function makeToken() {
  return randomBytes(18).toString("hex");
}

function makePlayerId() {
  return `p_${randomBytes(6).toString("hex")}`;
}

function reply(callback, result) {
  if (typeof callback === "function") callback(result);
}

function remember(token, data) {
  sessions.set(token, data);
}

function forgetToken(token) {
  if (token) sessions.delete(token);
}

function clearTimer(map, key) {
  const timer = map.get(key);
  if (timer) clearTimeout(timer);
  map.delete(key);
}

export function createGameServer() {
  const app = express();
  app.disable("x-powered-by");
  const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true });
  });
  app.use(express.static(publicDir, {
    etag: true,
    maxAge: process.env.NODE_ENV === "production" ? "10m" : 0,
  }));

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: true, methods: ["GET", "POST"] },
  });

  function broadcast(table) {
    if (!table || !tables.has(table.code)) return;
    const room = io.sockets.adapter.rooms.get(roomOf(table.code));
    if (!room) return;
    for (const socketId of room) {
      const socket = io.sockets.sockets.get(socketId);
      if (!socket || socket.data.code !== table.code) continue;
      socket.emit("state", publicView(table, viewerOf(socket)));
    }
  }

  function viewerOf(socket) {
    if (socket.data.role === "dealer") return { role: "dealer" };
    if (socket.data.role === "player") return { role: "player", id: socket.data.playerId };
    return null;
  }

  function destroyTable(code, message) {
    const table = tables.get(code);
    if (!table) return;
    io.to(roomOf(code)).emit("table-closed", { message: message || "השולחן נסגר" });
    for (const [token, session] of sessions) {
      if (session.code === code) sessions.delete(token);
    }
    for (const player of table.players) {
      clearTimer(standTimers, player.id);
      clearTimer(sweepTimers, player.id);
    }
    clearTimer(sweepTimers, `dealer:${code}`);
    tables.delete(code);
  }

  async function animateDealer(table) {
    if (!table || table.resolving || !tables.has(table.code)) return;
    table.resolving = true;
    const stamp = (table._stamp || 0) + 1;
    table._stamp = stamp;
    try {
      table.phase = "dealer";
      table.turn = null;
      table.autoStandAt = null;
      table.holeHidden = false;
      broadcast(table);
      const delay = dealerDelay();
      if (needsDealerDraw(table)) {
        while (dealerShouldHit(table.dealerCards)) {
          if (delay) await sleep(delay);
          if (table._stamp !== stamp || !tables.has(table.code)) return;
          table.dealerCards.push(drawCard(table));
          const value = handValue(table.dealerCards);
          table.log.push({ text: value.bust ? "הדילר נשרף" : "הדילר מושך קלף", t: Date.now() });
          if (table.log.length > 40) table.log.splice(0, table.log.length - 40);
          broadcast(table);
        }
        const value = handValue(table.dealerCards);
        if (!value.bust) {
          const label = value.soft ? `${value.total} רך` : String(value.total);
          table.log.push({ text: `הדילר עומד על ${label}`, t: Date.now() });
        }
      } else if (!handValue(table.dealerCards).blackjack) {
        table.log.push({ text: "הדילר לא מושך", t: Date.now() });
      }
      if (delay) await sleep(Math.min(delay, 400));
      if (table._stamp !== stamp || !tables.has(table.code)) return;
      settle(table);
      broadcast(table);
    } catch (error) {
      console.error("dealer play failed", error);
      if (tables.has(table.code) && table.phase !== "results") {
        try {
          settle(table);
          broadcast(table);
        } catch (settleError) {
          console.error(settleError);
        }
      }
    } finally {
      if (table._stamp === stamp) table.resolving = false;
    }
  }

  function kickDealer(table) {
    if (table && table.phase === "dealer" && !table.resolving) void animateDealer(table);
  }

  function maybeAutoDeal(table) {
    if (!readyToDeal(table)) return;
    const result = deal(table);
    broadcast(table);
    if (result.ok) kickDealer(table);
  }

  function armAutoStand(table, playerId) {
    clearTimer(standTimers, playerId);
    const player = table.players.find((item) => item.id === playerId);
    if (!player || player.connected) return;
    if (table.phase !== "acting" || table.turn?.playerId !== playerId) return;
    table.autoStandAt = Date.now() + autoStandMs();
    const timer = setTimeout(() => {
      standTimers.delete(playerId);
      const current = tables.get(table.code);
      const seated = current?.players.find((item) => item.id === playerId);
      if (!current || !seated || seated.connected) return;
      if (current.phase !== "acting" || current.turn?.playerId !== playerId) return;
      current.log.push({ text: `${seated.nickname} לא מחובר — עצירה אוטומטית`, t: Date.now() });
      const result = act(current, playerId, "stand");
      current.autoStandAt = null;
      broadcast(current);
      if (result.ok && result.roundComplete) kickDealer(current);
      else if (current.turn?.playerId === playerId && !seated.connected) armAutoStand(current, playerId);
    }, autoStandMs());
    timer.unref();
    standTimers.set(playerId, timer);
    broadcast(table);
  }

  function armSweep(key, ms, fn) {
    clearTimer(sweepTimers, key);
    const timer = setTimeout(fn, ms);
    timer.unref();
    sweepTimers.set(key, timer);
  }

  function bind(socket, table, role, token, playerId = null) {
    if (socket.data.code && socket.data.code !== table.code) {
      socket.leave(roomOf(socket.data.code));
    }
    socket.data.code = table.code;
    socket.data.role = role;
    socket.data.token = token;
    socket.data.playerId = playerId;
    socket.join(roomOf(table.code));
  }

  io.on("connection", (socket) => {
    socket.on("create-table", (body, callback) => {
      if (socket.data.code) {
        reply(callback, { ok: false, error: "כבר מחוברים לשולחן. צאו קודם." });
        return;
      }
      const code = makeCode();
      const token = makeToken();
      const table = createTable({
        code,
        dealerName: cleanName(body?.dealerName) || "הדילר",
      });
      table.dealerSocketId = socket.id;
      table.dealerConnected = true;
      tables.set(code, table);
      remember(token, { code, role: "dealer" });
      bind(socket, table, "dealer", token);
      reply(callback, { ok: true, code, token, role: "dealer" });
      broadcast(table);
    });

    socket.on("join-table", (body, callback) => {
      if (socket.data.code) {
        reply(callback, { ok: false, error: "כבר מחוברים לשולחן. צאו קודם." });
        return;
      }
      const code = String(body?.code || "").trim().toUpperCase();
      const table = tables.get(code);
      if (!table) {
        reply(callback, { ok: false, error: "לא נמצא שולחן עם הקוד הזה" });
        return;
      }
      const playerId = makePlayerId();
      const result = addPlayer(table, {
        id: playerId,
        nickname: body?.nickname,
        bankroll: body?.bankroll,
      });
      if (!result.ok) {
        reply(callback, result);
        return;
      }
      const player = table.players.find((item) => item.id === playerId);
      player.socketId = socket.id;
      const token = makeToken();
      remember(token, { code, role: "player", playerId });
      bind(socket, table, "player", token, playerId);
      reply(callback, { ok: true, code, token, role: "player" });
      broadcast(table);
    });

    socket.on("resume", (body, callback) => {
      const token = String(body?.token || "");
      const session = sessions.get(token);
      const code = String(body?.code || session?.code || "").trim().toUpperCase();
      const table = tables.get(code);
      if (!session || session.code !== code || !table) {
        reply(callback, { ok: false, error: "המושב לא נמצא. אפשר להצטרף מחדש." });
        return;
      }
      if (session.role === "dealer") {
        table.dealerConnected = true;
        table.dealerSocketId = socket.id;
        clearTimer(sweepTimers, `dealer:${code}`);
        bind(socket, table, "dealer", token);
        reply(callback, { ok: true, code, role: "dealer" });
        broadcast(table);
        return;
      }
      const player = table.players.find((item) => item.id === session.playerId);
      if (!player) {
        forgetToken(token);
        reply(callback, { ok: false, error: "המושב לא נמצא. אפשר להצטרף מחדש." });
        return;
      }
      player.connected = true;
      player.socketId = socket.id;
      player.leaving = false;
      clearTimer(standTimers, player.id);
      clearTimer(sweepTimers, player.id);
      if (table.turn?.playerId === player.id) table.autoStandAt = null;
      bind(socket, table, "player", token, player.id);
      reply(callback, { ok: true, code, role: "player" });
      broadcast(table);
    });

    socket.on("open-round", (_body, callback) => {
      const table = tables.get(socket.data.code);
      if (!table || socket.data.role !== "dealer") {
        reply(callback, { ok: false, error: "רק הדילר פותח סיבוב" });
        return;
      }
      const result = openBetting(table);
      reply(callback, result);
      if (result.ok) broadcast(table);
    });

    socket.on("place-bet", (body, callback) => {
      const table = tables.get(socket.data.code);
      if (!table || socket.data.role !== "player") {
        reply(callback, { ok: false, error: "רק שחקן מהמר" });
        return;
      }
      const result = placeBet(table, socket.data.playerId, body?.amount);
      if (!result.ok) {
        reply(callback, result);
        return;
      }
      if (readyToDeal(table)) {
        const dealt = deal(table);
        broadcast(table);
        reply(callback, dealt.ok ? { ok: true } : dealt);
        if (dealt.ok) kickDealer(table);
        return;
      }
      reply(callback, result);
      broadcast(table);
    });

    socket.on("sit-out", (_body, callback) => {
      const table = tables.get(socket.data.code);
      if (!table || socket.data.role !== "player") {
        reply(callback, { ok: false, error: "רק שחקן יכול לדלג" });
        return;
      }
      const result = sitOut(table, socket.data.playerId);
      reply(callback, result);
      if (!result.ok) return;
      if (readyToDeal(table)) {
        const dealt = deal(table);
        broadcast(table);
        if (dealt.ok) kickDealer(table);
        return;
      }
      broadcast(table);
    });

    socket.on("sit-in", (_body, callback) => {
      const table = tables.get(socket.data.code);
      if (!table || socket.data.role !== "player") {
        reply(callback, { ok: false, error: "רק שחקן יכול לחזור" });
        return;
      }
      const result = sitIn(table, socket.data.playerId);
      reply(callback, result);
      if (result.ok) broadcast(table);
    });

    socket.on("deal-now", (_body, callback) => {
      const table = tables.get(socket.data.code);
      if (!table || socket.data.role !== "dealer") {
        reply(callback, { ok: false, error: "רק הדילר מחלק" });
        return;
      }
      const result = deal(table);
      reply(callback, result);
      if (!result.ok) return;
      broadcast(table);
      kickDealer(table);
    });

    socket.on("action", (body, callback) => {
      const table = tables.get(socket.data.code);
      if (!table || socket.data.role !== "player") {
        reply(callback, { ok: false, error: "רק שחקן פועל" });
        return;
      }
      const result = act(table, socket.data.playerId, body?.type);
      reply(callback, result.ok ? { ok: true } : result);
      if (!result.ok) return;
      table.autoStandAt = null;
      broadcast(table);
      if (result.roundComplete) kickDealer(table);
      else if (table.turn) {
        const seated = table.players.find((item) => item.id === table.turn.playerId);
        if (seated && !seated.connected) armAutoStand(table, seated.id);
      }
    });

    socket.on("leave", (_body, callback) => {
      const table = tables.get(socket.data.code);
      if (!table) {
        reply(callback, { ok: true });
        return;
      }
      if (socket.data.role === "dealer" && table.dealerSocketId === socket.id) {
        const code = table.code;
        socket.leave(roomOf(code));
        socket.data = {};
        reply(callback, { ok: true });
        destroyTable(code, "הדילר סגר את השולחן");
        return;
      }
      if (socket.data.role === "player") {
        const result = removePlayer(table, socket.data.playerId);
        forgetToken(socket.data.token);
        clearTimer(standTimers, socket.data.playerId);
        clearTimer(sweepTimers, socket.data.playerId);
        socket.leave(roomOf(table.code));
        socket.data = {};
        reply(callback, result.ok ? { ok: true } : result);
        if (result.ok) {
          broadcast(table);
          if (result.roundComplete) kickDealer(table);
          else maybeAutoDeal(table);
        }
        return;
      }
      reply(callback, { ok: true });
    });

    socket.on("disconnect", () => {
      const table = tables.get(socket.data.code);
      if (!table) return;
      if (socket.data.role === "dealer") {
        if (table.dealerSocketId !== socket.id) return;
        table.dealerConnected = false;
        table.dealerSocketId = null;
        broadcast(table);
        armSweep(`dealer:${table.code}`, 10 * 60 * 1000, () => {
          const current = tables.get(table.code);
          if (current && !current.dealerConnected) destroyTable(table.code, "השולחן נסגר אחרי שהדילר התנתק");
        });
        return;
      }
      if (socket.data.role === "player") {
        const player = table.players.find((item) => item.id === socket.data.playerId);
        if (!player || player.socketId !== socket.id) return;
        player.connected = false;
        player.socketId = null;
        broadcast(table);
        if (table.phase === "acting" && table.turn?.playerId === player.id) armAutoStand(table, player.id);
        armSweep(player.id, 3 * 60 * 1000, () => {
          const current = tables.get(table.code);
          const seated = current?.players.find((item) => item.id === player.id);
          if (!current || !seated || seated.connected) return;
          if (current.phase === "acting" || current.phase === "dealer") {
            seated.leaving = true;
            return;
          }
          if (current.phase === "betting" && seated.committed) {
            seated.bankroll += seated.bet;
            seated.bet = 0;
            seated.committed = false;
          }
          removePlayer(current, seated.id);
          forgetToken(socket.data.token);
          broadcast(current);
          maybeAutoDeal(current);
        });
      }
    });
  });

  return { app, httpServer, io };
}

export function testSetShoe(code, shoe) {
  if (process.env.NODE_ENV !== "test") throw new Error("test only");
  const table = tables.get(code);
  if (!table) throw new Error("missing table");
  table.shoe = shoe;
  return table;
}

export function testGetTable(code) {
  if (process.env.NODE_ENV !== "test") throw new Error("test only");
  return tables.get(code);
}

export function startServer({ port = 0 } = {}) {
  const game = createGameServer();
  return new Promise((resolve) => {
    game.httpServer.listen(port, "0.0.0.0", () => {
      const address = game.httpServer.address();
      resolve({
        ...game,
        port: address.port,
        async close() {
          await new Promise((done, reject) => {
            game.io.close();
            game.httpServer.close((error) => (error ? reject(error) : done()));
          });
        },
      });
    });
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const port = Number(process.env.PORT) || 4317;
  startServer({ port }).then(({ port: bound }) => {
    console.log(`blackjack listening on 0.0.0.0:${bound}`);
  });
  process.on("SIGTERM", () => {
    console.log("SIGTERM");
    process.exit(0);
  });
}

