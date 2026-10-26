// Explicit opt-in: designated test bot only. Uses separate synthetic controller state,
// sends/deletes only its own fixtures, and never polls Telegram or prints credentials.
// node test/manual/widget-telegram-acceptance.mjs CONFIG_JSON FIXTURE_DIRECTORY
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../../src/storage/database.mjs";
import { createTelegram } from "../../src/telegram/api.mjs";
import { createWidgetService } from "../../src/widgets/service.mjs";
import { BotFiles } from "../../src/files/paths.mjs";
import { messageKind } from "../../src/messages/edit-plan.mjs";
import {
  jsx,
  Fragment,
  normalizeRender,
} from "../../src/widgets/jsx-runtime.mjs";
import { deflateSync } from "node:zlib";

const source = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const registry = new DatabaseSync(
  path.join(source.dataDir, "controller.sqlite"),
  { readOnly: true },
);
const registered = registry
  .prepare("SELECT * FROM bots WHERE telegramId=?")
  .get(8768223629);
if (!registered || registered.username !== "dpohvar_test_pub_bot")
  throw new Error("Designated test bot is unavailable.");
const token = fs.readFileSync(registered.secretRef, "utf8").trim();
registry.close();
const root = fs.mkdtempSync(
  path.join(os.tmpdir(), "widget-telegram-acceptance-"),
);
const config = {
  dataDir: path.join(root, "control"),
  botsDir: path.join(root, "bots"),
  codexExecutable: source.codexExecutable,
};
const db = openDatabase(path.join(config.dataDir, "controller.sqlite")),
  botId = "b",
  chatId = 114772672;
db.registerBot({
  botId,
  telegramId: 8768223629,
  username: registered.username,
  ownerId: chatId,
});
const native = createTelegram({ getToken: () => token }),
  call = (method, args) =>
    native.call(botId, method, args, { signal: AbortSignal.timeout(30000) });
const chat = await call("getChat", { chat_id: chatId });
assert.equal(chat.type, "private");
db.saveChat(botId, chat);
const owner = db.ensureAgent(botId, chatId),
  scope = { botId, agentId: owner.agentId, chatId };
const wiki = path.join(config.botsDir, botId);
fs.mkdirSync(wiki, { recursive: true });
fs.writeFileSync(
  path.join(wiki, "handler.ts"),
  "export function render(s){return s.view} export function next(ctx){ctx.state.count=(ctx.state.count??0)+1;}",
);
fs.copyFileSync(
  path.join(process.argv[3], "telegram-album-21.jpg"),
  path.join(wiki, "photo.jpg"),
);
fs.copyFileSync(
  path.join(process.argv[3], "animation.gif"),
  path.join(wiki, "animation.gif"),
);
async function fixture(url, name) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error("Fixture download failed.");
  fs.writeFileSync(path.join(wiki, name), Buffer.from(await r.arrayBuffer()));
}
await fixture(
  "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
  "video.mp4",
);
await fixture("https://www.w3schools.com/html/horse.mp3", "audio.mp3");
const videoNoteFixture = path.join(process.argv[3], "video-note.mp4");
if (fs.existsSync(videoNoteFixture))
  fs.copyFileSync(videoNoteFixture, path.join(wiki, "video-note.mp4"));
fs.writeFileSync(path.join(wiki, "document.txt"), "Widget file fixture");
// Deterministic 512px RGBA fixture; no imaging dependency on the deployed server.
const pixels = Buffer.alloc(512 * (1 + 512 * 4));
for (let y = 0; y < 512; y++)
  for (let x = 0; x < 512; x++) {
    const p = y * (1 + 512 * 4) + 1 + x * 4;
    pixels[p] = 180;
    pixels[p + 1] = 90;
    pixels[p + 2] = 220;
    pixels[p + 3] = 255;
  }
