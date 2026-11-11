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
  renderShoe(state);
  const nextFelt = feltSignature(state);
  if (nextFelt !== feltSig) {
    feltSig = nextFelt;
    felt.innerHTML = renderFelt(state);
    announce(state);
  }
  renderLog(state);
  renderDock(state);
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
    you: state.you.role === "player" ? state.you.id : state.you.role,
  });
}

function renderShoe(state) {
  const hot = state.shoe.cutReached;
  const status = hot ? "קלף אדום נמשך · ערבוב אחרי הסיבוב" : "קלף אדום בנעל";
  document.getElementById("shoe-readout").innerHTML = `
    <div class="shoe-count"><b class="num">${fmt(state.shoe.remaining)}</b><span>קלפים בנעל</span></div>
    <span class="cut-pill ${hot ? "hot" : ""}">${status}</span>`;
}

function renderFelt(state) {
  const copy = centerCopy(state);
  const deadline = state.turn?.autoStandAt
    ? `<div id="deadline" class="warn-banner">עצירה אוטומטית</div>`
    : "";
  const offline = state.dealer.connected ? "" : `<div class="warn-banner">הדילר מנותק. השולחן מחכה לחיבור מחדש.</div>`;
  return `
    ${dealerHtml(state)}
    <div class="center-copy">
      <h2>${esc(copy.title)}</h2>
      <p>${esc(copy.body)}</p>
      ${offline}
      ${deadline}
    </div>
    <div class="seats">${state.players.map((player) => seatHtml(state, player)).join("") || emptySeat()}</div>`;
}

function emptySeat() {
  return `<div class="seat"><div class="who"><strong>עדיין אין שחקנים</strong></div><p>שתפו את הקישור כדי שחברים ייכנסו.</p></div>`;
}

function dealerHtml(state) {
  const dealer = state.dealer;
  const faceUp = dealer.cards.filter((card) => !card.faceDown).length;
  const total = faceUp >= 2 ? handLabel(dealer, true) : "";
  return `
    <div class="dealer-plate">
      <div class="who"><strong>דילר · ${esc(dealer.name)}</strong>${total ? `<span class="total-badge">${total}</span>` : ""}</div>
      <div class="hand-cards">${dealer.cards.map((card, index) => cardHtml(state, `dealer`, index, card)).join("") || `<span>מחכה לחלוקה</span>`}</div>
    </div>`;
}

function seatHtml(state, player) {
  const classes = ["seat"];
  if (player.hands.some((hand) => hand.active)) classes.push("active");
  if (player.isYou) classes.push("you");
  if (!player.connected) classes.push("offline");
  const badge = player.isYou ? " · אתם" : "";
  const status = !player.connected ? "מנותק" : player.sittingOut ? "בלי הימור" : "";
  const hands = player.hands.length
    ? `<div class="hand-row">${player.hands.map((hand, index) => handHtml(state, player, hand, index)).join("")}</div>`
    : `<p>${player.committed ? `הימור ${fmt(player.bet)}` : "ממתין"}</p>`;
  return `
    <article class="${classes.join(" ")}">
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
      <div class="hand-meta"><span class="total-badge">${handLabel(hand, false)}</span><span>הימור <span class="num">${fmt(hand.bet)}</span></span></div>
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
      "רק אתם פותחים סיבוב חדש.",
      `<button type="button" class="primary" data-act="open" ${disabled}>פתיחת סיבוב</button>`,
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
        <div class="dock-copy"><strong>${state.you.committed ? "ההימור נעול" : "הניחו הימור"}</strong><span>יתרה <b class="num">${fmt(state.you.bankroll)}</b> · מינימום ${min}</span></div>
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
  if (state.phase === "results") return dockWrap("הסיבוב נגמר", "היתרה עודכנה. מחכים לסיבוב הבא.", "");
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
  if (state.phase === "betting" && state.reshuffled) {
    return { title: "הנעל עורבבה מחדש", body: "קלף החיתוך האדום יצא. שלוש חפיסות חדשות על השולחן." };
  }
  if (state.phase === "betting") return { title: `סיבוב ${state.round}`, body: "כל שחקן מניח הימור מתוך הקופה." };
  if (state.phase === "acting") {
    const name = playerName(state, state.turn?.playerId);
    return { title: name ? `תור של ${name}` : "תור השחקנים", body: "עוד קלף, עצירה, הכפלה או פיצול." };
  }
  if (state.phase === "dealer") return { title: "הדילר פותח", body: "מושכים עד 16, ועומדים על כל 17." };
  return { title: "תוצאות הסיבוב", body: "בלאקג'ק משלם 3:2. תיקו מחזיר את ההימור." };
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

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}
