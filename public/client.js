const SUIT = { H: "♥", D: "♦", C: "♣", S: "♠" };
const CHIP_VALUES = [10, 25, 50, 100, 250, 500];

const socket = io();
let session = loadSession();
let lastState = null;
let betDraft = 50;
let feltSig = "";
let dockSig = "";
let online = false;
const seenCards = new Set();

const gate = document.getElementById("gate");
const room = document.getElementById("room");
const toast = document.getElementById("toast");
const felt = document.getElementById("felt");
const dock = document.getElementById("dock");
const logEl = document.getElementById("log");
const live = document.getElementById("live");

const params = new URLSearchParams(location.search);
const linkedCode = (params.get("table") || "").toUpperCase();
if (linkedCode) document.getElementById("join-code").value = linkedCode;
if (session && linkedCode && session.code !== linkedCode) {
  clearSession();
  session = null;
}

document.getElementById("create-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const dealerName = document.getElementById("dealer-name").value;
  socket.emit("create-table", { dealerName }, (res) => {
    if (!res?.ok) return showToast(res?.error || "לא הצלחנו לפתוח שולחן");
    adoptSession({ code: res.code, token: res.token, role: "dealer" });
  });
});

document.getElementById("join-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const code = document.getElementById("join-code").value.trim().toUpperCase();
  const nickname = document.getElementById("join-name").value;
  const bankroll = Number(document.getElementById("join-bankroll").value);
  socket.emit("join-table", { code, nickname, bankroll }, (res) => {
    if (!res?.ok) return showToast(res?.error || "לא הצלחנו להיכנס");
    adoptSession({ code: res.code, token: res.token, role: "player" });
  });
});

document.body.addEventListener("click", (event) => {
  const button = event.target.closest("[data-act]");
  if (!button || button.disabled) return;
  const act = button.dataset.act;
  if (act === "preset") {
    document.getElementById("join-bankroll").value = button.dataset.value;
    return;
  }
  if (act === "copy") copyLink();
  else if (act === "rules") {
    const dialog = document.getElementById("rules");
    if (!dialog.open) dialog.showModal();
  }
  else if (act === "leave") leaveTable();
  else if (act === "log") toggleLog();
  else if (act === "open") send("open-round");
  else if (act === "deal") send("deal-now");
  else if (act === "sitout") send("sit-out");
  else if (act === "sitin") send("sit-in");
  else if (act === "chip") addChip(Number(button.dataset.value));
  else if (act === "clear-bet") {
    betDraft = lastState?.rules?.minBet || 10;
    dockSig = "";
    renderDock(lastState);
  } else if (act === "bet") send("place-bet", { amount: betDraft });
  else if (["hit", "stand", "double", "split"].includes(act)) send("action", { type: act });
});

dock.addEventListener("input", (event) => {
  if (event.target.id === "bet-amount") betDraft = Number(event.target.value);
});

socket.on("connect", () => {
  online = true;
  paintConn();
  const current = loadSession();
  if (current) socket.emit("resume", current, (res) => {
    if (!res?.ok) {
      clearSession();
      session = null;
      showGate();
      showToast(res?.error || "המושב לא נמצא");
    }
  });
});

socket.on("disconnect", () => {
  online = false;
  paintConn();
});

socket.on("state", (state) => {
  if (!loadSession()) return;
  lastState = state;
  gate.hidden = true;
  room.hidden = false;
  render(state);
});

socket.on("table-closed", (payload) => {
  clearSession();
  session = null;
  lastState = null;
  showGate();
  showToast(payload?.message || "השולחן נסגר");
});

setInterval(() => {
  const el = document.getElementById("deadline");
  if (!el || !lastState?.turn?.autoStandAt) return;
  const secs = Math.max(0, Math.ceil((lastState.turn.autoStandAt - Date.now()) / 1000));
  el.textContent = `עצירה אוטומטית בעוד ${secs} שנ׳`;
}, 250);

function adoptSession(next) {
  session = next;
  sessionStorage.setItem("friends-bj", JSON.stringify(next));
  const url = new URL(location.href);
  url.searchParams.set("table", next.code);
  history.replaceState(null, "", url);
}

function loadSession() {
  try {
    return JSON.parse(sessionStorage.getItem("friends-bj") || "null");
  } catch {
    return null;
  }
}

function clearSession() {
  sessionStorage.removeItem("friends-bj");
}

