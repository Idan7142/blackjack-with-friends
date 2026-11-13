import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEALER_HITS_SOFT_17,
  RULES,
  act,
  addPlayer,
  completeDealer,
  createShoe,
  createTable,
  deal,
  dealerShouldHit,
  drawCard,
  handValue,
  isNatural,
  legalActions,
  openBetting,
  placeBet,
  publicView,
  removePlayer,
  sitOut,
} from "../src/engine.js";

function mulberry32(seed) {
  let value = seed >>> 0;
  return function rng() {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let cardSerial = 0;
function C(rank, suit) {
  cardSerial += 1;
  return { rank, suit, id: `c${cardSerial}-${rank}${suit}` };
}

function freshTable(cards, players, { cutIndex, bankroll = 1000 } = {}) {
  const table = createTable({ code: "T", dealerName: "דילר", rng: mulberry32(7) });
  table.shoe = createShoe({
    cards,
    cutIndex: cutIndex ?? Math.max(cards.length - 1, 0),
  });
  players.forEach((player, index) => {
    const added = addPlayer(table, {
      id: player.id,
      nickname: player.nickname,
      bankroll: player.bankroll ?? bankroll,
    });
    assert.equal(added.ok, true, added.error);
    assert.equal(table.players[index].id, player.id);
  });
  const opened = openBetting(table);
  assert.equal(opened.ok, true, opened.error);
  assert.equal(table.shoe.cards.some((card) => card.id === cards[0].id), true);
  return table;
}

function bet(table, id, amount) {
  const result = placeBet(table, id, amount);
  assert.equal(result.ok, true, result.error);
}

describe("hand values and aces", () => {
  it("scores tens, faces, and soft and hard aces", () => {
    assert.deepEqual(handValue([C("A", "H"), C("K", "S")]), {
      total: 21, soft: true, bust: false, blackjack: true,
    });
    assert.equal(handValue([C("A", "H"), C("6", "S")]).soft, true);
    assert.equal(handValue([C("A", "H"), C("6", "S")]).total, 17);
    const hard17 = handValue([C("A", "H"), C("6", "D"), C("K", "C")]);
    assert.equal(hard17.total, 17);
    assert.equal(hard17.soft, false);
    assert.equal(hard17.bust, false);
    const soft13 = handValue([C("A", "H"), C("A", "D"), C("A", "C")]);
    assert.equal(soft13.total, 13);
    assert.equal(soft13.soft, true);
    assert.equal(handValue([C("K", "H"), C("6", "S"), C("A", "D")]).total, 17);
    assert.equal(handValue([C("A", "S"), C("9", "H"), C("A", "C")]).total, 21);
    assert.equal(handValue([C("10", "H"), C("10", "D"), C("2", "C")]).bust, true);
    assert.equal(handValue([C("J", "H"), C("Q", "D")]).total, 20);
    assert.equal(handValue([C("9", "H"), C("7", "C"), C("5", "D")]).blackjack, false);
  });

  it("stands on soft 17 in a full round and hits hard 16", () => {
    const soft = freshTable(
      [C("10", "H"), C("A", "D"), C("9", "C"), C("6", "S"), C("K", "H")],
      [{ id: "p1", nickname: "נועה" }],
    );
    bet(soft, "p1", 10);
    deal(soft);
    act(soft, "p1", "stand");
    completeDealer(soft);
    assert.equal(soft.dealerCards.length, 2);
    assert.equal(handValue(soft.dealerCards).total, 17);
    assert.equal(handValue(soft.dealerCards).soft, true);
    assert.equal(soft.players[0].hands[0].result, "win");

    const hard = freshTable(
      [C("10", "H"), C("10", "D"), C("8", "C"), C("6", "S"), C("5", "H")],
      [{ id: "p1", nickname: "נועה" }],
    );
    bet(hard, "p1", 10);
    deal(hard);
    act(hard, "p1", "stand");
    completeDealer(hard);
    assert.equal(hard.dealerCards.length, 3);
    assert.equal(handValue(hard.dealerCards).total, 21);
    assert.equal(hard.players[0].hands[0].result, "lose");
  });

  it("stands on soft 17 and hits hard 16", () => {
    assert.equal(DEALER_HITS_SOFT_17, false);
    assert.equal(RULES.dealerHitsSoft17, false);
    assert.equal(dealerShouldHit([C("A", "H"), C("6", "S")]), false);
    assert.equal(dealerShouldHit([C("A", "H"), C("5", "S")]), true);
    assert.equal(dealerShouldHit([C("10", "H"), C("6", "S")]), true);
    assert.equal(dealerShouldHit([C("10", "H"), C("7", "S")]), false);
    assert.equal(dealerShouldHit([C("A", "H"), C("6", "S"), C("10", "D")]), false);
    assert.equal(dealerShouldHit([C("K", "H"), C("A", "S")]), false);
  });
});

describe("dealing, payouts, doubles, and splits", () => {
  it("pays a natural blackjack 3:2 and does not let that player act", () => {
    const cards = [C("A", "H"), C("9", "C"), C("K", "H"), C("8", "D"), C("2", "S")];
    const table = freshTable(cards, [{ id: "p1", nickname: "נועה" }]);
    bet(table, "p1", 100);
    const dealt = deal(table);
    assert.equal(dealt.roundComplete, true);
    assert.equal(legalActions(table, "p1").length, 0);
    completeDealer(table);
    const hand = table.players[0].hands[0];
    assert.equal(hand.result, "blackjack");
    assert.equal(hand.net, 150);
    assert.equal(table.players[0].bankroll, 1150);
    assert.equal(table.dealerCards.length, 2);
  });

  it("pays 3:2 on an odd stake without rounding away the half chip", () => {
    const cards = [C("A", "S"), C("9", "D"), C("Q", "H"), C("7", "C")];
    const table = freshTable(cards, [{ id: "p1", nickname: "נועה" }]);
    bet(table, "p1", 25);
    deal(table);
    completeDealer(table);
    assert.equal(table.players[0].hands[0].net, 37.5);
    assert.equal(table.players[0].bankroll, 1037.5);
  });

  it("pushes a natural against a dealer blackjack and takes the other player's stake", () => {
    const cards = [
      C("A", "H"), C("10", "S"), C("A", "D"),
      C("K", "C"), C("9", "H"), C("Q", "S"),
    ];
    const table = freshTable(cards, [
      { id: "p1", nickname: "נועה" },
      { id: "p2", nickname: "יוסי" },
    ]);
    bet(table, "p1", 100);
    bet(table, "p2", 40);
    const dealt = deal(table);
    assert.equal(dealt.roundComplete, true);
    assert.equal(act(table, "p2", "hit").ok, false);
    completeDealer(table);
    assert.equal(table.players[0].hands[0].result, "push");
    assert.equal(table.players[0].bankroll, 1000);
    assert.equal(table.players[1].hands[0].result, "lose");
    assert.equal(table.players[1].bankroll, 960);
    assert.equal(table.dealerCards.length, 2);
  });

  it("returns the stake on a push and pays 1:1 on a win", () => {
    const pushCards = [C("10", "H"), C("9", "C"), C("8", "D"), C("9", "S")];
    const pushTable = freshTable(pushCards, [{ id: "p1", nickname: "נועה" }]);
    bet(pushTable, "p1", 100);
    deal(pushTable);
    act(pushTable, "p1", "stand");
    completeDealer(pushTable);
    assert.equal(pushTable.players[0].hands[0].result, "push");
    assert.equal(pushTable.players[0].bankroll, 1000);

    const winCards = [C("10", "H"), C("10", "C"), C("Q", "D"), C("7", "S")];
    const winTable = freshTable(winCards, [{ id: "p1", nickname: "נועה" }]);
    bet(winTable, "p1", 80);
    deal(winTable);
    act(winTable, "p1", "stand");
    completeDealer(winTable);
    assert.equal(winTable.players[0].hands[0].result, "win");
    assert.equal(winTable.players[0].hands[0].net, 80);
    assert.equal(winTable.players[0].bankroll, 1080);
  });

  it("lets a busted player lose even when the dealer would have busted", () => {
    const sentinel = { rank: "K", suit: "S", id: "SENTINEL" };
    const cards = [C("10", "H"), C("10", "D"), C("6", "C"), C("6", "S"), C("K", "H"), sentinel, C("2", "H")];
    const table = freshTable(cards, [{ id: "p1", nickname: "נועה" }], { cutIndex: 7 });
    bet(table, "p1", 50);
    deal(table);
    act(table, "p1", "hit");
    assert.equal(table.players[0].hands[0].status, "bust");
    completeDealer(table);
    assert.equal(table.dealerCards.length, 2);
    assert.equal(table.players[0].hands[0].result, "bust");
    assert.equal(table.players[0].hands[0].net, -50);
    assert.equal(table.players[0].bankroll, 950);
    assert.equal(table.shoe.cards.some((card) => card.id === "SENTINEL"), true);
  });

  it("doubles the stake, takes exactly one card, and pays the doubled bet", () => {
    const cards = [C("5", "H"), C("10", "C"), C("6", "D"), C("7", "S"), C("10", "H")];
    const table = freshTable(cards, [{ id: "p1", nickname: "נועה", bankroll: 500 }]);
    bet(table, "p1", 40);
    deal(table);
    assert.deepEqual(legalActions(table, "p1"), ["hit", "stand", "double"]);
    const doubled = act(table, "p1", "double");
    assert.equal(doubled.roundComplete, true);
    const hand = table.players[0].hands[0];
    assert.equal(hand.cards.length, 3);
    assert.equal(hand.bet, 80);
    assert.equal(hand.doubled, true);
    assert.equal(hand.status, "stand");
    assert.equal(table.players[0].bankroll, 420);
    completeDealer(table);
    assert.equal(hand.result, "win");
    assert.equal(hand.net, 80);
    assert.equal(table.players[0].bankroll, 580);
    assert.equal(table.dealerCards.length, 2);
  });

  it("rejects a double when the bankroll cannot cover it or the hand already hit", () => {
    const cards = [C("5", "H"), C("10", "C"), C("5", "D"), C("7", "S"), C("2", "H"), C("3", "C")];
    const table = freshTable(cards, [{ id: "p1", nickname: "נועה", bankroll: 100 }]);
    bet(table, "p1", 100);
    deal(table);
    assert.equal(legalActions(table, "p1").includes("double"), false);
    assert.equal(act(table, "p1", "double").ok, false);
    assert.equal(table.players[0].hands[0].cards.length, 2);
    assert.equal(table.players[0].bankroll, 0);

    const rich = freshTable(
      [C("5", "H"), C("9", "C"), C("2", "D"), C("8", "S"), C("3", "H"), C("4", "C")],
      [{ id: "p1", nickname: "נועה" }],
    );
    bet(rich, "p1", 10);
    deal(rich);
    act(rich, "p1", "hit");
    assert.equal(legalActions(rich, "p1").includes("double"), false);
    assert.equal(act(rich, "p1", "double").ok, false);
  });

  it("splits a pair into two bets and pays each hand, without treating a split 21 as blackjack", () => {
    const cards = [
      C("A", "H"), C("9", "C"), C("A", "D"), C("8", "S"),
      C("K", "S"), C("6", "C"),
    ];
    const table = freshTable(cards, [{ id: "p1", nickname: "נועה" }]);
    bet(table, "p1", 100);
    deal(table);
    assert.equal(legalActions(table, "p1").includes("split"), true);
    const split = act(table, "p1", "split");
    assert.equal(split.roundComplete, true);
    const [left, right] = table.players[0].hands;
    assert.equal(left.cards.length, 2);
    assert.equal(right.cards.length, 2);
    assert.equal(left.fromSplit, true);
    assert.equal(isNatural(left), false);
    assert.equal(table.players[0].bankroll, 800);
    completeDealer(table);
    assert.equal(left.result, "win");
    assert.notEqual(left.result, "blackjack");
    assert.equal(left.net, 100);
    assert.equal(right.result, "push");
    assert.equal(right.net, 0);
    assert.equal(table.players[0].bankroll, 1100);
  });

  it("doubles after a split and pays both hands at 1:1", () => {
    const cards = [
      C("8", "H"), C("9", "C"), C("8", "D"), C("8", "S"),
      C("3", "C"), C("10", "H"), C("10", "S"),
    ];
    const table = freshTable(cards, [{ id: "p1", nickname: "נועה" }]);
    bet(table, "p1", 100);
    deal(table);
    act(table, "p1", "split");
    assert.equal(table.phase, "acting");
    assert.equal(table.turn.handIndex, 0);
    assert.equal(legalActions(table, "p1").includes("double"), true);
    assert.equal(legalActions(table, "p1").includes("split"), false);
    act(table, "p1", "double");
    assert.equal(table.players[0].hands[0].cards.length, 3);
    assert.equal(table.players[0].hands[0].bet, 200);
    act(table, "p1", "stand");
    completeDealer(table);
    assert.equal(table.players[0].hands[0].result, "win");
    assert.equal(table.players[0].hands[1].result, "win");
    assert.equal(table.players[0].bankroll, 1300);
  });

  it("does not split different ten-value ranks and does not resplit", () => {
    const cards = [C("K", "H"), C("9", "C"), C("10", "D"), C("8", "S"), C("2", "C")];
    const table = freshTable(cards, [{ id: "p1", nickname: "נועה" }]);
    bet(table, "p1", 20);
    deal(table);
    assert.equal(legalActions(table, "p1").includes("split"), false);
    assert.equal(act(table, "p1", "split").error, "הפעולה לא זמינה");
  });

  it("plays seats in join order and settles a bust beside a live hand", () => {
    const cards = [
      C("10", "H"), C("10", "S"), C("9", "C"),
      C("Q", "H"), C("6", "D"), C("7", "S"),
      C("K", "C"), C("5", "H"),
    ];
    const table = freshTable(cards, [
      { id: "p1", nickname: "נועה" },
      { id: "p2", nickname: "יוסי" },
    ]);
    bet(table, "p1", 100);
    bet(table, "p2", 50);
    deal(table);
    assert.equal(table.turn.playerId, "p1");
    assert.equal(act(table, "p2", "stand").ok, false);
    assert.equal(table.players[1].hands[0].cards.length, 2);
    act(table, "p1", "stand");
    assert.equal(table.turn.playerId, "p2");
    act(table, "p2", "hit");
    assert.equal(table.players[1].hands[0].status, "bust");
    completeDealer(table);
    assert.equal(table.dealerCards.length, 3);
    assert.equal(handValue(table.dealerCards).total, 21);
    assert.equal(table.players[0].hands[0].result, "lose");
    assert.equal(table.players[0].bankroll, 900);
    assert.equal(table.players[1].hands[0].result, "bust");
    assert.equal(table.players[1].bankroll, 950);
  });

  it("refunds a replaced bet and a sit-out", () => {
    const cards = [C("9", "H"), C("9", "C"), C("9", "D"), C("9", "S")];
    const table = freshTable(cards, [{ id: "p1", nickname: "נועה" }]);
    bet(table, "p1", 100);
    assert.equal(table.players[0].bankroll, 900);
    bet(table, "p1", 40);
    assert.equal(table.players[0].bankroll, 960);
    assert.equal(table.players[0].bet, 40);
    sitOut(table, "p1");
    assert.equal(table.players[0].bankroll, 1000);
    assert.equal(table.players[0].committed, false);
    assert.equal(deal(table).ok, false);
  });

  it("refunds a leavers bet during betting and stands a hand that leaves mid-round", () => {
    const cards = [C("10", "H"), C("9", "C"), C("8", "D"), C("7", "S"), C("2", "C")];
    const table = freshTable(cards, [
      { id: "p1", nickname: "נועה" },
      { id: "p2", nickname: "יוסי" },
    ]);
    bet(table, "p1", 30);
    const left = removePlayer(table, "p1");
    assert.equal(left.removed, true);
    assert.equal(table.players.length, 1);
    bet(table, "p2", 20);
    deal(table);
    const exit = removePlayer(table, "p2");
    assert.equal(exit.roundComplete, true);
    assert.equal(table.players[0].hands[0].status, "stand");
    completeDealer(table);
    assert.equal(table.phase, "results");
    assert.equal(table.players[0].inRound, true);
  });
});

describe("cut card and shoe", () => {
  it("inserts the cut card at 60–75% of a 6-deck shoe and never deals it", () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const shoe = createShoe({ rng: mulberry32(seed) });
      assert.equal(shoe.realCount, 312);
      assert.equal(shoe.cards.length, 313);
      assert.equal(shoe.cards.filter((card) => card.cut).length, 1);
      const ratio = shoe.cutIndex / shoe.realCount;
      assert.ok(ratio >= 0.6 - 1e-9 && ratio <= 0.75 + 1e-9, `penetration ${ratio}`);
      const ids = shoe.cards.filter((card) => !card.cut).map((card) => card.id);
      assert.equal(new Set(ids).size, 312);
    }

    const shoe = createShoe({
      cards: [C("A", "H"), C("2", "H"), C("3", "H"), C("4", "H")],
      cutIndex: 2,
    });
    const table = createTable({ rng: mulberry32(1) });
    table.shoe = shoe;
    assert.equal(drawCard(table).rank, "A");
    assert.equal(table.shoe.cutReached, false);
    assert.equal(drawCard(table).rank, "2");
    assert.equal(drawCard(table).rank, "3");
    assert.equal(table.shoe.cutReached, true);
    assert.equal(drawCard(table).rank, "4");
    assert.equal(table.dealerCards.some((card) => card.cut), false);
  });

  it("finishes the round after the cut card, then rebuilds a full shoe", () => {
    const cards = [];
    for (let i = 0; i < 20; i += 1) cards.push({ rank: "2", suit: "H", id: `twos-${i}` });
    const table = createTable({ code: "CUT", dealerName: "דילר", rng: mulberry32(3) });
    addPlayer(table, { id: "p1", nickname: "נועה", bankroll: 500 });
    table.shoe = createShoe({ cards, cutIndex: 2 });
    assert.equal(openBetting(table).ok, true);
    assert.equal(table.shoe.realCount, 20);
    bet(table, "p1", 10);
    deal(table);
    assert.equal(table.shoe.cutReached, true);
    assert.equal(table.players[0].hands[0].cards.some((card) => card.cut), false);
    assert.equal(table.dealerCards.some((card) => card.cut), false);
    act(table, "p1", "stand");
    completeDealer(table);
    assert.equal(table.phase, "results");
    assert.equal(table.shoe.cutReached, true);
    assert.equal(table.shoe.realCount, 20);
    const previous = table.shoe;
    assert.equal(openBetting(table).ok, true);
    assert.notEqual(table.shoe, previous);
    assert.equal(table.shoe.cutReached, false);
    assert.equal(table.shoe.realCount, 312);
    assert.equal(table.shoe.cards.filter((card) => !card.cut).length, 312);
    assert.equal(table.reshuffled, true);
    const ranks = {};
    for (const card of table.shoe.cards) {
      if (card.cut) continue;
      ranks[card.rank] = (ranks[card.rank] || 0) + 1;
    }
    for (const rank of ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]) {
      assert.equal(ranks[rank], 24, rank);
    }
  });

  it("builds 312 cards and seats seven players, rejecting an eighth", () => {
    assert.equal(RULES.decks, 6);
    assert.equal(RULES.maxPlayers, 7);
    const table = createTable({ rng: mulberry32(11) });
    assert.equal(table.shoe.realCount, 312);
    assert.equal(table.shoe.cards.filter((card) => !card.cut).length, 312);
    for (let i = 1; i <= 7; i += 1) {
      const added = addPlayer(table, { id: `p${i}`, nickname: `שחקן${i}`, bankroll: 1000 });
      assert.equal(added.ok, true, added.error);
    }
    const extra = addPlayer(table, { id: "p8", nickname: "עוד", bankroll: 1000 });
    assert.equal(extra.ok, false);
    assert.equal(extra.error, "השולחן מלא (עד 7 שחקנים)");
    const view = publicView(table, { role: "dealer" });
    assert.equal(view.rules.maxPlayers, 7);
    assert.equal(view.rules.decks, 6);
    assert.equal(view.shoe.decks, 6);
    assert.equal(view.shoe.remaining, 312);
    assert.equal(view.players.length, 7);
  });

  it("sets a mid-round cut card aside, finishes the hand, then rebuilds before the next round", () => {
    const hit = C("5", "H");
    const cards = [
      C("10", "H"), C("10", "D"), C("6", "C"), C("7", "S"),
      hit, C("2", "C"), C("3", "D"), C("4", "H"),
    ];
    const table = freshTable(cards, [{ id: "p1", nickname: "נועה" }], { cutIndex: 4 });
    bet(table, "p1", 10);
    deal(table);
    assert.equal(table.shoe.cards[0].cut, true);
    assert.equal(table.shoe.cutReached, false);
    act(table, "p1", "hit");
    assert.equal(table.players[0].hands[0].cards.at(-1).id, hit.id);
    assert.equal(table.shoe.cutReached, true);
    assert.equal(table.shoe.cards.some((card) => card.cut), false);
    completeDealer(table);
    assert.equal(table.phase, "results");
    assert.equal(table.shoe.realCount, cards.length);
    assert.equal(table.players[0].hands[0].result, "win");
    assert.equal(table.players[0].bankroll, 1010);
    const shoeBefore = table.shoe;
    assert.equal(openBetting(table).ok, true);
    assert.notEqual(table.shoe, shoeBefore);
    assert.equal(table.shoe.realCount, 312);
    assert.equal(table.shoe.cutReached, false);
    assert.equal(table.reshuffled, true);
    assert.equal(table.players[0].id, "p1");
    assert.equal(table.players[0].bankroll, 1010);
    assert.equal(table.players[0].hands.length, 0);
    const ratio = table.shoe.cutIndex / table.shoe.realCount;
    assert.ok(ratio >= 0.6 - 1e-9 && ratio <= 0.75 + 1e-9);
  });

  it("reshuffles immediately when the next card at the end of a round is the cut card", () => {
    const cards = [
      C("10", "H"), C("10", "D"), C("7", "C"), C("9", "S"),
      C("2", "H"), C("3", "D"), C("4", "C"), C("5", "S"),
    ];
    const table = freshTable(cards, [{ id: "p1", nickname: "נועה" }], { cutIndex: 4 });
    bet(table, "p1", 10);
    deal(table);
    act(table, "p1", "stand");
    assert.equal(table.shoe.cards[0].cut, true);
    assert.equal(table.shoe.cutReached, false);
    completeDealer(table);
    assert.equal(table.phase, "results");
    assert.equal(table.dealerCards.length, 2);
    assert.equal(table.shoe.realCount, 312);
    assert.equal(table.shoe.cutReached, false);
    assert.equal(Boolean(table.shoe.cards[0]?.cut), false);
    assert.equal(table.reshuffled, true);
    assert.equal(table.players[0].bankroll, 990);
    assert.equal(table.log.some((entry) => entry.text === "ערבוב מחדש"), true);
    const rebuilt = table.shoe;
    assert.equal(openBetting(table).ok, true);
    assert.equal(table.shoe, rebuilt);
    assert.equal(table.round, 2);
    assert.equal(table.phase, "betting");
    assert.equal(table.reshuffled, true);
  });
});

