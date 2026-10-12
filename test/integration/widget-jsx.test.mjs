import test from "node:test";
import assert from "node:assert/strict";
import {
  jsx,
  Fragment,
  normalizeRender,
} from "../../src/widgets/jsx-runtime.mjs";
test("Telegram HTML aliases preserve map, figure caption, checkbox and button semantics", () => {
  const r = normalizeRender(
    jsx(Fragment, {
      children: [
        jsx("figure", {
          children: [
            jsx("img", { src: "file:x.jpg", "tg-spoiler": true }),
            jsx("figcaption", { children: "Caption" }),
          ],
        }),
        jsx("tg-map", { lat: 1, long: 2, zoom: 14 }),
        jsx("ul", {
          children: jsx("li", {
            children: [
              jsx("input", { type: "checkbox", checked: true }),
              "Item",
            ],
          }),
        }),
        jsx("tg-button-row", {
          children: jsx("tg-button", {
            type: "callback_data",
            data: "vote",
            children: "Vote",
          }),
        }),
      ],
    }),
  ).rich_message.blocks;
  assert.equal(r[0].caption.text, "Caption");
  assert.equal(r[0].has_spoiler, true);
  assert.deepEqual(r[1].location, { latitude: 1, longitude: 2 });
  assert.equal(r[2].items[0].is_checked, true);
  assert.equal(r[3].buttons[0].callback_data, "vote");
});
test("HTML-style table, open details, caption credit, formulas and references use native fields", () => {
  const rich = normalizeRender(
    jsx(Fragment, {
      children: [
        jsx("details", {
          open: true,
          children: [
            jsx("summary", { children: "Title" }),
            jsx("p", { children: "Body" }),
          ],
        }),
        jsx("table", {
          bordered: true,
          striped: true,
          compact: true,
          children: [
            jsx("caption", { children: "Table" }),
            jsx("tr", {
              children: jsx("th", { colspan: "2", children: "Cell" }),
            }),
          ],
        }),
        jsx("figure", {
          children: [
            jsx("img", { src: "file:x.jpg" }),
            jsx("figcaption", {
              children: ["Photo", jsx("cite", { children: "Credit" })],
            }),
          ],
        }),
        jsx("pre", {
          children: jsx("code", { class: "language-js", children: "let n=1;" }),
        }),
        jsx("p", {
          children: [
            jsx("a", { href: "#note", children: "Read" }),
            jsx("tg-reference", { name: "note", children: "Details" }),
            jsx("tg-time", { unix: "123", format: "r", children: "Then" }),
            jsx("tg-math", { children: "x^2" }),
          ],
        }),
        jsx("tg-math-block", { children: "y^2" }),
      ],
    }),
  ).rich_message.blocks;
  assert.equal(rich[0].is_open, true);
  assert.equal(rich[0].open, undefined);
  assert.equal(rich[1].is_compact, true);
  assert.equal(rich[1].cells[0][0].colspan, 2);
  assert.equal(rich[2].caption.credit, "Credit");
  assert.equal(rich[3].language, "js");
  assert.equal(rich[4].text[0].type, "reference_link");
  assert.equal(rich[4].text[2].unix_time, 123);
  assert.equal(rich[4].text[3].type, "mathematical_expression");
  assert.equal(rich[5].expression, "y^2");
});
test("plain JSX emits UTF-16 entities and cannot mix formatting", () => {
  const text = jsx(Fragment, {
    children: ["🙂 ", jsx("b", { children: "Hello" })],
  });
  assert.deepEqual(normalizeRender({ text }), {
    text: "🙂 Hello",
    entities: [{ type: "bold", offset: 3, length: 5 }],
  });
  assert.throws(
    () => normalizeRender({ text, parse_mode: "HTML" }),
    /invalid_argument/,
  );
});
test("rich JSX keeps exact nested media paths for details, lists and galleries", () => {
  const v = jsx("details", {
    children: [
      jsx("summary", { children: "Show" }),
      jsx("ul", {
        children: jsx("li", { children: jsx("img", { src: "file:cat.png" }) }),
      }),
    ],
  });
  const r = normalizeRender(v);
  assert.equal(r.rich_message.blocks[0].summary, "Show");
  assert.equal(
    r.rich_message.blocks[0].blocks[0].items[0].blocks[0].photo.media,
    "file:cat.png",
  );
});
test("buttons use registered names, reject system exports and exactly one message type", () => {
  assert.throws(
    () => normalizeRender({ text: "x", photo: "y" }),
    /invalid_argument/,
  );
  assert.throws(
    () =>
      normalizeRender({
        text: "x",
        reply_markup: {
          inline_keyboard: [[{ text: "Bad", callback_data: "render" }]],
        },
      }),
    /invalid_argument/,
  );
});