function showGate() {
  room.hidden = true;
  gate.hidden = false;
  feltSig = "";
  dockSig = "";
}

function send(event, body) {
  socket.emit(event, body || {}, (res) => {
    if (res && res.ok === false) showToast(res.error || "הפעולה נדחתה");
  });
}

function leaveTable() {
  socket.emit("leave", {}, () => {
    clearSession();
    session = null;
    lastState = null;
    history.replaceState(null, "", location.pathname);
    showGate();
  });
}

async function copyLink() {
  const link = shareUrl();
  try {
    await navigator.clipboard.writeText(link);
    showToast("הקישור הועתק");
  } catch {
    showToast(link);
  }
}

function shareUrl() {
  const code = lastState?.code || session?.code || "";
  const url = new URL(location.href);
  url.search = "";
  url.hash = "";
  if (code) url.searchParams.set("table", code);
  return url.toString();
}

function showToast(message) {
  toast.hidden = false;
  toast.textContent = message;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    toast.hidden = true;
  }, 3200);
}

function paintConn() {
  document.getElementById("conn-gate").textContent = online ? "השרת מחובר" : "מתחברים לשרת…";
  document.getElementById("conn-dot").classList.toggle("off", !online);
}

function render(state) {
  if (state.you.role === "player" && state.phase === "betting") {
    const min = state.rules.minBet;
    if (!Number.isFinite(betDraft) || betDraft <= 0) betDraft = min;
    betDraft = Math.min(betDraft, state.you.bankroll);
    if (state.you.bankroll >= min && betDraft < min) betDraft = min;
  }
  document.getElementById("room-code").textContent = state.code;
  document.getElementById("role-pill").textContent = state.you.role === "dealer" ? "אתם הדילר" : "שחקן";
  const nextFelt = feltSignature(state);
  if (nextFelt !== feltSig) {
    feltSig = nextFelt;
    felt.innerHTML = renderFelt(state);
    announce(state);
  }
  renderLog(state);
  renderDock(state);
  layoutTable();
}

function feltSignature(state) {
  return JSON.stringify({
    phase: state.phase,
    round: state.round,
    dealer: state.dealer,
    players: state.players,
    turn: state.turn,
    reshuffled: state.reshuffled,
    waitingFor: state.waitingFor,
    shoe: [state.shoe.remaining, state.shoe.cutReached, state.shoe.cutFromFront, state.shoe.cutInShoe],
    you: state.you.role === "player" ? state.you.id : state.you.role,
  });
}

function renderFelt(state) {
  const copy = centerCopy(state);
  const deadline = state.turn?.autoStandAt
    ? `<div id="deadline" class="warn-banner">עצירה אוטומטית</div>`
    : "";
  const offline = state.dealer.connected ? "" : `<div class="warn-banner">הדילר מנותק. השולחן מחכה לחיבור מחדש.</div>`;
  return `
    <div class="rail" id="rail"><div class="felt-surface"></div></div>
    <div class="center-copy" id="center-copy">
      <p class="pot-label">סה״כ על השולחן</p>
      <p class="pot-amount num">${fmt(tablePot(state))}</p>
      <h2>${esc(copy.title)}</h2>
      <p class="center-body">${esc(copy.body)}</p>
      ${offline}
      ${deadline}
    </div>
    ${shoeStackHtml(state)}
    ${dealerHtml(state)}
    ${state.players.map((player) => seatHtml(state, player)).join("")}`;
}

function tablePot(state) {
  let total = 0;
  for (const player of state.players) {
    if (player.hands?.length) {
      for (const hand of player.hands) total += Number(hand.bet) || 0;
    } else {
      total += Number(player.bet) || 0;
    }
  }
  return total;
}