describe("session continuity", () => {
  it("keeps seats and balances and can play another round", () => {
    const cards = [
      C("10", "H"), C("10", "D"), C("10", "C"),
      C("9", "S"), C("9", "H"), C("9", "D"),
      C("8", "H"), C("8", "D"), C("8", "C"), C("7", "S"), C("6", "H"), C("5", "D"),
    ];
    const table = freshTable(cards, [
      { id: "p1", nickname: "נועה" },
      { id: "p2", nickname: "יוסי" },
    ], { cutIndex: 11 });
    bet(table, "p1", 100);
    bet(table, "p2", 40);
    deal(table);
    act(table, "p1", "stand");
    act(table, "p2", "stand");
    completeDealer(table);
    assert.equal(table.phase, "results");
    assert.equal(table.players[0].hands[0].result, "push");
    assert.equal(table.players[1].hands[0].result, "push");
    assert.equal(table.players[0].bankroll, 1000);
    assert.equal(table.players[1].bankroll, 1000);
    assert.equal(openBetting(table).ok, true);
    assert.equal(table.round, 2);
    assert.equal(table.phase, "betting");
    assert.deepEqual(table.players.map((player) => player.id), ["p1", "p2"]);
    assert.equal(table.players[0].hands.length, 0);
    assert.equal(table.dealerCards.length, 0);
    assert.equal(table.players[0].bankroll, 1000);
    bet(table, "p1", 20);
    bet(table, "p2", 20);
    const second = deal(table);
    assert.equal(second.ok, true);
    assert.equal(table.players[0].inRound, true);
    assert.equal(table.players[1].inRound, true);
    assert.equal(table.players[0].bankroll, 980);
  });
});

