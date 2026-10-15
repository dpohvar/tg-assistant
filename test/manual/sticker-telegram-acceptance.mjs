// Explicit live opt-in for the previously designated test bot and private test chat.
// node test/manual/sticker-telegram-acceptance.mjs PRIVATE_CONFIG_JSON REPORT_JSON
// Uses an isolated controller DB, never polls updates, cleans only this run's objects.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { deflateSync, gzipSync, gunzipSync } from "node:zlib";
import { randomBytes } from "node:crypto";
import { openDatabase } from "../../src/storage/database.mjs";
import { createTelegram } from "../../src/telegram/api.mjs";
import { createController } from "../../src/controller.mjs";
import {
  closeButtons,
  richInput,
  buttonText,
} from "../../src/messages/callbacks.mjs";

const source = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const registry = new DatabaseSync(
  path.join(source.dataDir, "controller.sqlite"),
  { readOnly: true },
);
const registered = registry
  .prepare("SELECT * FROM bots WHERE telegramId=?")
  .get(8768223629);
registry.close();
assert.equal(
  registered?.username,
  "dpohvar_test_pub_bot",
  "Designated test bot only",
);
assert.equal(
  registered.ownerId,
  114772672,
  "Designated private test owner only",
);
const token = fs.readFileSync(registered.secretRef, "utf8").trim();
const native = createTelegram({ getToken: () => token });
const botId = "test",
  chatId = registered.ownerId,
  records = [],
  messages = new Set(),
  sets = new Set();
const reportFile = path.resolve(process.argv[3]);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "sticker-live-"));
const config = {
  dataDir: path.join(root, "control"),
  botsDir: path.join(root, "bots"),
  codexExecutable: source.codexExecutable,
};
const dbFile = path.join(config.dataDir, "controller.sqlite");
const stamp = Date.now().toString(36) + randomBytes(3).toString("hex");
let db, c, scope, owner, regular, custom;
const redact = (e) =>
  String(e?.message ?? e)
    .replaceAll(token, "[redacted]")
    .slice(0, 1000);
function record(check, status, details = {}) {
  const row = { check, status, ...details };
  records.push(row);
  console.log(JSON.stringify(row));
  fs.writeFileSync(
    reportFile,
    JSON.stringify({ bot: registered.username, stamp, records }, null, 2),
  );
}
async function check(name, fn) {
  try {
    await fn();
    record(name, "passed");
  } catch (e) {
    record(name, "failed", { description: redact(e) });
  }
}
const telegram = {
  ...native,
  async call(b, method, args, options) {
    const result = await native.call(b, method, args, {
      ...options,
      signal: AbortSignal.timeout(45000),
    });
    if (method.startsWith("send"))
      for (const m of Array.isArray(result) ? result : [result])
        if (m?.message_id) messages.add(m.message_id);
    return result;
  },
};
function start() {
  db = openDatabase(dbFile);
  c = createController({ db, telegram, agent: {}, config });
  owner = db.agent(botId, chatId);
  if (owner) scope = c.lifecycle.scope(owner);
}
async function tool(name, args = {}) {
  const r = await c.invoke(scope, name, args);
  assert.equal(
    r.error,
    undefined,
    `${name}: ${r.error ?? ""} ${r.description ?? ""}`,
  );
  return r;
}
async function get(name) {
  return (await tool("sticker_set_get", { name })).set;
}
async function edit(name, args) {
  return tool("sticker_set_edit", { name, ...args });
}
const input = (file, format = "static", emoji = "🙂") => ({
  sticker: `attach://${file}`,
  format,
  emoji_list: [emoji],
});
const wiki = path.join(config.botsDir, botId);
const hasEmoji = (value, id) =>
  !!value &&
  typeof value === "object" &&
  (value.custom_emoji_id === id ||
    Object.values(value).some((v) => hasEmoji(v, id)));