function shoeStackHtml(state) {
  const shoe = state.shoe;
  const total = Number(shoe.total || shoe.decks * 52) || 312;
  const remaining = Number(shoe.remaining) || 0;
  const depth = Math.max(0.06, Math.min(1, remaining / total));
  const hasCut = Boolean(shoe.cutInShoe) && shoe.cutFromFront != null;
  const thickness = remaining + (hasCut ? 1 : 0);
  const cutTop = hasCut && thickness > 0 ? (Number(shoe.cutFromFront) / thickness) * 100 : null;
  const aside = shoe.cutReached && !shoe.cutInShoe ? `<div class="cut-aside" title="קלף החיתוך בצד"></div>` : "";
  const slice = cutTop == null ? "" : `<div class="cut-slice" style="top:${cutTop.toFixed(2)}%"></div>`;
  const reshuffle = state.reshuffled ? `<div class="reshuffle-flag">ערבוב מחדש</div>` : "";
  const label = hasCut ? "נעל עם קלף חיתוך אדום" : shoe.cutReached ? "קלף החיתוך בצד" : "נעל";
  return `
    <div class="shoe-stack" id="shoe-stack" role="img" aria-label="${esc(label)}">
      <div class="shoe-pack" style="--pack:${depth.toFixed(3)}">${slice}</div>
      ${aside}
      ${reshuffle}
      <div class="shoe-count"><b class="num">${fmt(remaining)}</b></div>
    </div>`;
}

function dealerHtml(state) {
  const dealer = state.dealer;
  const faceUp = dealer.cards.filter((card) => !card.faceDown).length;
  const total = faceUp >= 2 ? handLabel(dealer, true) : "";
  return `
    <div class="dealer-plate" id="dealer-plate">
      <div class="who"><strong>דילר · ${esc(dealer.name)}</strong>${total ? `<span class="total-badge">${total}</span>` : ""}</div>
      <div class="hand-cards">${dealer.cards.map((card, index) => cardHtml(state, "dealer", index, card)).join("") || `<span class="wait-line">מחכה לחלוקה</span>`}</div>
    </div>`;
}

function seatHtml(state, player) {
  const active = player.hands.some((hand) => hand.active);
  const classes = ["seat"];
  if (active) classes.push("active");
  if (player.isYou) classes.push("you");
  if (!player.connected) classes.push("offline");
  const badge = player.isYou ? " · אתם" : "";
  const status = !player.connected ? "מנותק" : player.sittingOut ? "בלי הימור" : "";
  const hands = player.hands.length
    ? `<div class="hand-row">${player.hands.map((hand, index) => handHtml(state, player, hand, index)).join("")}</div>`
    : `<p class="wait-line">${player.committed ? `הימור <span class="num">${fmt(player.bet)}</span>` : "ממתין"}</p>`;
  return `
    <article class="${classes.join(" ")}" ${active ? `aria-current="true"` : ""}>
      ${active ? `<div class="turn-flag">תור</div>` : ""}
      <div class="who">
        <strong>${esc(player.nickname)}${badge}</strong>
        <span class="bank num">${fmt(player.bankroll)}</span>
      </div>
      ${status ? `<div class="badge">${status}</div>` : ""}
      ${hands}
    </article>`;
}

function handHtml(state, player, hand, index) {
  const result = resultHtml(hand);
  return `
    <div class="hand ${hand.active ? "active" : ""}">
      <div class="hand-cards">${hand.cards.map((card, cardIndex) => cardHtml(state, `${player.id}-${index}`, cardIndex, card)).join("")}</div>
      <div class="hand-meta"><span class="total-badge">${handLabel(hand, false)}</span><span class="bet-label"><span class="bet-word">הימור </span><span class="num">${fmt(hand.bet)}</span></span></div>
      ${result}
    </div>`;
}

function resultHtml(hand) {
  if (!hand.result) return "";
  const labels = {
    blackjack: "בלאקג'ק",
    win: "ניצחון",
    lose: "הפסד",
    push: "תיקו",
    bust: "שריפה",
  };
  const signed = hand.net > 0 ? `+${fmt(hand.net)}` : `−${fmt(Math.abs(hand.net))}`;
  const net = hand.result === "push" ? "" : ` <span class="num" dir="ltr">${signed}</span>`;
  return `<div class="result-badge ${hand.result}">${labels[hand.result] || ""}${net}</div>`;
}

function handLabel(hand, dealer) {
  if (!dealer && (hand.result === "bust" || hand.bust)) return "שריפה";
  if (hand.bust) return "שריפה";
  if (hand.blackjack) return "בלאקג'ק";
  if (hand.total == null) return "";
  return hand.soft ? `${hand.total} רך` : String(hand.total);
}

