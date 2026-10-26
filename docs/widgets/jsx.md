# JSX tags and Telegram layout

[Widget handbook](../widgets.md) · [Getting started](getting-started.md) · [State](state.md) · [Views](views.md) · [Runtime](runtime.md)

The component returns one rich-message tree, a `<tg-dice emoji="🎲"/>`, or a `<tg-sticker src="FILE_ID"/>`. A React fragment (`<>…</>`) combines rich blocks and optional keyboard rows. Ordinary text becomes a rich paragraph. There is no `<tg-message>`, `<tg-paragraph>`, or `<tg-row>` tag. The renderer rejects unknown tags and unsupported attributes; the whitelist in [`projection.mjs`](../../src/widgets/projection.mjs) is authoritative for this version.

| JSX tags | Meaning |
| --- | --- |
| `p`, `h1`–`h6`, `footer`, `hr`, `br` | Paragraph, heading, footer and spacing blocks |
| `b`, `strong`, `i`, `em`, `u`, `ins`, `s`, `strike`, `del`, `mark`, `code`, `pre`, `blockquote`, `span`, `a` | Rich text formatting and links |
| `ul`, `ol`, `li` | Lists |
| `table`, `caption`, `tr`, `td`, `th` | Horizontally scrollable rich tables; `table` accepts `bordered`, `striped`, `compact`; cells accept `align`, `valign`, `colspan`, `rowspan` |
| `img`, `figure`, `figcaption`, `video`, `audio`, `animation`, `document`, `voice`, `voice-note` | Rich media and captions; `img` accepts `src`, `alt`, `width`, `height`, `caption`; other media use `src` and optional caption/dimensions where supported |
| `details`, `summary`, `tg-spoiler` | Disclosure and spoiler content |
| `tg-emoji`, `tg-time`, `tg-reference`, `tg-math`, `tg-math-block`, `tg-map`, `tg-slideshow`, `tg-collage`, `tg-document` | Telegram rich extensions |
| `tg-button-row`, `tg-button` | Rich buttons inside the message body |
| `tg-keyboard`, `tg-button-row`, `tg-button` | Separate inline keyboard below the message; keyboard children must be rows, and row children must be buttons |
| `tg-dice`, `tg-sticker` | Standalone native message body; cannot share a body with rich blocks, but may have a keyboard |

Use `<tg-button onClick={event=>…}>` for a callback. A keyboard button can instead use `url`, `copy_text`, `switch_inline_query`, `switch_inline_query_current_chat`, `switch_inline_query_chosen_chat`, or `disabled`; use exactly one action. `style` accepts Telegram's supported styles such as `primary`, `success`, and `danger`. A rich callback button can use `onClick`; a rich link button can use `url`. Several `<tg-keyboard>` elements concatenate their rows in tree order. JSX buttons need a stable React `key` when generated in a list; a surrounding keyed element is sufficient for its child button.

```tsx
return <>
  <p>Choose an action:</p>
  <tg-button-row>
    <tg-button onClick={event=>event.overlay(<Details/>)}>Open privately</tg-button>
    <tg-button url="https://example.org">Website</tg-button>
  </tg-button-row>
  <tg-keyboard><tg-button-row>
    <tg-button onClick={event=>event.respond("Ready")}>Confirm</tg-button>
  </tg-button-row></tg-keyboard>
</>;
```

Telegram clients have limited message width. Many rich buttons on one row can truncate their labels or hide some buttons. Put several long controls inside a rich `<table>` when horizontal scrolling is useful, or use fewer buttons per row. Check the resulting layout on a real client; keyboard and table layouts differ.

**Custom emoji in groups and supergroups:** when a rich widget message containing custom emoji will be edited, publish it as a reply to a stable message in that chat, for example `send:{chatId,reply_parameters:{message_id:anchorMessageId}}`. In live tests, editing a standalone group rich message replaced custom-emoji tiles with fallback characters; editing a reply-created message preserved them. This is observed Telegram behavior, not a widget renderer rule. An existing message cannot gain a reply anchor by editing it.

Rich messages may be edited. Dice and sticker bodies are creation-only: changing their body, replacing them with rich content, or rendering an empty body later is a render error. Their separate keyboard can change. An empty rich render produces a blank paragraph. For media paths, use `file:path` in supported fields; inline media needs a public URL or an existing Telegram file ID. For exact RichText and media shapes, see [messaging](../messaging.md).
