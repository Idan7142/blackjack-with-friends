/**
 * Server-authoritative blackjack rules.
 *
 * DEALER_HITS_SOFT_17 is false: the dealer stands on soft 17.
 * Blackjack (a natural ace + ten on the first two cards) pays 3:2.
 * A two-card 21 after a split is not a natural and pays 1:1.
 * One split only, same rank (king-king, not king-10). Split aces get one card.
 * Double is allowed on the first action of a two-card hand, including after a split
 * (not on split aces). No insurance, no surrender.
 * The shoe is 6 decks with a red cut card inserted at 60–75% of the way through.
 * A cut card that appears mid-round is set aside; the round finishes from the cards
 * still behind it, and the full shoe is rebuilt before the next round. If the next
 * card at the end of a round is the cut card, the shoe is rebuilt immediately.
 */

export const DEALER_HITS_SOFT_17 = false;

export const RULES = Object.freeze({
  decks: 6,
  cutCardMin: 0.6,
  cutCardMax: 0.75,
  dealerHitsSoft17: DEALER_HITS_SOFT_17,
  blackjackPays: 1.5,
  minBet: 10,
  maxPlayers: 7,
  minBankroll: 100,
  maxBankroll: 100000,
  maxSplits: 1,
  doubleAfterSplit: true,
  hitSplitAces: false,
});

const SUITS = ["H", "D", "C", "S"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

export function chips(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function formatMoney(n) {
  const value = chips(n);
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1);
}

export function cleanName(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 16);
}

function fail(error) {
  return { ok: false, error };
}

function ok(extra = {}) {
  return { ok: true, ...extra };
}

export function handValue(cards) {
  if (!cards || cards.length === 0) {
    return { total: 0, soft: false, bust: false, blackjack: false };
  }
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    if (card.rank === "A") {
      aces += 1;
      total += 11;
    } else if (card.rank === "J" || card.rank === "Q" || card.rank === "K") {
      total += 10;
    } else {
      total += Number(card.rank);
    }
  }
  let softAces = aces;
  while (total > 21 && softAces > 0) {
    total -= 10;
    softAces -= 1;
  }
  const soft = softAces > 0 && total <= 21;
  return {
    total,
    soft,
    bust: total > 21,
    blackjack: cards.length === 2 && total === 21,
  };
}

export function isNatural(hand) {
  return Boolean(hand && !hand.fromSplit && hand.cards.length === 2 && handValue(hand.cards).blackjack);
}

export function dealerShouldHit(cards) {
  const value = handValue(cards);
  if (value.bust || value.total > 17) return false;
  if (value.total < 17) return true;
  return value.soft && DEALER_HITS_SOFT_17;
}

function buildDecks(count) {
  const cards = [];
  for (let deck = 0; deck < count; deck += 1) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        cards.push({ rank, suit, id: `${deck}-${suit}-${rank}` });
      }
    }
  }
  return cards;
}