function pngChunk(type, data) {
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
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(512);
ihdr.writeUInt32BE(512, 4);
ihdr[8] = 8;
ihdr[9] = 6;
fs.writeFileSync(
  path.join(wiki, "sticker.png"),
  Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(pixels)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]),
);
const voiceTarget = process.argv.includes("--voice-in-group")
  ? -1004380172914
  : undefined;
if (voiceTarget)
  db.saveChat(botId, await call("getChat", { chat_id: voiceTarget }));
const records = [],
  created = new Set(),
  uploads = [];
let service;
const telegram = {
  ...native,
  call: async (b, method, args, options) => {
    if (method.startsWith("send") || method.startsWith("edit"))
      uploads.push({ method, files: options?.uploads?.length ?? 0 });
    const m = await native.call(b, method, args, {
      ...options,
      signal: AbortSignal.timeout(30000),
    });
    if (method.startsWith("send") && m?.message_id)
      created.add(JSON.stringify([args.chat_id, m.message_id]));
    return m;
  },
};
const options = {
  db,
  config,
  telegram,
  invoke: async () => ({}),
  filesFor: (s) => new BotFiles(path.join(config.botsDir, s.botId), s.agentId),
  notify: async (_o, e) =>
    records.push({
      phase: "notification",
      eventType: e.eventType,
      error: e.error,
    }),
};
service = createWidgetService(options);
const keyboard = {
  inline_keyboard: [[{ text: "Widget fixture", callback_data: "next" }]],
};
async function widget(view, description) {
  return service.set(scope, {
    handler: "handler.ts",
    description,
    state: { view },
    disable_notification: true,
    ...(voiceTarget &&
    (view.voice ||
      view.video_note ||
      JSON.stringify(view).includes('"voice_note"'))
      ? { chatId: voiceTarget }
      : {}),
  });
}
async function clean(w) {
  await service.delete(scope, { widgetId: w.widgetId });
}
function report(record) {
  records.push(record);
  console.log(JSON.stringify(record));
}
const refs = {},
  view = {
    text: { text: "WIDGET ACCEPTANCE: text", reply_markup: keyboard },
    rich_message: {
      rich_message: {
        blocks: [{ type: "paragraph", text: "WIDGET ACCEPTANCE: rich" }],
      },
      reply_markup: keyboard,
    },
    location: {
      location: { latitude: 0, longitude: 0 },
      reply_markup: keyboard,
    },
    venue: {
      venue: { latitude: 0, longitude: 0, title: "Fixture", address: "Test" },
      reply_markup: keyboard,
    },
    contact: {
      contact: { phone_number: "+10000000000", first_name: "Fixture" },
      reply_markup: keyboard,
    },
    poll: {
      poll: {
        question: "WIDGET ACCEPTANCE",
        options: [{ text: "A" }, { text: "B" }],
        is_anonymous: false,
        allows_multiple_answers: true,
      },
      reply_markup: keyboard,
    },
    dice: { dice: { emoji: "🎲" }, reply_markup: keyboard },
    sticker: { sticker: "file:sticker.png", reply_markup: keyboard },
    voice: { voice: "file:audio.mp3", reply_markup: keyboard },
    video_note: {
      video_note: fs.existsSync(videoNoteFixture)
        ? "file:video-note.mp4"
        : "file:video.mp4",
      reply_markup: keyboard,
    },
    live_photo: {
      live_photo: { media: "file:video.mp4", photo: "file:photo.jpg" },
      reply_markup: keyboard,
    },
  };