function chunk(type, data) {
  const t = Buffer.from(type),
    n = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  n.writeUInt32BE(data.length);
  let c = 0xffffffff;
  for (const b of Buffer.concat([t, data])) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  crc.writeUInt32BE((c ^ 0xffffffff) >>> 0);
  return Buffer.concat([n, t, data, crc]);
}
function png(size, color) {
  const pixels = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const p = y * (1 + size * 4) + 1 + x * 4;
      pixels[p] = color[0];
      pixels[p + 1] = color[1];
      pixels[p + 2] = color[2];
      pixels[p + 3] =
        Math.hypot(x - size / 2, y - size / 2) < size * 0.4 ? 255 : 0;
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function tgs() {
  return gzipSync(
    JSON.stringify({
      tgs: 1,
      v: "5.7.4",
      fr: 60,
      ip: 0,
      op: 60,
      w: 512,
      h: 512,
      nm: "Live test",
      ddd: 0,
      assets: [],
      layers: [
        {
          ddd: 0,
          ind: 1,
          ty: 4,
          nm: "Circle",
          sr: 1,
          ks: {
            o: { a: 0, k: 100 },
            r: { a: 0, k: 0 },
            p: { a: 0, k: [256, 256, 0] },
            a: { a: 0, k: [0, 0, 0] },
            s: { a: 0, k: [100, 100, 100] },
          },
          ao: 0,
          shapes: [
            {
              ty: "el",
              d: 1,
              s: { a: 0, k: [300, 300] },
              p: { a: 0, k: [0, 0] },
              nm: "Circle",
            },
            {
              ty: "fl",
              c: { a: 0, k: [0.2, 0.7, 0.4, 1] },
              o: { a: 0, k: 100 },
              r: 1,
              nm: "Fill",
            },
            {
              ty: "tr",
              p: { a: 0, k: [0, 0] },
              a: { a: 0, k: [0, 0] },
              s: { a: 0, k: [100, 100] },
              r: { a: 0, k: 0 },
              o: { a: 0, k: 100 },
              sk: { a: 0, k: 0 },
              sa: { a: 0, k: 0 },
            },
          ],
          ip: 0,
          op: 60,
          st: 0,
          bm: 0,
        },
      ],
    }),
  );
}
function ffmpeg(args) {
  const r = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", ...args],
    { encoding: "utf8", timeout: 30000 },
  );
  assert.equal(r.status, 0, `Fixture ffmpeg: ${r.stderr ?? r.error?.message}`);
}
async function create(type, format, files, label) {
  const name = `Live_${stamp}_${label}_by_${registered.username}`;
  sets.add(name);
  const r = await tool("sticker_set_create", {
    name,
    title: `LIVE TEST ${label}`,
    type,
    stickers: [input("a", format)],
    uploads: { a: files },
    ...(type === "custom_emoji"
      ? { ownerUserId: chatId, needsRepainting: false }
      : {}),
  });
  assert.equal(r.ownerUserId, chatId);
  const set = await get(r.link);
  assert.equal(set.sticker_type, type);
  assert.equal(set.stickers.length, 1);
  assert.equal(set.stickers[0].is_animated, format === "animated");
  assert.equal(set.stickers[0].is_video, format === "video");
  return set;
}

