import { widgetCallbackAction, widgetError, plainJSON } from "./contract.mjs";
export const Fragment = "widget-fragment";
export function jsx(type, props = {}) {
  return typeof type === "function"
    ? type(props)
    : { $widget: true, type, props: props ?? {} };
}
export const jsxs = jsx;
export const jsxDEV = jsx;
const nodes = (v) =>
  Array.isArray(v)
    ? v.flatMap(nodes)
    : v == null || v === false || v === true
      ? []
      : [v];
const node = (v) => v?.$widget === true;
const fmt = {
  b: "bold",
  strong: "bold",
  i: "italic",
  em: "italic",
  u: "underline",
  ins: "underline",
  s: "strikethrough",
  strike: "strikethrough",
  del: "strikethrough",
  spoiler: "spoiler",
  "tg-spoiler": "spoiler",
  code: "code",
  sub: "subscript",
  sup: "superscript",
  mark: "marked",
};
function richButton(x) {
  const { children, type, data, query, text, ...a } = x.props;
  const button = { text: richText(children), ...a };
  if (type === "callback_data") button.callback_data = data;
  else if (type === "disabled") button.disabled = {};
  else if (type === "copy_text") button.copy_text = { text };
  else if (type?.startsWith("switch_inline_query")) button[type] = query ?? "";
  else if (type === "web_app" || type === "login_url") {
    button[type] = { url: a.url };
    delete button.url;
  } else if (type && type !== "url")
    throw widgetError("invalid_argument", "Unsupported button type.");
  return button;
}
function richText(v) {
  const result = nodes(v)
    .map((x) => {
      if (!node(x)) return String(x);
      const p = x.props;
      if (x.type === Fragment) return richText(p.children);
      if (fmt[x.type]) return { type: fmt[x.type], text: richText(p.children) };
      if (x.type === "button" || x.type === "tg-button")
        return { type: "button", button: richButton(x) };
      if (x.type === "a") {
        if (p.name) return { type: "anchor", name: p.name };
        const text = richText(p.children);
        if (p.href?.startsWith("#"))
          return { type: "anchor_link", anchor_name: p.href.slice(1), text };
        if (p.href?.startsWith("mailto:"))
          return {
            type: "email_address",
            email_address: p.href.slice(7),
            text,
          };
        if (p.href?.startsWith("tel:"))
          return { type: "phone_number", phone_number: p.href.slice(4), text };
        return { type: "url", url: p.href, text };
      }
      if (x.type === "tg-reference")
        return { type: "reference", name: p.name, text: richText(p.children) };
      if (x.type === "tg-time")
        return {
          type: "date_time",
          unix_time: Number(p.unix),
          date_time_format: p.format ?? "",
          text: richText(p.children),
        };
      if (x.type === "tg-math")
        return {
          type: "mathematical_expression",
          expression: String(p.children ?? ""),
        };
      if (
        x.type === "span" &&
        (p.class === "tg-spoiler" || p.className === "tg-spoiler")
      )
        return { type: "spoiler", text: richText(p.children) };
      if (x.type === "img" && p.src?.startsWith("tg://emoji?id="))
        return {
          type: "custom_emoji",
          custom_emoji_id: p.src.split("id=")[1],
          alternative_text: p.alt ?? "🙂",
        };
      if (x.type === "br") return "\n";
      if (x.type === "emoji" || x.type === "tg-emoji")
        return {
          type: "custom_emoji",
          custom_emoji_id: p.id ?? p["emoji-id"],
          alternative_text: String(p.children ?? "🙂"),
        };
      throw widgetError(
        "invalid_argument",
        `Unsupported inline JSX tag ${x.type}.`,
      );
    })
    .flat();
  return result.every((x) => typeof x === "string") ? result.join("") : result;
}
function plainText(v) {
  let text = "",
    entities = [];
  function visit(x) {
    for (const n of nodes(x)) {
      if (!node(n)) {
        text += String(n);
        continue;
      }
      const start = text.length;
      visit(n.props.children);
      if (n.type === "br") {
        text += "\n";
        continue;
      }
      if (n.type === Fragment) continue;
      const type =
        fmt[n.type] ??
        (n.type === "a"
          ? "text_link"
          : n.type === "pre"
            ? "pre"
            : n.type === "blockquote"
              ? n.props.expandable
                ? "expandable_blockquote"
                : "blockquote"
              : n.type === "tg-emoji"
                ? "custom_emoji"
                : n.type === "tg-time"
                  ? "date_time"
                  : n.type === "span" &&
                      (n.props.class === "tg-spoiler" ||
                        n.props.className === "tg-spoiler")
                    ? "spoiler"
                    : null);
      if (!type || ["subscript", "superscript", "marked"].includes(type))
        throw widgetError("invalid_argument", "Unsupported plain-text tag.");
      entities.push({
        type,
        offset: start,
        length: text.length - start,
        ...(type === "text_link" ? { url: n.props.href } : {}),
        ...(type === "pre" && n.props.language
          ? { language: n.props.language }
          : {}),
        ...(type === "custom_emoji"
          ? { custom_emoji_id: n.props["emoji-id"] ?? n.props.id }
          : {}),
        ...(type === "date_time"
          ? {
              unix_time: Number(n.props.unix),
              date_time_format: n.props.format ?? "",
            }
          : {}),
      });
    }
  }
  visit(v);
  return { text, entities };
}
function richCaption(value) {
  const c = nodes(value),
    cite = c.find((v) => node(v) && v.type === "cite");
  return {
    text: richText(c.filter((v) => v !== cite)),
    ...(cite ? { credit: richText(cite.props.children) } : {}),
  };
}
function richBlocks(value) {
  const out = [];
  for (const n of nodes(value)) {
    if (!node(n)) {
      out.push({ type: "paragraph", text: String(n) });
      continue;
    }
    let { type, props: p } = n;
    const aliases = {
      "tg-map": "map",
      "tg-slideshow": "slideshow",
      "tg-collage": "collage",
      "tg-document": "document",
      "tg-button-row": "buttons",
      "tg-button": "button",
      "tg-math-block": "math",
      aside: "pullquote",
    };
    type = aliases[type] ?? type;
    const { children, ...attr } = p;
    if (type === "figure") {
      const c = nodes(children),
        caption = c.find((x) => node(x) && x.type === "figcaption"),
        blocks = richBlocks(c.filter((x) => x !== caption));
      if (blocks.length !== 1)
        throw widgetError(
          "invalid_argument",
          "Figure must wrap one media/map/gallery.",
        );
      if (caption) blocks[0].caption = richCaption(caption.props.children);
      out.push(...blocks);
      continue;
    }
    if (type === "a" && p.name) {
      out.push({ type: "anchor", name: p.name });
      continue;
    }
    if (type === Fragment) {
      out.push(...richBlocks(children));
      continue;
    }
    if (
      [
        "figure",
        "p",
        "footer",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "pre",
        "blockquote",
        "details",
        "ul",
        "ol",
        "li",
        "slideshow",
        "collage",
        "map",
        "buttons",
        "button",
        "hr",
        "table",
        "tr",
        "td",
        "th",
        "summary",
        "img",
        "video",
        "audio",
        "animation",
        "document",
        "voice",
        "voice-note",
        "a",
        "anchor",
        "math",
        "pullquote",
      ].includes(type) === false
    ) {
      out.push({ type: "paragraph", text: richText(n) });
      continue;
    }
    if (type === "p" || type === "footer" || /^h[1-6]$/.test(type)) {
      out.push({
        type:
          type === "p" ? "paragraph" : type === "footer" ? "footer" : "heading",
        text: richText(children),
        ...(/^h/.test(type) ? { size: +type.slice(1) } : {}),
        ...attr,
      });
      continue;
    }
    if (type === "hr") {
      out.push({ type: "divider" });
      continue;
    }
    if (type === "pre") {
      const code = nodes(children).find((v) => node(v) && v.type === "code"),
        language =
          p.language ??
          /language-([^\s]+)/.exec(
            code?.props.class ?? code?.props.className ?? "",
          )?.[1];
      out.push({
        type: "pre",
        text: plainText(code?.props.children ?? children).text,
        ...attr,
        ...(language ? { language } : {}),
      });
      continue;
    }
    if (type === "details") {
      const c = nodes(children),
        summary = c.find((x) => node(x) && x.type === "summary");
      out.push({
        type: "details",
        summary: richText(summary?.props.children ?? p.summary ?? "Details"),
        blocks: richBlocks(c.filter((x) => x !== summary)),
        ...Object.fromEntries(
          Object.entries(attr).filter(
            ([k]) => !["open", "summary"].includes(k),
          ),
        ),
        ...(p.open ? { is_open: true } : {}),
      });
      continue;
    }
    if (type === "ul" || type === "ol") {
      out.push({
        type: "list",
        items: nodes(children).map((x, i) => {
          if (!node(x) || x.type !== "li")
            throw widgetError("invalid_argument", "List children must be li.");
          const { children, ...a } = x.props;
          const c = nodes(children),
            checkbox = c.find(
              (v) =>
                node(v) && v.type === "input" && v.props.type === "checkbox",
            );
          return {
            blocks: richBlocks(c.filter((v) => v !== checkbox)),
            ...(checkbox
              ? {
                  has_checkbox: true,
                  ...(checkbox.props.checked ? { is_checked: true } : {}),
                }
              : {}),
            ...(type === "ol"
              ? {
                  type: p.type ?? "1",
                  value: Number(p.start ?? 1) + (p.reversed ? -i : i),
                }
              : {}),
            ...a,
          };
        }),
        ...attr,
      });
      continue;
    }
    if (["blockquote", "slideshow", "collage", "pullquote"].includes(type)) {
      const c = nodes(children),
        cite = c.find((v) => node(v) && v.type === "cite"),
        caption = c.find((v) => node(v) && v.type === "figcaption"),
        body = c.filter((v) => v !== cite && v !== caption),
        { expandable, ...options } = attr;
      out.push({
        type: expandable ? "expandable_blockquote" : type,
        ...(expandable || type === "pullquote"
          ? { text: richText(body) }
          : { blocks: richBlocks(body) }),
        ...(cite ? { credit: richText(cite.props.children) } : {}),
        ...(caption ? { caption: richCaption(caption.props.children) } : {}),
        ...options,
      });
      continue;
    }
    if (type === "map") {
      const { lat, long, ...options } = attr;
      out.push({
        type: "map",
        ...(lat !== undefined || long !== undefined
          ? { location: { latitude: Number(lat), longitude: Number(long) } }
          : {}),
        ...options,
        ...Object.fromEntries(
          ["zoom", "width", "height"]
            .filter((k) => options[k] !== undefined)
            .map((k) => [k, Number(options[k])]),
        ),
      });
      continue;
    }
    if (type === "buttons") {
      out.push({
        type: "buttons",
        ...attr,
        buttons: nodes(children).map((x) => {
          if (!node(x) || !["button", "tg-button"].includes(x.type))
            throw widgetError("invalid_argument");
          return richButton(x);
        }),
      });
      continue;
    }
    if (type === "table") {
      const c = nodes(children),
        caption = c.find((v) => node(v) && v.type === "caption");
      out.push({
        type: "table",
        ...Object.fromEntries(
          Object.entries(attr).filter(
            ([k]) => !["bordered", "striped", "compact"].includes(k),
          ),
        ),
        ...Object.fromEntries(
          ["bordered", "striped", "compact"]
            .filter((k) => p[k])
            .map((k) => ["is_" + k, true]),
        ),
        ...(caption ? { caption: richText(caption.props.children) } : {}),
        cells: c
          .filter((v) => v !== caption)
          .map((row) =>
            nodes(row.props.children).map((cell) => ({
              text: richText(cell.props.children),
              align: cell.props.align ?? "left",
              valign: cell.props.valign ?? "top",
              ...(cell.type === "th" ? { is_header: true } : {}),
              ...Object.fromEntries(
                Object.entries(cell.props).filter(([k]) => k !== "children"),
              ),
              ...Object.fromEntries(
                ["colspan", "rowspan"]
                  .filter((k) => cell.props[k] !== undefined)
                  .map((k) => [k, Number(cell.props[k])]),
              ),
            })),
          ),
      });
      continue;
    }
    if (type === "anchor") {
      out.push({ type: "anchor", ...attr });
      continue;
    }
    if (type === "math") {
      out.push({
        type: "mathematical_expression",
        expression: String(children ?? p.expression ?? ""),
      });
      continue;
    }
    if (type === "pullquote") {
      out.push({ type, text: richText(children), ...attr });
      continue;
    }
    const media =
      { img: "photo", voice: "voice_note", "voice-note": "voice_note" }[type] ??
      (type === "audio" && /\.ogg(?:[?#]|$)/i.test(p.src ?? "")
        ? "voice_note"
        : type === "video" && /\.gif(?:[?#]|$)/i.test(p.src ?? "")
          ? "animation"
          : type);
    if (
      [
        "photo",
        "video",
        "animation",
        "audio",
        "document",
        "voice_note",
      ].includes(media)
    ) {
      const { src, caption, "tg-spoiler": spoiler, ...options } = attr;
      if (typeof src !== "string")
        throw widgetError("invalid_argument", "Media src must be a string.");
      out.push({
        type: media,
        [media]: { type: media, media: src, ...options },
        ...(spoiler ? { has_spoiler: true } : {}),
        ...(caption
          ? {
              caption:
                typeof caption === "string" ? { text: caption } : caption,
            }
          : {}),
      });
      continue;
    }
    throw widgetError("invalid_argument", `Unsupported rich block ${type}.`);
  }
  return out;
}
export const CONTENT_TYPES = [
  "text",
  "rich_message",
  "photo",
  "video",
  "animation",
  "document",
  "audio",
  "voice",
  "sticker",
  "video_note",
  "location",
  "venue",
  "contact",
  "poll",
  "dice",
  "live_photo",
];
export function normalizeRender(value) {
  let out =
    node(value) || Array.isArray(value)
      ? { rich_message: { blocks: richBlocks(value) } }
      : { ...value };
  if (!out || CONTENT_TYPES.filter((k) => out[k] !== undefined).length !== 1)
    throw widgetError(
      "invalid_argument",
      "Render must contain exactly one single-message content type.",
    );
  for (const field of ["text", "caption"])
    if (node(out[field]) || Array.isArray(out[field])) {
      if (
        out.parse_mode !== undefined ||
        out[field === "text" ? "entities" : "caption_entities"] !== undefined
      )
        throw widgetError(
          "invalid_argument",
          "Do not mix JSX and formatting fields.",
        );
      const result = plainText(out[field]);
      out[field] = result.text;
      out[field === "text" ? "entities" : "caption_entities"] = result.entities;
    }
  for (const k of [
    "chatId",
    "messageId",
    "topicId",
    "chat_id",
    "message_id",
    "message_thread_id",
    "business_connection_id",
    "inline_message_id",
    "uploads",
    "file_sources",
    "permits",
    "reply_parameters",
    "disable_notification",
    "protect_content",
    "message_effect_id",
  ])
    if (out[k] !== undefined)
      throw widgetError(
        "invalid_argument",
        `Creation/envelope field ${k} belongs in set_widget_view arguments.`,
      );
  const visit = (v) => {
    if (!v || typeof v !== "object") return;
    if (v.callback_data !== undefined) widgetCallbackAction(v.callback_data);
    for (const x of Object.values(v)) visit(x);
  };
  const references = new Set();
  const collectReferences = (v) => {
    if (!v || typeof v !== "object") return;
    if (v.type === "reference") references.add(v.name);
    for (const x of Object.values(v)) collectReferences(x);
  };
  collectReferences(out.rich_message);
  const resolveReferences = (v) => {
    if (!v || typeof v !== "object") return;
    if (v.type === "anchor_link" && references.has(v.anchor_name)) {
      v.type = "reference_link";
      v.reference_name = v.anchor_name;
      delete v.anchor_name;
    }
    for (const x of Object.values(v)) resolveReferences(x);
  };
  resolveReferences(out.rich_message);
  visit(out);
  plainJSON(out);
  return out;
}