function cardHtml(state, owner, index, card) {
  const key = `${state.round}:${owner}:${index}:${card.faceDown ? "down" : `${card.rank}${card.suit}`}`;
  const fresh = seenCards.has(key) ? "" : "fresh";
  seenCards.add(key);
  if (card.faceDown) return `<div class="card back ${fresh}" aria-label="קלף סגור"></div>`;
  const red = card.suit === "H" || card.suit === "D";
  const suit = SUIT[card.suit] || "";
  const ten = card.rank === "10" ? "ten" : "";
  return `
    <div class="card ${red ? "red" : "black"} ${ten} ${fresh}" aria-label="${esc(card.rank)} ${suit}">
      <span class="corner tl"><b>${esc(card.rank)}</b><i>${suit}</i></span>
      ${cardFace(card, suit)}
      <span class="corner br"><b>${esc(card.rank)}</b><i>${suit}</i></span>
    </div>`;
}

function cardFace(card, suit) {
  if ("JQK".includes(card.rank)) {
    return `<div class="court-face"><span class="court-rank">${esc(card.rank)}</span><span class="court-suit">${suit}</span></div>`;
  }
  const layout = PIPS[card.rank] || [];
  const big = card.rank === "A" ? "big" : "";
  return `<div class="pips">${layout.map(([x, y, flip]) => `<span class="pip ${big} ${flip ? "flip" : ""}" style="left:${x}%;top:${y}%">${suit}</span>`).join("")}</div>`;
}

const PIPS = {
  A: [[50, 50]],
  2: [[50, 22], [50, 78, true]],
  3: [[50, 20], [50, 50], [50, 80, true]],
  4: [[30, 22], [70, 22], [30, 78, true], [70, 78, true]],
  5: [[30, 22], [70, 22], [50, 50], [30, 78, true], [70, 78, true]],
  6: [[30, 20], [70, 20], [30, 50], [70, 50], [30, 80, true], [70, 80, true]],
  7: [[30, 18], [70, 18], [50, 34], [30, 52], [70, 52], [30, 82, true], [70, 82, true]],
  8: [[30, 16], [70, 16], [50, 32], [30, 48], [70, 48], [50, 66, true], [30, 84, true], [70, 84, true]],
  9: [[30, 16], [70, 16], [30, 34], [70, 34], [50, 50], [30, 66, true], [70, 66, true], [30, 84, true], [70, 84, true]],
  10: [[30, 14], [70, 14], [50, 28], [30, 38], [70, 38], [30, 62, true], [70, 62, true], [50, 74, true], [30, 86, true], [70, 86, true]],
};

function renderLog(state) {
  const items = [...(state.log || [])].reverse();
  logEl.innerHTML = items.map((entry) => logItem(entry.text)).join("") || "<li>עוד אין מהלך</li>";
}

function renderDock(state) {
  const signature = JSON.stringify({
    phase: state.phase,
    you: state.you,
    waitingFor: state.waitingFor,
    turn: state.turn && state.turn.playerId,
    round: state.round,
  });
  if (signature === dockSig) return;
  const focused = document.activeElement && document.activeElement.id === "bet-amount";
  dockSig = signature;
  dock.innerHTML = state.you.role === "dealer" ? dealerDock(state) : playerDock(state);
  if (focused) {
    const input = document.getElementById("bet-amount");
    if (input) {
      input.value = betDraft;
      input.focus();
    }
  }
}

function dealerDock(state) {
  if (state.phase === "lobby" || state.phase === "results") {
    const disabled = state.you.canOpen ? "" : "disabled";
    return dockWrap(
      state.phase === "results" ? "הסיבוב נגמר" : "מחכים לשחקנים",
      state.phase === "results" ? "המושבים נשארים. הימורים לסיבוב הבא נפתחים אוטומטית." : "רק אתם פותחים סיבוב חדש.",
      `<button type="button" class="primary" data-act="open" ${disabled}>${state.phase === "results" ? "סיבוב הבא" : "פתיחת סיבוב"}</button>`,
    );
  }
  if (state.phase === "betting") {
    const waiting = state.waitingFor.length ? `עוד בלי הימור: ${state.waitingFor.join(", ")}` : "כל מי שיכול כבר הימר, או שאפשר לחלק עכשיו.";
    return dockWrap("הימורים פתוחים", waiting, `<button type="button" class="primary" data-act="deal">חלק קלפים</button>`);
  }
  if (state.phase === "dealer") return dockWrap("הדילר משחק", "היד רצה לפי הכללים, בלי בחירה ידנית.", "");
  const name = playerName(state, state.turn?.playerId);
  return dockWrap("תור השחקנים", name ? `עכשיו ${name}` : "ממתינים לפעולה", "");
}

