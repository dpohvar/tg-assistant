import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../../src/storage/database.mjs";
import { createWidgetStore } from "../../src/widgets/store.mjs";
import { createWidgetEvents } from "../../src/widgets/events.mjs";
function fixture(t) {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  db.registerBot({ botId: "b", telegramId: 42, username: "bot", ownerId: 1 });
  db.saveChat("b", { id: -1, type: "supergroup", title: "Fixture" });
  const a = db.ensureAgent("b", -1),
    store = createWidgetStore(db),
    w = store.create({
      botId: "b",
      agentId: a.agentId,
      chatId: -1,
      messageId: 7,
      description: "Fixture",
      handler: "w.tsx",
      snapshotId: "s",
      state: {},
      message: {
        message_id: 7,
        chat: { id: -1, type: "supergroup" },
        text: "Widget",
      },
      status: "disabled",
    });
  store.patch(w, { buttonNames: ["vote"], pollId: "poll" });
  const acks = [],
    events = [],
    manager = {
      store,
      hasHook: () => true,
      admit: async (w, e) => {
        events.push(e);
        return store.admit(w, e, { durable: e.source !== "button" });
      },
    };
  const route = createWidgetEvents({
    db,
    manager,
    telegram: { call: async (_b, _m, args) => acks.push(args) },
  });
  return { db, store, w, route, events, acks };
}
test("disabled callbacks acknowledge without queueing; disabled reply is captured", async (t) => {
  const f = fixture(t);
  assert.equal(
    await f.route("b", {
      callback_query: {
        id: "cb",
        data: "vote",
        from: { id: 2 },
        message: { message_id: 7, chat: { id: -1 } },
      },
    }),
    true,
  );
  assert.equal(f.events.length, 0);
  assert.equal(f.acks.length, 1);
  assert.equal(
    await f.route("b", {
      message: {
        message_id: 8,
        chat: { id: -1 },
        from: { id: 2 },
        text: "reply",
        reply_to_message: { message_id: 7 },
      },
    }),
    true,
  );
  assert.equal(f.store.get(f.w.widgetId).pending, 1);
});
test("reaction projection is latest before delayed dispatch and survives history deletion", async (t) => {
  const f = fixture(t);
  await f.route("b", {
    message_reaction_count: {
      chat: { id: -1 },
      message_id: 7,
      date: 20,
      reactions: [{ type: { type: "emoji", emoji: "👍" }, total_count: 2 }],
    },
  });
  await f.route("b", {
    message_reaction_count: {
      chat: { id: -1 },
      message_id: 7,
      date: 10,
      reactions: [{ type: { type: "emoji", emoji: "👍" }, total_count: 1 }],
    },
  });
  assert.equal(
    f.store.get(f.w.widgetId).message.reactions.counts[0].total_count,
    2,
  );
});
test("poll answers retain identities without incrementing native totals", async (t) => {
  const f = fixture(t);
  await f.route("b", {
    poll: {
      id: "poll",
      question: "Q",
      options: [{ persistent_id: "p", text: "Yes", voter_count: 3 }],
      total_voter_count: 3,
    },
  });
  await f.route("b", {
    poll_answer: {
      poll_id: "poll",
      user: { id: 2 },
      option_ids: [0],
      option_persistent_ids: ["p"],
    },
  });
  const m = f.store.get(f.w.widgetId).message;
  assert.equal(m.poll.total_voter_count, 3);
  assert.equal(m.pollAnswers.known[0].user.id, 2);
  assert.equal(m.pollAnswers.complete, false);
});
