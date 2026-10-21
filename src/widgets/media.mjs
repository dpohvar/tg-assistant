import fs from "node:fs";
import path from "node:path";
import { widgetError } from "./contract.mjs";
import { mapMediaSources } from "../files/media.mjs";
const at = (v, p) => p.reduce((o, k) => o?.[k], v);
export function prepareWidgetMedia(
  input,
  { files, cache },
) {
  const value = structuredClone(input),
    uploads = [],
    manifest = [],
    signatures = [];
  let count = 0;
  function source(src, p, role, responsePath = p) {
    if (typeof src !== "string")
      throw widgetError("invalid_argument", "Media src must be a string.");
    if (/^https?:\/\/api\.telegram\.org\/(?:file\/)?bot/i.test(src))
      throw widgetError(
        "file_not_accessible",
        "Secret-bearing Telegram URLs cannot be rendered.",
      );
    if (!src.startsWith("file:") && !/^https?:\/\//i.test(src)) {
      if (src.startsWith("attach://"))
        throw widgetError(
          "invalid_argument",
          "Use file:path for managed uploads.",
        );
      return src;
    }
    let key = `${role}:${src}`,
      bytes,
      filename,
      stat,
      file;
    if (src.startsWith("file:")) {
      file = src.slice(5);
      stat = files.withParent(file, false, (p) => fs.statSync(p));
      key += `:${stat.mtimeMs}:${stat.size}`;
      filename = path.basename(file);
    }
    signatures.push(key);
    if (role !== "thumbnail" && cache.has(key)) return cache.get(key);
    if (file) {
      bytes = files.read(file);
      const after = files.withParent(file, false, (p) => fs.statSync(p));
      if (after.mtimeMs !== stat.mtimeMs || after.size !== stat.size)
        throw widgetError(
          "invalid_argument",
          "Media file changed while being read.",
        );
    }
    const record = {
      key,
      path: responsePath,
      role,
      source: src,
      cacheable: role !== "thumbnail",
    };
    manifest.push(record);
    if (!bytes) return src;
    const name = "widget_media_" + count++;
    uploads.push({ name, filename, bytes });
    return "attach://" + name;
  }
  mapMediaSources(value, source);
  return { value, uploads, manifest, signatures };
}
export function cacheWidgetMedia(prepared, message, cache) {
  const additions = [];
  for (const m of prepared.manifest) {
    if (m.cacheable === false) continue;
    let media = at(message, m.path);
    if (Array.isArray(media))
      media = [...media].sort(
        (a, b) =>
          (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0),
      )[0];
    if (!media?.file_id)
      throw widgetError(
        "media_mapping_failed",
        "Telegram media paths did not match the request manifest; cache was not populated.",
      );
    additions.push([m.key, media.file_id]);
  }
  for (const [key, id] of additions) cache.set(key, id);
}