function playerDock(state) {
  if (state.phase === "betting") {
    if (state.you.sittingOut) {
      return dockWrap("אתם בחוץ בסיבוב הזה", `יתרה ${fmt(state.you.bankroll)}`, `<button type="button" class="primary" data-act="sitin">אני רוצה להמר</button>`);
    }
    const min = state.rules.minBet;
    return `
      <div class="dock-row">
        <div class="dock-copy"><strong>${state.you.committed ? "ההימור נעול" : "הניחו הימור"} · <span class="num">${fmt(state.you.bankroll)}</span></strong><span>מינימום ${min}</span></div>
        <div class="chips">
          ${CHIP_VALUES.map((value) => `<button type="button" class="chip c${value}" data-act="chip" data-value="${value}">${value}</button>`).join("")}
          <button type="button" class="ghost" data-act="clear-bet">נקה</button>
        </div>
        <div class="bet-box">
          <input id="bet-amount" type="number" inputmode="numeric" min="${min}" step="1" value="${betDraft}" />
          <button type="button" class="primary" data-act="bet">${state.you.committed ? "עדכון הימור" : "אישור הימור"}</button>
          <button type="button" class="ghost" data-act="sitout">בלי הימור</button>
        </div>
      </div>`;
  }
  if (state.you.yourTurn) {
    const legal = new Set(state.you.legalActions || []);
    const button = (act, label, cls) => `<button type="button" class="${cls}" data-act="${act}" ${legal.has(act) ? "" : "disabled"}>${label}</button>`;
    return `
      <div class="dock-row">
        <div class="dock-copy"><strong>תורכם</strong><span>יד ${state.turn.handIndex + 1} · יתרה ${fmt(state.you.bankroll)}</span></div>
        <div class="actions">
          ${button("hit", "עוד קלף", "")}
          ${button("stand", "עצור", "stand")}
          ${button("double", "הכפל", "double")}
          ${button("split", "פצל", "split")}
        </div>
      </div>`;
  }
  if (state.phase === "lobby") return dockWrap("ממתינים לדילר", "הסיבוב ייפתח כשהדילר ילחץ על פתיחת סיבוב.", "");
  if (state.phase === "results") return dockWrap("הסיבוב נגמר", "היתרה נשמרת. הימורים לסיבוב הבא נפתחים אוטומטית.", "");
  if (state.phase === "dealer") return dockWrap("הדילר משחק", "עוד רגע יופיעו התוצאות.", "");
  const name = playerName(state, state.turn?.playerId);
  return dockWrap("ממתינים", name ? `תור של ${name}` : "עוד לא התור שלכם", "");
}

function dockWrap(title, body, extra) {
  return `<div class="dock-row"><div class="dock-copy"><strong>${esc(title)}</strong><span>${esc(body)}</span></div>${extra || ""}</div>`;
}

function addChip(value) {
  const bankroll = lastState?.you?.bankroll || 0;
  const next = (Number.isFinite(betDraft) ? betDraft : 0) + value;
  betDraft = Math.min(next, bankroll);
  const input = document.getElementById("bet-amount");
  if (input) input.value = betDraft;
}

function playerName(state, id) {
  return state.players.find((player) => player.id === id)?.nickname || "";
}

function centerCopy(state) {
  if (state.phase === "lobby" && state.players.length === 0) {
    return { title: "השולחן מחכה לחברים", body: "שתפו את הקישור. כל מי שנכנס בוחר כינוי וקופת משחק." };
  }
  if (state.phase === "lobby") return { title: "מוכנים לסיבוב?", body: "כשכולם בפנים, פתחו הימורים." };
  if (state.reshuffled) {
    return { title: "ערבוב מחדש", body: `סיבוב ${state.round}. שש חפיסות חדשות וקלף חיתוך אדום.` };
  }
  if (state.phase === "betting") return { title: `סיבוב ${state.round}`, body: "כל שחקן מניח הימור מתוך הקופה." };
  if (state.phase === "acting") {
    const name = playerName(state, state.turn?.playerId);
    return { title: name ? `תור של ${name}` : "תור השחקנים", body: "עוד קלף, עצירה, הכפלה או פיצול." };
  }
  if (state.phase === "dealer") return { title: "הדילר פותח", body: "מושכים עד 16, ועומדים על כל 17." };
  return { title: "תוצאות הסיבוב", body: "המושבים נשארים. הימורים לסיבוב הבא נפתחים אוטומטית." };
}