describe("public view", () => {
  it("hides the hole card and the rest of the shoe from players", () => {
    const hole = { rank: "7", suit: "S", id: "HOLE-SECRET" };
    const next = { rank: "2", suit: "C", id: "NEXT-SECRET" };
    const cards = [
      { rank: "10", suit: "H", id: "p10" },
      { rank: "9", suit: "C", id: "d9" },
      { rank: "8", suit: "D", id: "p8" },
      hole,
      next,
    ];
    const table = freshTable(cards, [{ id: "p1", nickname: "נועה" }], { cutIndex: 5 });
    bet(table, "p1", 10);
    deal(table);
    assert.equal(table.phase, "acting");
    assert.equal(table.dealerCards[1].id, "HOLE-SECRET");
    const view = publicView(table, { role: "player", id: "p1" });
    assert.deepEqual(view.dealer.cards[1], { faceDown: true });
    assert.equal(view.dealer.cards[1].rank, undefined);
    assert.equal(view.shoe.cards, undefined);
    assert.equal(view.shoe.cutIndex, undefined);
    const blob = JSON.stringify(view);
    assert.equal(blob.includes("HOLE-SECRET"), false);
    assert.equal(blob.includes("NEXT-SECRET"), false);
    assert.equal(blob.includes('"rank":"7"'), false);
    assert.equal(view.you.legalActions.includes("hit"), true);
    const dealerView = publicView(table, { role: "dealer" });
    assert.deepEqual(dealerView.dealer.cards[1], { faceDown: true });
    assert.equal(JSON.stringify(dealerView).includes("HOLE-SECRET"), false);
  });
});