try {
  const me = await telegram.call(botId, "getMe", {});
  assert.equal(me.id, registered.telegramId);
  assert.equal(me.username, registered.username);
  const chat = await telegram.call(botId, "getChat", { chat_id: chatId });
  assert.equal(chat.type, "private");
  start();
  db.registerBot({
    botId,
    telegramId: me.id,
    username: me.username,
    ownerId: chatId,
  });
  db.saveChat(botId, chat);
  owner = db.ensureAgent(botId, chatId);
  scope = c.lifecycle.scope(owner);
  fs.mkdirSync(wiki, { recursive: true });
  for (const [size, prefix] of [
    [512, "regular"],
    [100, "emoji"],
  ])
    for (const [color, label] of [
      [[210, 50, 70], "red"],
      [[50, 160, 230], "blue"],
      [[70, 200, 90], "green"],
    ])
      fs.writeFileSync(
        path.join(wiki, `${prefix}-${label}.png`),
        png(size, color),
      );
  fs.writeFileSync(path.join(wiki, "animation.tgs"), tgs());
  fs.writeFileSync(
    path.join(wiki, "widget.tsx"),
    `export function render(s){if(s.kind==='sticker')return {sticker:s.fileId};return <><p>LIVE TEST widget custom emoji</p><buttons><button callback_data="choose"><tg-emoji emoji-id={s.emojiId}>🙂</tg-emoji> Choose {s.count??0}</button></buttons></>} export function choose(ctx){ctx.state.count=(ctx.state.count??0)+1}`,
  );
  await check("create regular PNG set with default owner", async () => {
    regular = await create("regular", "static", "regular-red.png", "regular");
  });
  await check("create custom emoji PNG set with explicit owner", async () => {
    custom = await create("custom_emoji", "static", "emoji-red.png", "emoji");
  });
  for (const [type, getSet, prefix] of [
    ["regular", () => regular, "regular"],
    ["custom_emoji", () => custom, "emoji"],
  ]) {
    if (!getSet()) continue;
    await check(
      `${type}: add, move, emojis, keywords, title and replace`,
      async () => {
        const name = getSet().name;
        await edit(name, {
          action: "add",
          sticker: input("b", "static", "👍"),
          uploads: { b: `${prefix}-blue.png` },
        });
        let set = await get(name);
        assert.equal(set.stickers.length, 2);
        const blue = set.stickers[1],
          old = set.stickers[0];
        await edit(name, { action: "move", fileId: blue.file_id, position: 0 });
        set = await get(name);
        assert.equal(set.stickers[0].file_unique_id, blue.file_unique_id);
        await edit(name, {
          action: "set_emojis",
          fileId: blue.file_id,
          emojiList: ["👍", "🙂"],
        });
        set = await get(name);
        assert.ok(["👍", "🙂"].includes(set.stickers[0].emoji));
        await edit(name, {
          action: "set_keywords",
          fileId: blue.file_id,
          keywords: ["live", "probe"],
        });
        await edit(name, {
          action: "set_keywords",
          fileId: blue.file_id,
          keywords: [],
        });
        const title = `LIVE TEST edited ${type}`;
        await edit(name, { action: "set_title", title });
        assert.equal((await get(name)).title, title);
        await edit(name, {
          action: "replace",
          oldFileId: old.file_id,
          sticker: input("g"),
          uploads: { g: `${prefix}-green.png` },
        });
        set = await get(name);
        assert.equal(set.stickers.length, 2);
        assert.ok(
          !set.stickers.some((s) => s.file_unique_id === old.file_unique_id),
        );
        if (type === "regular") regular = set;
        else custom = set;
      },
    );
  }
  if (regular)
    await check("regular thumbnail PNG upload and reset", async () => {
      await edit(regular.name, {
        action: "set_thumbnail",
        thumbnail: "attach://thumb",
        format: "static",
        uploads: { thumb: "emoji-red.png" },
      });
      assert.ok((await get(regular.name)).thumbnail);
      await edit(regular.name, {
        action: "set_thumbnail",
        thumbnail: null,
        format: "static",
      });
    });
  if (custom)
    await check("custom emoji thumbnail select and reset", async () => {
      await edit(custom.name, {
        action: "set_thumbnail",
        customEmojiId: custom.stickers[0].custom_emoji_id,
      });
      await edit(custom.name, { action: "set_thumbnail", customEmojiId: null });
    });
  if (regular)
    await check(
      "download and direct send of a discovered sticker file ID",
      async () => {
        const sticker = regular.stickers[0];
        const r = await tool("download", { fileIds: [sticker.file_id] });
        assert.ok(fs.statSync(r.files[0].path).size > 0);
        const sent = await tool("send", {
          sticker: sticker.file_id,
          disable_notification: true,
        });
        assert.equal(
          db.getMessage(botId, chatId, sent.messageIds[0]).sticker
            .file_unique_id,
          sticker.file_unique_id,
        );
      },
    );
  if (custom)
    await check(
      "custom emoji download resolves opaque ID to actual bytes",
      async () => {
        const sticker = custom.stickers[0],
          r = await tool("download_custom_emoji", {
            customEmojiIds: [sticker.custom_emoji_id],
          });
        assert.equal(r.files[0].error, undefined);
        assert.equal(r.files[0].sticker.file_unique_id, sticker.file_unique_id);
        assert.ok(fs.statSync(r.files[0].path).size > 0);
      },
    );
  if (custom)
    await check(
      "custom emoji text entities and rich button retain custom IDs in Telegram response",
      async () => {
        const id = custom.stickers[0].custom_emoji_id;
        const plain = await tool("send", {
          text: "🙂 LIVE TEST custom emoji",
          entities: [
            { type: "custom_emoji", offset: 0, length: 2, custom_emoji_id: id },
          ],
          disable_notification: true,
        });
        assert.ok(
          hasEmoji(
            db.getMessage(botId, chatId, plain.messageIds[0]).entities,
            id,
          ),
        );
        const text = [
          "⬜️ ",
          { type: "custom_emoji", custom_emoji_id: id, alternative_text: "🙂" },
          " Choose",
        ];
        const rich = await tool("send", {
          rich_message: {
            blocks: [
              { type: "paragraph", text: "LIVE TEST custom emoji button" },
              {
                type: "buttons",
                buttons: [{ text, callback_data: "[live]choose" }],
              },
            ],
          },
          disable_notification: true,
        });
        const saved = db.getMessage(botId, chatId, rich.messageIds[0]);
        assert.ok(hasEmoji(saved.rich_message, id));
        assert.equal(buttonText(text), "⬜️ 🙂 Choose");
        const closed = closeButtons(saved, "live", "[live]choose");
        await tool("edit", {
          messageId: saved.message_id,
          rich_message: richInput(closed.rich_message),
        });
        const edited = db.getMessage(botId, chatId, saved.message_id);
        assert.ok(hasEmoji(edited.rich_message, id));
        assert.ok(JSON.stringify(edited.rich_message).includes("✅"));
      },
    );
  if (regular)
    await check(
      "sandboxed sticker widget accepts a file ID absent from saved messages",
      async () => {
        const id = regular.stickers.at(-1).file_id;
        db.sql.prepare("DELETE FROM messages").run();
        const w = await tool("set_widget", {
          handler: "widget.tsx",
          description: "LIVE TEST sticker file ID",
          state: { kind: "sticker", fileId: id },
          disable_notification: true,
        });
        assert.ok(c.widgets.store.get(w.widgetId).message.sticker);
        await tool("delete_widget", { widgetId: w.widgetId });
      },
    );
  if (custom)
    await check(
      "sandboxed JSX widget renders and edits custom emoji rich button",
      async () => {
        const id = custom.stickers[0].custom_emoji_id;
        const w = await tool("set_widget", {
          handler: "widget.tsx",
          description: "LIVE TEST emoji rich button",
          state: { emojiId: id },
          disable_notification: true,
        });
        assert.ok(
          hasEmoji(c.widgets.store.get(w.widgetId).message.rich_message, id),
        );
        await tool("widget_event", {
          widgetId: w.widgetId,
          name: "choose",
          data: {},
        });
        const until = Date.now() + 15000;
        while (
          Date.now() < until &&
          c.widgets.state(scope, { widgetId: w.widgetId }).count !== 1
        )
          await new Promise((r) => setTimeout(r, 100));
        assert.equal(c.widgets.state(scope, { widgetId: w.widgetId }).count, 1);
        await new Promise((r) => setTimeout(r, 500));
        assert.ok(
          hasEmoji(c.widgets.store.get(w.widgetId).message.rich_message, id),
        );
        await tool("delete_widget", { widgetId: w.widgetId });
      },
    );
  await check("static WebP creation", async () => {
    ffmpeg([
      "-i",
      path.join(wiki, "regular-red.png"),
      "-c:v",
      "libwebp",
      "-lossless",
      "1",
      path.join(wiki, "static.webp"),
    ]);
    await create("regular", "static", "static.webp", "webp");
  });
  for (const type of ["regular", "custom_emoji"]) {
    await check(
      `${type}: TGS creation and downloaded gzip Lottie`,
      async () => {
        const set = await create(
          type,
          "animated",
          "animation.tgs",
          type === "regular" ? "tgs" : "etgs",
        );
        const r = await tool("download", {
          fileIds: [set.stickers[0].file_id],
        });
        assert.equal(
          JSON.parse(gunzipSync(fs.readFileSync(r.files[0].path))).fr,
          60,
        );
      },
    );
    await check(`${type}: WebM VP9 creation and download`, async () => {
      const size = type === "regular" ? 512 : 100,
        file = `${type}.webm`;
      ffmpeg([
        "-f",
        "lavfi",
        "-i",
        `color=c=blue:s=${size}x${size}:r=15:d=1`,
        "-an",
        "-c:v",
        "libvpx-vp9",
        "-b:v",
        "0",
        "-crf",
        "40",
        path.join(wiki, file),
      ]);
      const set = await create(
        type,
        "video",
        file,
        type === "regular" ? "webm" : "ewebm",
      );
      const r = await tool("download", { fileIds: [set.stickers[0].file_id] });
      assert.equal(
        fs.readFileSync(r.files[0].path).readUInt32BE(0),
        0x1a45dfa3,
      );
    });
  }
  for (const set of [regular, custom].filter(Boolean))
    await check(`${set.sticker_type}: remove member and verify`, async () => {
      const before = await get(set.name);
      if (before.stickers.length < 2)
        throw new Error("Missing second fixture member");
      await edit(set.name, {
        action: "remove",
        fileId: before.stickers.at(-1).file_id,
      });
      assert.equal(
        (await get(set.name)).stickers.length,
        before.stickers.length - 1,
      );
    });
  await check(
    "catalog survives controller/database restart and no set is uncertain",
    async () => {
      const before = await tool("sticker_sets");
      assert.equal(
        before.sets.length,
        [...sets].filter((name) =>
          db.sql
            .prepare(
              "SELECT 1 FROM sticker_sets WHERE botId=? AND name=? AND status='confirmed'",
            )
            .get(botId, name),
        ).length,
      );
      assert.equal(before.uncertain, undefined);
      c.close();
      await c.idle();
      db.close();
      start();
      const after = await tool("sticker_sets");
      assert.deepEqual(after, before);
    },
  );
} catch (e) {
  record("acceptance setup or orchestration", "failed", {
    description: redact(e),
  });
} finally {
  if (c && scope) {
    for (const w of c.widgets?.store.list(scope) ?? [])
      try {
        await c.invoke(scope, "delete_widget", { widgetId: w.widgetId });
      } catch (e) {
        record("widget cleanup", "failed", { description: redact(e) });
      }
    for (const name of sets)
      await check(`cleanup set ${name}`, async () => {
        const exists = db.sql
          .prepare("SELECT 1 FROM sticker_sets WHERE botId=? AND name=?")
          .get(botId, name);
        if (!exists) return;
        await tool("sticker_set_delete", { name });
        try {
          await telegram.call(botId, "getStickerSet", { name });
          assert.fail("Set still exists after confirmed deletion");
        } catch (e) {
          assert.equal(e.code, "telegram_api_error");
          assert.match(e.message, /STICKERSET_INVALID/i);
        }
        assert.equal(
          db.sql
            .prepare("SELECT 1 FROM sticker_sets WHERE botId=? AND name=?")
            .get(botId, name),
          undefined,
        );
      });
    for (const messageId of messages)
      try {
        await telegram.call(botId, "deleteMessage", {
          chat_id: chatId,
          message_id: messageId,
        });
      } catch (e) {
        if (!/message to delete not found/i.test(e.message))
          record("message cleanup", "failed", {
            messageId,
            description: redact(e),
          });
      }
    c.close();
    await c.idle();
    db.close();
  }
  // Keep only the sanitized report; all bytes/state below this generated temp root are disposable.
  fs.rmSync(root, { recursive: true, force: true });
}
const failed = records.filter((r) => r.status === "failed");
record("summary", failed.length ? "failed" : "passed", {
  passed: records.filter((r) => r.status === "passed").length,
  failed: failed.length,
  realUserCallbacks: false,
});
if (failed.length) process.exitCode = 1;