function withLtrNumbers(raw) {
  return esc(raw).replace(/([+\-−]?\d+(?:\.\d+)?)/g, '<span class="num" dir="ltr">$1</span>');
}

function logItem(text) {
  const splitAt = text.indexOf(": ");
  if (splitAt === -1) return `<li>${withLtrNumbers(text)}</li>`;
  const name = text.slice(0, splitAt);
  const rest = text.slice(splitAt + 2);
  return `<li class="log-line"><bdi class="log-name">${esc(name)}</bdi><span>${withLtrNumbers(rest)}</span></li>`;
}

function announce(state) {
  live.textContent = centerCopy(state).title;
}

function fmt(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(number);
}

function toggleLog() {
  const panel = document.getElementById("log-panel");
  panel.hidden = !panel.hidden;
  const open = !panel.hidden;
  document.querySelectorAll("[data-act='log'][aria-controls]").forEach((el) => {
    el.setAttribute("aria-expanded", String(open));
  });
}

const NARROW_SLOTS = {
  1: [[0.50, 0.72]],
  2: [[0.72, 0.66], [0.26, 0.66]],
  3: [[0.80, 0.42], [0.50, 0.74], [0.20, 0.42]],
  4: [[0.82, 0.34], [0.68, 0.68], [0.32, 0.68], [0.18, 0.34]],
  5: [[0.78, 0.30], [0.84, 0.52], [0.50, 0.76], [0.16, 0.52], [0.22, 0.30]],
  6: [[0.78, 0.28], [0.86, 0.48], [0.66, 0.70], [0.34, 0.70], [0.14, 0.48], [0.22, 0.28]],
  7: [[0.76, 0.26], [0.86, 0.46], [0.72, 0.66], [0.50, 0.80], [0.28, 0.66], [0.14, 0.46], [0.24, 0.26]],
};

let layingOut = false;
let layoutAgain = false;

function layoutTable() {
  if (room.hidden) return;
  if (layingOut) {
    layoutAgain = true;
    return;
  }
  const scene = document.getElementById("table-scene");
  const rail = document.getElementById("rail");
  const center = document.getElementById("center-copy");
  const dealerNode = document.getElementById("dealer-plate");
  if (!scene || !rail || !center || !dealerNode) return;
  layingOut = true;
  try {
    for (let pass = 0; pass < 4; pass += 1) {
      layoutAgain = false;
      const width = scene.clientWidth;
      const height = scene.clientHeight;
      if (width < 40 || height < 40) return;
      const seatNodes = [...scene.querySelectorAll(".seat")];
      const infos = seatNodes.map(readSeatInfo);
      const dealerCount = dealerNode.querySelectorAll(".card").length;
      let scale = 1;
      let plan = buildPlan(width, height, infos, dealerCount, scale);
      for (let attempt = 0; attempt < 6 && !plan.fits; attempt += 1) {
        scale *= 0.88;
        plan = buildPlan(width, height, infos, dealerCount, scale);
      }
      applyPlan(scene, seatNodes, dealerNode, rail, center, plan);
      if (!layoutAgain && scene.clientWidth === width && scene.clientHeight === height) break;
    }
  } finally {
    layingOut = false;
  }
}

function readSeatInfo(seat) {
  const hands = [...seat.querySelectorAll(".hand")];
  const counts = hands.map((hand) => hand.querySelectorAll(".card").length);
  return {
    cards: counts.length ? Math.max(...counts) : 0,
    split: hands.length > 1,
    result: Boolean(seat.querySelector(".result-badge")),
    badge: Boolean(seat.querySelector(".badge")),
    active: seat.classList.contains("active"),
  };
}

function buildPlan(width, height, infos, dealerCount, scale) {
  const count = infos.length;
  const wide = count === 0 || (width >= 640 && width / Math.max(count, 1) >= 100);
  if (count === 0) return planOpen(width, height, dealerCount, scale);
  if (wide) return planWide(width, height, infos, dealerCount, scale);
  return planNarrow(width, height, infos, dealerCount, scale);
}

