import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  prepareWidgetMedia,
  cacheWidgetMedia,
} from "../../src/widgets/media.mjs";
import { BotFiles } from "../../src/files/paths.mjs";
test("nested request path maps exact file ID, cache reorders safely and changed files upload again", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "widget-media-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "x.jpg"), "first");
  const files = new BotFiles(root, "a"),
    cache = new Map();
  const value = {
    rich_message: {
      blocks: [
        {
          type: "details",
          summary: "Images",
          blocks: [
            { type: "photo", photo: { type: "photo", media: "file:x.jpg" } },
          ],
        },
      ],
    },
  };
  const first = prepareWidgetMedia(value, { files, cache });
  assert.equal(first.uploads.length, 1);
  cacheWidgetMedia(
    first,
    {
      rich_message: {
        blocks: [
          {
            type: "details",
            blocks: [
              {
                type: "photo",
                photo: [
                  { file_id: "small", width: 1, height: 1 },
                  { file_id: "large", width: 2, height: 2 },
                ],
              },
            ],
          },
        ],
      },
    },
    cache,
  );
  const second = prepareWidgetMedia(value, { files, cache });
  assert.equal(second.uploads.length, 0);
  assert.equal(
    second.value.rich_message.blocks[0].blocks[0].photo.media,
    "large",
  );
  fs.writeFileSync(path.join(root, "x.jpg"), "changed content");
  assert.equal(prepareWidgetMedia(value, { files, cache }).uploads.length, 1);
});
test("ambiguous rich response does not populate upload cache", () => {
  const cache = new Map(),
    input = {
      manifest: [
        {
          key: "url",
          path: ["rich_message", "blocks", 0, "photo"],
          role: "photo",
          source: "https://example.com/x",
        },
      ],
    };
  assert.throws(
    () =>
      cacheWidgetMedia(
        input,
        {
          rich_message: {
            blocks: [{ type: "video", video: { file_id: "wrong" } }],
          },
        },
        cache,
      ),
    /media_mapping_failed/,
  );
  assert.equal(cache.size, 0);
});