try {
  for (const [kind, file] of Object.entries({
    photo: "photo.jpg",
    video: "video.mp4",
    animation: "animation.gif",
    audio: "audio.mp3",
    document: "document.txt",
  })) {
    if (process.argv.includes("--native-only")) continue;
    const w = await widget(
      {
        [kind]: "file:" + file,
        caption: "WIDGET ACCEPTANCE: " + kind,
        reply_markup: keyboard,
      },
      "Native " + kind,
    );
    const m = service.store.get(w.widgetId).message;
    refs[kind] = kind === "photo" ? m.photo.at(-1).file_id : m[kind].file_id;
    view[kind] = {
      [kind]: refs[kind],
      caption: "Native " + kind,
      reply_markup: keyboard,
    };
    if (kind === "photo") {
      const file = await call("getFile", { file_id: m.photo[0].file_id });
      const response = await fetch(
        "https://api.telegram.org/file/bot" + token + "/" + file.file_path,
      );
      if (!response.ok) throw new Error("Thumbnail fixture download failed.");
      fs.writeFileSync(
        path.join(wiki, "thumb.jpg"),
        Buffer.from(await response.arrayBuffer()),
      );
    }
    const before = uploads.length;
    await service.renderer.publish(service.store.get(w.widgetId), {
      [kind]: "file:" + file,
      caption: "Cached " + kind,
      reply_markup: keyboard,
    });
    assert.equal(
      uploads.slice(before).reduce((n, x) => n + x.files, 0),
      0,
    );
    await clean(w);
    report({ phase: "native", kind, cached: true });
  }
  for (const kind of [
    "venue",
    "contact",
    "poll",
    "dice",
    "sticker",
    "voice",
    "video_note",
    "live_photo",
  ]) {
    if (
      process.argv.includes("--native-only") &&
      !["sticker", "video_note"].includes(kind)
    )
      continue;
    try {
      const w = await widget(view[kind], "Native " + kind);
      assert.equal(messageKind(service.store.get(w.widgetId).message), kind);
      await clean(w);
      report({ phase: "native", kind, ok: true });
    } catch (e) {
      if (!["voice", "video_note", "live_photo"].includes(kind)) throw e;
      report({
        phase: "native",
        kind,
        ok: false,
        error: String(e.message).slice(0, 300),
      });
    }
  }
  if (!process.argv.includes("--native-only")) {
    const kinds = [
      "text",
      "rich_message",
      "photo",
      "video",
      "audio",
      "document",
    ];
    const pairs = (process.argv.includes("--media-only") ? [] : kinds).flatMap(
      (from) => kinds.filter((to) => to !== from).map((to) => [from, to]),
    );
    for (const from of process.argv.includes("--media-only")
      ? []
      : ["voice", "dice", "poll", "location", "contact"])
      pairs.push([from, "photo"]);
    for (const kind of process.argv.includes("--media-only") ? [] : kinds)
      pairs.push([kind, "animation"], ["animation", kind]);
    if (!process.argv.includes("--media-only")) pairs.push(["venue", "photo"]);
    for (const [from, to] of pairs) {
      let w;
      try {
        w = await widget(view[from], `Conversion ${from} to ${to}`);
      } catch (e) {
        report({
          phase: "conversion",
          from,
          to,
          creationUnavailable: true,
          error: String(e.message).slice(0, 200),
        });
        continue;
      }
      try {
        const before = created.size,
          m = await service.renderer.publish(
            service.store.get(w.widgetId),
            view[to],
          );
        assert.equal(m.message_id, w.messageId);
        assert.equal(messageKind(m), to);
        assert.equal(created.size, before);
        report({
          phase: "conversion",
          from,
          to,
          ok: true,
          sameMessageId: true,
        });
      } catch (e) {
        if (e.code !== "telegram_api_error") throw e;
        report({
          phase: "conversion",
          from,
          to,
          ok: false,
          error: String(e.message).slice(0, 200),
        });
      } finally {
        await clean(w);
      }
    }
    for (const from of ["location", "venue"]) {
      const w = await widget(view[from], "Location conversion");
      try {
        const m = await service.renderer.publish(
          service.store.get(w.widgetId),
          {
            location: { latitude: 1, longitude: 1, live_period: 60 },
          },
        );
        report({
          phase: "conversion",
          from,
          to: "live_location",
          ok: true,
          sameMessageId: m.message_id === w.messageId,
        });
      } catch (e) {
        if (e.code !== "telegram_api_error") throw e;
        report({
          phase: "conversion",
          from,
          to: "live_location",
          ok: false,
          error: String(e.message).slice(0, 200),
        });
      } finally {
        await clean(w);
      }
    }
    const media = {
      photo: "photo.jpg",
      video: "video.mp4",
      animation: "animation.gif",
      audio: "audio.mp3",
      document: "document.txt",
      voice_note: "audio.mp3",
    };
    const block = (kind) => ({
      type: kind,
      [kind]: { type: kind, media: "file:" + media[kind] },
      caption: { text: kind },
    });
    for (const kind of Object.keys(media))
      for (const layout of ["plain", "details", "list", "slideshow"]) {
        let w;
        const b = block(kind),
          blocks =
            layout === "plain"
              ? [b]
              : layout === "details"
                ? [{ type: "details", summary: "Expand", blocks: [b] }]
                : layout === "list"
                  ? [{ type: "list", items: [{ blocks: [b] }] }]
                  : [{ type: "slideshow", blocks: [b, block("photo")] }];
        try {
          w = await widget(
            { rich_message: { blocks } },
            `Rich ${kind} ${layout}`,
          );
          const before = uploads.length;
          await service.renderer.publish(service.store.get(w.widgetId), {
            rich_message: {
              blocks: [
                { type: "paragraph", text: "Cached revision" },
                ...blocks,
              ],
            },
          });
          assert.equal(
            uploads.slice(before).reduce((n, x) => n + x.files, 0),
            0,
          );
          report({ phase: "rich", kind, layout, ok: true, cached: true });
        } catch (e) {
          if (e.code === "media_mapping_failed") throw e;
          if (e.code !== "telegram_api_error") throw e;
          report({
            phase: "rich",
            kind,
            layout,
            ok: false,
            error: String(e.message).slice(0, 200),
          });
        } finally {
          if (w) await clean(w);
        }
      }
    const nested = {
      rich_message: {
        blocks: [
          {
            type: "details",
            summary: "Mixed media",
            blocks: [
              {
                type: "list",
                items: [
                  {
                    blocks: [block("photo"), block("video"), block("document")],
                  },
                ],
              },
              {
                type: "map",
                location: { latitude: 35.1856, longitude: 33.3823 },
                zoom: 12,
              },
            ],
          },
        ],
      },
    };
    const htmlStyle = normalizeRender(
      jsx(Fragment, {
        children: [
          jsx("details", {
            open: true,
            children: [
              jsx("summary", { children: "Native HTML aliases" }),
              jsx("p", {
                children: [
                  "Time: ",
                  jsx("tg-time", {
                    unix: "1800000000",
                    format: "r",
                    children: "Later",
                  }),
                  " ",
                  jsx("a", { href: "#note", children: "Reference" }),
                  jsx("tg-reference", { name: "note", children: "Details" }),
                ],
              }),
            ],
          }),
          jsx("table", {
            bordered: true,
            compact: true,
            children: [
              jsx("caption", { children: "Table" }),
              jsx("tr", { children: jsx("th", { children: "Header" }) }),
              jsx("tr", {
                children: jsx("td", { align: "center", children: "Value" }),
              }),
            ],
          }),
          jsx("figure", {
            children: [
              jsx("img", { src: "file:photo.jpg", "tg-spoiler": true }),
              jsx("figcaption", {
                children: ["Photo", jsx("cite", { children: "Fixture" })],
              }),
            ],
          }),
          jsx("tg-map", {
            lat: "35.18",
            long: "33.38",
            zoom: "14",
            width: "400",
            height: "240",
          }),
          jsx("tg-math-block", { children: "x^2+y^2" }),
        ],
      }),
    );
    const htmlWidget = await widget(htmlStyle, "JSX native HTML-style aliases");
    assert.equal(
      service.store.get(htmlWidget.widgetId).message.rich_message.blocks[0]
        .is_open,
      true,
    );
    await clean(htmlWidget);
    report({ phase: "jsx-html-aliases", ok: true });
    const n = await widget(nested, "Nested mixed media and map");
    const before = uploads.length,
      reordered = structuredClone(nested);
    reordered.rich_message.blocks[0].blocks[0].items[0].blocks.reverse();
    reordered.rich_message.blocks[0].summary = "Reordered";
    await service.renderer.publish(service.store.get(n.widgetId), reordered);
    assert.equal(
      uploads.slice(before).reduce((a, x) => a + x.files, 0),
      0,
    );
    fs.appendFileSync(path.join(wiki, "document.txt"), " changed");
    const after = uploads.length;
    reordered.rich_message.blocks[0].summary = "Changed file";
    await service.renderer.publish(service.store.get(n.widgetId), reordered);
    assert.equal(
      uploads.slice(after).reduce((a, x) => a + x.files, 0),
      1,
    );
    await clean(n);
    report({
      phase: "rich",
      kind: "mixed",
      layout: "nested-map-reorder-change",
      ok: true,
    });
    const live = await widget(
      {
        location: { latitude: 35.1856, longitude: 33.3823, live_period: 60 },
        reply_markup: keyboard,
      },
      "Live location",
    );
    await service.renderer.publish(service.store.get(live.widgetId), {
      location: { latitude: 35.19, longitude: 33.39, live_period: 60 },
      reply_markup: keyboard,
    });
    await call("stopMessageLiveLocation", {
      chat_id: chatId,
      message_id: live.messageId,
    });
    await clean(live);
    report({ phase: "live-location", ok: true });
    const covered = await widget(
      {
        video: "file:video.mp4",
        cover: "file:photo.jpg",
        thumbnail: "file:thumb.jpg",
        caption: "With cover and thumbnail",
        reply_markup: keyboard,
      },
      "Video cover/thumbnail",
    );
    const coverBefore = uploads.length;
    await service.renderer.publish(service.store.get(covered.widgetId), {
      video: "file:video.mp4",
      cover: "file:photo.jpg",
      thumbnail: "file:thumb.jpg",
      caption: "Cached cover; fresh thumbnail",
      reply_markup: keyboard,
    });
    assert.equal(
      uploads.slice(coverBefore).reduce((n, x) => n + x.files, 0),
      1,
    );
    await clean(covered);
    report({ phase: "cover-thumbnail", ok: true });
    const passiveId = -1004380172914,
      passive = await call("getChat", { chat_id: passiveId });
    db.saveChat(botId, passive);
    const cross = await service.set(scope, {
      chatId: passiveId,
      handler: "handler.ts",
      description: "Passive cross-chat fixture",
      state: {
        view: { text: "WIDGET ACCEPTANCE: cross-chat", reply_markup: keyboard },
      },
      disable_notification: true,
    });
    assert.equal(service.store.get(cross.widgetId).chatId, passiveId);
    await clean(cross);
    report({ phase: "cross-chat", ok: true });
  }
  report({
    phase: "complete",
    passed: true,
    conversions: records.filter((r) => r.phase === "conversion").length,
  });
} finally {
  await service.close();
  for (const encoded of created) {
    const [destination, messageId] = JSON.parse(encoded);
    try {
      await call("deleteMessage", {
        chat_id: destination,
        message_id: messageId,
      });
    } catch (e) {
      records.push({
        phase: "cleanup",
        messageId,
        error: String(e.message).slice(0, 200),
      });
    }
    await new Promise((r) => setTimeout(r, 60));
  }
  fs.writeFileSync(
    path.join(root, "results.json"),
    JSON.stringify({ platform: process.platform, records }, null, 2),
  );
  console.log(
    JSON.stringify({
      root,
      records: records.length,
      cleanupFailures: records.filter((x) => x.phase === "cleanup").length,
    }),
  );
  db.close();
}