function planOpen(width, height, dealerCount, scale) {
  const short = height < 470;
  const rx = Math.min(width * 0.42, height * 0.34 * 1.75);
  const ry = rx / 1.75;
  const dealerCard = clamp(16, Math.min(width, height) * (short ? 0.055 : 0.07), short ? 40 : 58);
  const dealerH = estimateDealerHeight(dealerCard, dealerCount > 0);
  const dealerW = Math.min(width * 0.5, fanWidth(dealerCard, Math.max(dealerCount, 2)) + 28);
  return {
    fits: true,
    wide: true,
    cx: width / 2,
    cy: height * 0.54,
    rx,
    ry,
    seats: [],
    dealer: { x: width / 2, y: height * 0.54 - ry, w: dealerW, h: dealerH, card: dealerCard },
    scale,
  };
}

function planWide(width, height, infos, dealerCount, scale) {
  const count = infos.length;
  const margin = 4;
  const short = height < 470;
  const share = (width - margin * 2) / count - 6;
  const seatW = clamp(52 * scale, Math.min(share, (count <= 2 ? width * 0.42 : width * 0.3)) * scale, (short ? 158 : 200) * scale);
  const maxCard = (short ? 44 : 62) * scale;
  const metrics = infos.map((info) => {
    const card = cardForWidth(seatW, info.cards, info.split, maxCard);
    return { card, h: estimateSeatHeight(card, info, false) };
  });
  const seatH = Math.max(...metrics.map((item) => item.h));
  const dealerMaxW = Math.min(width * 0.5, (short ? 360 : 480) * scale);
  const dealerCard = cardForWidth(dealerMaxW, Math.max(dealerCount, 1), false, (short ? 42 : 66) * scale);
  const dealerH = estimateDealerHeight(dealerCard, dealerCount > 0);
  const dealerW = clamp(108 * scale, fanWidth(dealerCard, Math.max(dealerCount, 2)) + 24, dealerMaxW);
  const rx = Math.max(48, width / 2 - seatW / 2 - margin);
  let ry = (height - margin * 2 - dealerH / 2 - seatH / 2) / 2;
  if (ry > rx / 1.62) ry = rx / 1.62;
  ry = Math.max(32, ry);
  const cyMin = margin + ry + dealerH / 2;
  const cyMax = height - margin - ry - seatH / 2;
  const cy = (cyMin + cyMax) / 2;
  const cx = width / 2;
  const seats = infos.map((info, index) => {
    const t = count === 1 ? 0.5 : index / (count - 1);
    const x = (width - margin - seatW / 2) - t * (width - margin * 2 - seatW);
    const nx = clamp(-1, (x - cx) / rx, 1);
    const y = cy + Math.sqrt(Math.max(0, 1 - nx * nx)) * ry;
    return { x, y, w: seatW, h: metrics[index].h, card: metrics[index].card };
  });
  const dealer = { x: cx, y: cy - ry, w: dealerW, h: dealerH, card: dealerCard };
  const fits = cyMax >= cyMin - 0.5 && !boxesCollide([...seats, dealer], width, height, 2);
  return { fits, wide: true, cx, cy, rx, ry, seats, dealer, scale };
}

function planNarrow(width, height, infos, dealerCount, scale) {
  const count = infos.length;
  const slots = (NARROW_SLOTS[Math.min(count, 7)] || NARROW_SLOTS[7]).slice(0, count);
  let lo = 30 * scale;
  let hi = Math.min(width * 0.34, 150 * scale);
  let best = null;
  for (let step = 0; step < 18; step += 1) {
    const seatW = (lo + hi) / 2;
    const seats = infos.map((info, index) => {
      const card = cardForWidth(seatW, info.cards, info.split, 54 * scale);
      return {
        x: slots[index][0] * width,
        y: slots[index][1] * height,
        w: seatW,
        h: estimateSeatHeight(card, info, true),
        card,
      };
    });
    const dealerW = Math.min(width * 0.74, Math.max(140 * scale, seatW * 2.2));
    const dealerCard = cardForWidth(dealerW, Math.max(dealerCount, 1), false, Math.min(40, height * 0.065) * scale);
    const dealerH = estimateDealerHeight(dealerCard, dealerCount > 0);
    const dealer = { x: width / 2, y: dealerH / 2 + 2, w: dealerW, h: dealerH, card: dealerCard };
    if (boxesCollide([...seats, dealer], width, height, 2)) hi = seatW;
    else {
      best = { seats, dealer };
      lo = seatW;
    }
  }
  if (!best) return { fits: false, wide: false, seats: [], dealer: { x: width / 2, y: 40, w: 140, h: 70, card: 24 }, cx: width / 2, cy: height / 2, rx: width * 0.3, ry: width * 0.18, scale };
  const rx = Math.min(width * 0.47, width / 2 - 6);
  const ry = Math.min(rx / 1.4, height * 0.34);
  const cy = clamp(best.dealer.y + best.dealer.h / 2 + ry * 0.15, height * 0.48, height - ry - 4);
  return { fits: true, wide: false, cx: width / 2, cy, rx, ry, seats: best.seats, dealer: best.dealer, scale };
}