function shuffle(list, rng) {
  const cards = list.slice();
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

export function createShoe({ rng = Math.random, cards = null, cutIndex = null } = {}) {
  const real = cards ? cards.map((card) => ({ ...card })) : shuffle(buildDecks(RULES.decks), rng);
  const count = real.length;
  let index = cutIndex;
  if (index == null) {
    const ratio = RULES.cutCardMin + rng() * (RULES.cutCardMax - RULES.cutCardMin);
    index = Math.round(count * ratio);
  }
  index = Number(index);
  if (count > 1) index = Math.min(Math.max(index, 1), count - 1);
  else index = 0;
  const shoeCards = real.map((card) => ({ ...card }));
  shoeCards.splice(index, 0, { cut: true, id: "CUT" });
  return {
    cards: shoeCards,
    cutReached: false,
    cutIndex: index,
    realCount: count,
  };
}

function log(table, text) {
  table.log.push({ text, t: Date.now() });
  if (table.log.length > 40) table.log.splice(0, table.log.length - 40);
}

function cardsInPlay(table) {
  const ids = new Set();
  for (const card of table.dealerCards) ids.add(card.id);
  for (const player of table.players) {
    for (const hand of player.hands) {
      for (const card of hand.cards) ids.add(card.id);
    }
  }
  return ids;
}

function refillDiscards(table) {
  const inPlay = cardsInPlay(table);
  const fresh = shuffle(
    buildDecks(RULES.decks).filter((card) => !inPlay.has(card.id)),
    table.rng,
  );
  table.shoe.cards = fresh;
  table.shoe.cutReached = true;
  log(table, "הנעל נגמרה באמצע הסיבוב — הקלפים שכבר ירדו עורבבו");
}

/** Draw the next real card. A cut card is set aside, never dealt, and marks a later reshuffle. */
export function drawCard(table) {
  const pull = () => {
    while (table.shoe.cards[0]?.cut) {
      table.shoe.cards.shift();
      table.shoe.cutReached = true;
    }
    if (table.shoe.cards.length === 0) refillDiscards(table);
    while (table.shoe.cards[0]?.cut) {
      table.shoe.cards.shift();
      table.shoe.cutReached = true;
    }
    if (table.shoe.cards.length === 0) refillDiscards(table);
    const card = table.shoe.cards.shift();
    if (!card || card.cut) throw new Error("shoe failed to deal a card");
    return card;
  };
  return pull();
}

export function createTable({ code = "TABLE", dealerName = "הדילר", rng = Math.random } = {}) {
  const random = typeof rng === "function" ? rng : Math.random;
  const name = cleanName(dealerName) || "הדילר";
  return {
    code,
    dealerName: name,
    dealerConnected: true,
    rng: random,
    shoe: createShoe({ rng: random }),
    players: [],
    phase: "lobby",
    round: 0,
    dealerCards: [],
    holeHidden: true,
    turn: null,
    log: [],
    reshuffled: false,
    resolving: false,
    autoStandAt: null,
    settledRound: 0,
  };
}

function playerById(table, playerId) {
  return table.players.find((player) => player.id === playerId) || null;
}

function makeHand(bet, extra = {}) {
  return {
    cards: [],
    bet,
    status: "playing",
    fromSplit: false,
    splitAces: false,
    doubled: false,
    result: null,
    net: 0,
    ...extra,
  };
}

export function addPlayer(table, { id, nickname, bankroll }) {
  if (!id) return fail("שחקן לא תקין");
  if (table.players.some((player) => player.id === id)) return fail("כבר בשולחן");
  if (table.players.length >= RULES.maxPlayers) return fail(`השולחן מלא (עד ${RULES.maxPlayers} שחקנים)`);
  const name = cleanName(nickname);
  if (!name) return fail("צריך כינוי");
  const money = Number(bankroll);
  if (!Number.isInteger(money) || money < RULES.minBankroll || money > RULES.maxBankroll) {
    return fail(`קופת הפתיחה היא בין ${formatMoney(RULES.minBankroll)} ל-${formatMoney(RULES.maxBankroll)}`);
  }
  table.players.push({
    id,
    nickname: name,
    bankroll: money,
    connected: true,
    bet: 0,
    committed: false,
    sittingOut: false,
    inRound: false,
    leaving: false,
    hands: [],
  });
  log(table, `${name} הצטרף לשולחן · קופה ${formatMoney(money)}`);
  return ok();
}

function shoeNeedsRebuild(table) {
  return table.shoe.cutReached || Boolean(table.shoe.cards[0]?.cut);
}

function rebuildShoe(table) {
  table.shoe = createShoe({ rng: table.rng });
  table.reshuffled = true;
  log(table, "ערבוב מחדש");
}

export function openBetting(table) {
  if (table.resolving) return fail("הסיבוב הקודם עוד נסגר");
  if (table.phase !== "lobby" && table.phase !== "results") return fail("אי אפשר לפתוח סיבוב עכשיו");
  table.players = table.players.filter((player) => !player.leaving);
  const eligible = table.players.filter((player) => player.connected && player.bankroll >= RULES.minBet);
  if (eligible.length === 0) return fail("אין שחקן מחובר עם יתרה להימור");
  if (shoeNeedsRebuild(table)) {
    rebuildShoe(table);
  } else if (!table.reshuffled) {
    table.reshuffled = false;
  }
  table.round += 1;
  table.phase = "betting";
  table.dealerCards = [];
  table.holeHidden = true;
  table.turn = null;
  table.autoStandAt = null;
  for (const player of table.players) {
    player.bet = 0;
    player.committed = false;
    player.sittingOut = false;
    player.inRound = false;
    player.hands = [];
    player.leaving = false;
  }
  log(table, `סיבוב ${table.round} — הימורים פתוחים`);
  return ok();
}

function parseAmount(amount) {
  if (typeof amount === "string" && /^\d+$/.test(amount.trim())) amount = Number(amount.trim());
  if (typeof amount !== "number" || !Number.isInteger(amount)) return null;
  return amount;
}

export function placeBet(table, playerId, amount) {
  if (table.phase !== "betting") return fail("ההימורים סגורים");
  const player = playerById(table, playerId);
  if (!player) return fail("לא בשולחן");
  const parsed = parseAmount(amount);
  if (parsed == null || parsed <= 0) return fail("סכום לא תקין");
  if (parsed < RULES.minBet) return fail(`ההימור המינימלי הוא ${RULES.minBet}`);
  if (player.committed) {
    player.bankroll = chips(player.bankroll + player.bet);
    player.bet = 0;
    player.committed = false;
  }
  if (parsed > player.bankroll) return fail("אין מספיק יתרה להימור הזה");
  player.bankroll = chips(player.bankroll - parsed);
  player.bet = parsed;
  player.committed = true;
  player.sittingOut = false;
  log(table, `${player.nickname}: הימור ${formatMoney(parsed)}`);
  return ok();
}

export function sitOut(table, playerId) {
  if (table.phase !== "betting") return fail("אפשר לדלג רק בשלב ההימורים");
  const player = playerById(table, playerId);
  if (!player) return fail("לא בשולחן");
  if (player.committed) {
    player.bankroll = chips(player.bankroll + player.bet);
    player.bet = 0;
    player.committed = false;
  }
  player.sittingOut = true;
  log(table, `${player.nickname}: בלי הימור בסיבוב הזה`);
  return ok();
}

export function sitIn(table, playerId) {
  if (table.phase !== "betting") return fail("ההימורים סגורים");
  const player = playerById(table, playerId);
  if (!player) return fail("לא בשולחן");
  player.sittingOut = false;
  return ok();
}

export function readyToDeal(table) {
  if (table.phase !== "betting") return false;
  const committed = table.players.some((player) => player.committed && player.bet >= RULES.minBet);
  if (!committed) return false;
  const waiting = table.players.some((player) => {
    if (!player.connected || player.sittingOut || player.committed) return false;
    return player.bankroll >= RULES.minBet;
  });
  return !waiting;
}

function findTurn(table) {
  for (const player of table.players) {
    if (!player.inRound) continue;
    for (let handIndex = 0; handIndex < player.hands.length; handIndex += 1) {
      if (player.hands[handIndex].status === "playing") return { playerId: player.id, handIndex };
    }
  }
  return null;
}

function afterDeal(table) {
  if (handValue(table.dealerCards).blackjack) {
    table.holeHidden = false;
    table.phase = "dealer";
    table.turn = null;
    log(table, "בלאקג'ק לדילר");
    return ok({ roundComplete: true });
  }
  for (const player of table.players) {
    if (!player.inRound) continue;
    if (isNatural(player.hands[0])) {
      player.hands[0].status = "blackjack";
      log(table, `${player.nickname}: בלאקג'ק`);
    }
  }
  const next = findTurn(table);
  if (!next) {
    table.holeHidden = false;
    table.phase = "dealer";
    table.turn = null;
    return ok({ roundComplete: true });
  }
  table.phase = "acting";
  table.turn = next;
  return ok({ roundComplete: false });
}

export function deal(table) {
  if (table.phase !== "betting") return fail("החלוקה לא פתוחה");
  const bettors = table.players.filter((player) => player.committed && player.bet >= RULES.minBet);
  if (bettors.length === 0) return fail("אף אחד עוד לא הימר");
  table.dealerCards = [];
  table.holeHidden = true;
  for (const player of table.players) {
    player.hands = [];
    player.inRound = false;
    if (player.committed && player.bet >= RULES.minBet) {
      player.inRound = true;
      player.hands = [makeHand(player.bet)];
    }
  }
  for (let pass = 0; pass < 2; pass += 1) {
    for (const player of table.players) {
      if (!player.inRound) continue;
      player.hands[0].cards.push(drawCard(table));
    }
    table.dealerCards.push(drawCard(table));
  }
  table.reshuffled = false;
  log(table, "הקלפים חולקו");
  return afterDeal(table);
}

function canDouble(player, hand) {
  if (!hand || hand.status !== "playing" || hand.cards.length !== 2) return false;
  if (hand.splitAces) return false;
  if (hand.fromSplit && !RULES.doubleAfterSplit) return false;
  return player.bankroll >= hand.bet;
}

function canSplit(player, hand) {
  if (!hand || hand.status !== "playing" || hand.cards.length !== 2) return false;
  if (hand.fromSplit || hand.splitAces) return false;
  if (player.hands.length >= RULES.maxSplits + 1) return false;
  if (hand.cards[0].rank !== hand.cards[1].rank) return false;
  return player.bankroll >= hand.bet;
}

export function legalActions(table, playerId) {
  if (table.phase !== "acting" || !table.turn || table.turn.playerId !== playerId) return [];
  const player = playerById(table, playerId);
  if (!player) return [];
  const hand = player.hands[table.turn.handIndex];
  if (!hand || hand.status !== "playing") return [];
  const actions = ["hit", "stand"];
  if (canDouble(player, hand)) actions.push("double");
  if (canSplit(player, hand)) actions.push("split");
  return actions;
}

function finishTurn(table) {
  const next = findTurn(table);
  if (next) {
    table.turn = next;
    table.phase = "acting";
    return ok({ roundComplete: false });
  }
  table.turn = null;
  table.phase = "dealer";
  table.autoStandAt = null;
  return ok({ roundComplete: true });
}

export function act(table, playerId, action) {
  if (table.phase !== "acting") return fail("אי אפשר לפעול עכשיו");
  if (!table.turn || table.turn.playerId !== playerId) return fail("לא תורך");
  const allowed = legalActions(table, playerId);
  if (!allowed.includes(action)) return fail("הפעולה לא זמינה");
  const player = playerById(table, playerId);
  const handIndex = table.turn.handIndex;
  const hand = player.hands[handIndex];

  if (action === "hit") {
    hand.cards.push(drawCard(table));
    const value = handValue(hand.cards);
    if (value.bust) {
      hand.status = "bust";
      log(table, `${player.nickname}: שריפה`);
    } else if (value.total === 21) {
      hand.status = "stand";
      log(table, `${player.nickname}: 21`);
    } else {
      log(table, `${player.nickname}: עוד קלף`);
    }
  } else if (action === "stand") {
    hand.status = "stand";
    log(table, `${player.nickname}: עצירה`);
  } else if (action === "double") {
    player.bankroll = chips(player.bankroll - hand.bet);
    hand.bet = chips(hand.bet * 2);
    hand.doubled = true;
    hand.cards.push(drawCard(table));
    const value = handValue(hand.cards);
    hand.status = value.bust ? "bust" : "stand";
    log(table, `${player.nickname}: הכפלה ל-${formatMoney(hand.bet)}`);
    if (value.bust) log(table, `${player.nickname}: שריפה`);
  } else if (action === "split") {
    const [first, second] = hand.cards;
    player.bankroll = chips(player.bankroll - hand.bet);
    const aces = first.rank === "A";
    const left = makeHand(hand.bet, { fromSplit: true, splitAces: aces, cards: [first] });
    const right = makeHand(hand.bet, { fromSplit: true, splitAces: aces, cards: [second] });
    left.cards.push(drawCard(table));
    right.cards.push(drawCard(table));
    if (aces && !RULES.hitSplitAces) {
      left.status = "stand";
      right.status = "stand";
    } else {
      if (handValue(left.cards).total === 21) left.status = "stand";
      if (handValue(right.cards).total === 21) right.status = "stand";
    }
    player.hands.splice(handIndex, 1, left, right);
    log(table, `${player.nickname}: פיצול`);
  } else {
    return fail("הפעולה לא זמינה");
  }

  return finishTurn(table);
}

export function needsDealerDraw(table) {
  if (handValue(table.dealerCards).blackjack) return false;
  return table.players.some((player) => player.inRound && player.hands.some((hand) => {
    if (hand.status === "bust" || handValue(hand.cards).bust) return false;
    if (isNatural(hand)) return false;
    return true;
  }));
}

function outcomeFor(hand, dealerCards) {
  const player = handValue(hand.cards);
  const dealer = handValue(dealerCards);
  const bet = hand.bet;
  const natural = isNatural(hand);
  const dealerNatural = dealer.blackjack;
  const pay = (result, payout) => ({ result, payout: chips(payout), net: chips(payout - bet) });
  if (player.bust) return pay("bust", 0);
  if (natural && dealerNatural) return pay("push", bet);
  if (natural) return pay("blackjack", bet * 2.5);
  if (dealerNatural) return pay("lose", 0);
  if (dealer.bust) return pay("win", bet * 2);
  if (player.total > dealer.total) return pay("win", bet * 2);
  if (player.total < dealer.total) return pay("lose", 0);
  return pay("push", bet);
}

function resultLine(player, outcome) {
  const labels = {
    blackjack: "בלאקג'ק",
    win: "ניצחון",
    lose: "הפסד",
    push: "תיקו",
    bust: "שריפה",
  };
  if (outcome.result === "push") return `${player.nickname}: תיקו`;
  const sign = outcome.net > 0 ? "+" : "";
  return `${player.nickname}: ${labels[outcome.result]} ${sign}${formatMoney(outcome.net)}`;
}

export function settle(table) {
  if (table.phase === "results" && table.settledRound === table.round) return ok();
  table.holeHidden = false;
  for (const player of table.players) {
    if (!player.inRound) continue;
    for (const hand of player.hands) {
      const outcome = outcomeFor(hand, table.dealerCards);
      hand.result = outcome.result;
      hand.net = outcome.net;
      player.bankroll = chips(player.bankroll + outcome.payout);
      log(table, resultLine(player, outcome));
    }
  }
  table.phase = "results";
  table.turn = null;
  table.autoStandAt = null;
  table.settledRound = table.round;
  if (table.shoe.cards[0]?.cut) rebuildShoe(table);
  return ok();
}

export function completeDealer(table) {
  if (table.phase === "results") return ok();
  table.phase = "dealer";
  table.turn = null;
  table.holeHidden = false;
  if (needsDealerDraw(table)) {
    while (dealerShouldHit(table.dealerCards)) {
      table.dealerCards.push(drawCard(table));
    }
  }
  return settle(table);
}

export function removePlayer(table, playerId) {
  const player = playerById(table, playerId);
  if (!player) return fail("השחקן לא נמצא");
  if (table.phase === "betting" && player.committed) {
    player.bankroll = chips(player.bankroll + player.bet);
    player.bet = 0;
    player.committed = false;
  }
  if ((table.phase === "acting" || table.phase === "dealer") && player.inRound) {
    let stood = false;
    for (const hand of player.hands) {
      if (hand.status === "playing") {
        hand.status = "stand";
        stood = true;
      }
    }
    if (stood) log(table, `${player.nickname} יצא — הידיים נעצרו`);
    player.leaving = true;
    if (table.phase === "acting") return finishTurn(table);
    return ok({ roundComplete: false, removed: false });
  }
  table.players = table.players.filter((item) => item.id !== playerId);
  log(table, `${player.nickname} עזב את השולחן`);
  return ok({ roundComplete: false, removed: true });
}

function publicCard(card) {
  return { rank: card.rank, suit: card.suit };
}

function dealerViewCards(table) {
  return table.dealerCards.map((card, index) => {
    if (table.holeHidden && index === 1) return { faceDown: true };
    return publicCard(card);
  });
}

function dealerViewTotal(table) {
  if (table.dealerCards.length === 0) return null;
  const cards = table.holeHidden ? table.dealerCards.slice(0, 1) : table.dealerCards;
  return handValue(cards);
}

function shoePublic(table) {
  const cards = table.shoe.cards;
  const cutAt = cards.findIndex((card) => card.cut);
  return {
    remaining: cards.filter((card) => !card.cut).length,
    total: RULES.decks * 52,
    decks: RULES.decks,
    cutReached: table.shoe.cutReached,
    cutInShoe: cutAt >= 0,
    cutFromFront: cutAt >= 0 ? cutAt : null,
  };
}

export function publicView(table, viewer = null) {
  const youId = viewer?.role === "player" ? viewer.id : null;
  let you;
  if (viewer?.role === "dealer") {
    you = {
      role: "dealer",
      name: table.dealerName,
      canOpen: (table.phase === "lobby" || table.phase === "results") && !table.resolving,
      canDeal: table.phase === "betting" && !table.resolving,
    };
  } else if (viewer?.role === "player") {
    const player = playerById(table, viewer.id);
    you = {
      role: "player",
      id: viewer.id,
      nickname: player?.nickname ?? "",
      bankroll: player?.bankroll ?? 0,
      committed: Boolean(player?.committed),
      bet: player?.bet ?? 0,
      sittingOut: Boolean(player?.sittingOut),
      connected: Boolean(player?.connected),
      legalActions: legalActions(table, viewer.id),
      yourTurn: Boolean(table.turn && table.turn.playerId === viewer.id),
    };
  } else {
    you = { role: "spectator" };
  }

  const waitingFor = table.phase === "betting"
    ? table.players
      .filter((player) => player.connected && !player.sittingOut && !player.committed && player.bankroll >= RULES.minBet)
      .map((player) => player.nickname)
    : [];

  return {
    code: table.code,
    phase: table.phase,
    round: table.round,
    reshuffled: Boolean(table.reshuffled),
    you,
    dealer: {
      name: table.dealerName,
      connected: table.dealerConnected,
      cards: dealerViewCards(table),
      total: dealerViewTotal(table)?.total ?? null,
      soft: dealerViewTotal(table)?.soft ?? false,
      bust: dealerViewTotal(table)?.bust ?? false,
      blackjack: !table.holeHidden && handValue(table.dealerCards).blackjack,
      holeHidden: table.holeHidden,
    },
    players: table.players.map((player) => ({
      id: player.id,
      nickname: player.nickname,
      bankroll: player.bankroll,
      connected: player.connected,
      committed: player.committed,
      sittingOut: player.sittingOut,
      bet: player.bet,
      inRound: player.inRound,
      leaving: player.leaving,
      isYou: player.id === youId,
      hands: player.hands.map((hand, handIndex) => {
        const value = handValue(hand.cards);
        return {
          cards: hand.cards.map(publicCard),
          bet: hand.bet,
          status: hand.status,
          result: hand.result,
          net: hand.net,
          total: value.total,
          soft: value.soft,
          bust: value.bust,
          blackjack: isNatural(hand) || hand.status === "blackjack",
          doubled: hand.doubled,
          fromSplit: hand.fromSplit,
          active: Boolean(table.turn && table.turn.playerId === player.id && table.turn.handIndex === handIndex),
        };
      }),
    })),
    shoe: shoePublic(table),
    turn: table.turn
      ? { playerId: table.turn.playerId, handIndex: table.turn.handIndex, autoStandAt: table.autoStandAt }
      : null,
    waitingFor,
    log: table.log.slice(-20),
    rules: {
      decks: RULES.decks,
      minBet: RULES.minBet,
      blackjack: "3:2",
      soft17: DEALER_HITS_SOFT_17 ? "hit" : "stand",
      minBankroll: RULES.minBankroll,
      maxBankroll: RULES.maxBankroll,
      maxPlayers: RULES.maxPlayers,
    },
  };
}