function applyPlan(scene, seatNodes, dealerNode, rail, center, plan) {
  scene.classList.toggle("layout-narrow", !plan.wide);
  scene.classList.toggle("layout-wide", Boolean(plan.wide));
  rail.style.left = `${plan.cx - plan.rx}px`;
  rail.style.top = `${plan.cy - plan.ry}px`;
  rail.style.width = `${plan.rx * 2}px`;
  rail.style.height = `${plan.ry * 2}px`;
  center.style.left = `${plan.cx}px`;
  center.style.top = `${plan.cy + plan.ry * 0.06}px`;
  center.style.width = `${Math.max(90, plan.rx * (plan.wide ? 0.58 : 0.62))}px`;
  placePlate(dealerNode, plan.dealer);
  seatNodes.forEach((node, index) => {
    if (plan.seats[index]) placePlate(node, plan.seats[index]);
  });
  const shoe = document.getElementById("shoe-stack");
  if (shoe) {
    const maxH = Math.max(52, Math.min(128, plan.ry * 0.7));
    shoe.style.setProperty("--shoe-max", `${maxH}px`);
    shoe.style.left = `${plan.cx - plan.rx * 0.58}px`;
    shoe.style.top = `${plan.cy - plan.ry * 0.46}px`;
  }
}

function placePlate(node, box) {
  node.style.left = `${box.x}px`;
  node.style.top = `${box.y}px`;
  node.style.width = `${box.w}px`;
  node.style.setProperty("--card-w", `${box.card}px`);
  node.classList.toggle("tiny-cards", box.card < 30);
}

function cardForWidth(seatW, cards, split, maxCard) {
  const count = Math.max(cards, 1);
  const fans = split ? 2 : 1;
  const fanUnits = 1 + (count - 1) * 0.48;
  const inner = Math.max(12, seatW - 16 - (fans - 1) * 4);
  return clamp(13, inner / (fans * fanUnits), maxCard);
}

function fanWidth(card, count) {
  const n = Math.max(count, 1);
  return card * (1 + Math.max(0, n - 1) * 0.48);
}

function estimateSeatHeight(card, info, compact) {
  const cardH = info.cards > 0 ? card * 1.42 : 16;
  const who = compact ? 32 : 18;
  const meta = info.cards > 0 ? (compact && info.split ? 30 : 16) : 15;
  return who + cardH + meta + (info.badge ? 15 : 0) + (info.result ? 15 : 0) + (info.active ? 14 : 0) + 8;
}

function estimateDealerHeight(card, hasCards) {
  return 16 + (hasCards ? card * 1.42 : 16) + 12;
}

function boxesCollide(rects, width, height, pad = 2) {
  for (let i = 0; i < rects.length; i += 1) {
    const a = rects[i];
    if (a.x - a.w / 2 < 1 || a.x + a.w / 2 > width - 1 || a.y - a.h / 2 < 1 || a.y + a.h / 2 > height - 1) return true;
    for (let j = i + 1; j < rects.length; j += 1) {
      const b = rects[j];
      const overlapX = Math.abs(a.x - b.x) < (a.w + b.w) / 2 + pad;
      const overlapY = Math.abs(a.y - b.y) < (a.h + b.h) / 2 + pad;
      if (overlapX && overlapY) return true;
    }
  }
  return false;
}

function clamp(min, value, max) {
  return Math.max(min, Math.min(max, value));
}

const tableScene = document.getElementById("table-scene");
if (tableScene && "ResizeObserver" in window) {
  const observer = new ResizeObserver(() => {
    if (!layingOut) layoutTable();
  });
  observer.observe(tableScene);
}
window.addEventListener("resize", () => layoutTable());
window.addEventListener("orientationchange", () => layoutTable());
if (window.visualViewport) window.visualViewport.addEventListener("resize", () => layoutTable());

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}
