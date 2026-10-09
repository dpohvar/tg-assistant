import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);
const runCommand = async (command, args, signal) =>
  (
    await execute(command, args, {
      signal,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    })
  ).stdout;

export async function pdfRead(files, args, { run = runCommand } = {}) {
  let dir;
  try {
    if (
      !args ||
      typeof args.path !== "string" ||
      (args.render !== undefined && typeof args.render !== "boolean")
    )
      throw Error("Use path, optional pages array and render boolean.");
    const bytes = files.read(args.path);
    if (
      bytes.length > 20 * 1024 * 1024 ||
      !bytes.subarray(0, 1024).includes(Buffer.from("%PDF-"))
    )
      throw Error("Input must be a PDF no larger than 20 MiB.");
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "tg-pdf-"));
    const input = path.join(dir, "input.pdf");
    await fs.writeFile(input, bytes, { mode: 0o600 });
    const signal = AbortSignal.timeout(30000);
    const info = await run("pdfinfo", [input], signal);
    const totalPages = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1]);
    if (!Number.isSafeInteger(totalPages) || totalPages < 1)
      throw Error("Cannot determine PDF page count.");
    const selected =
      args.pages ??
      Array.from({ length: Math.min(totalPages, 10) }, (_, i) => i + 1);
    if (
      !Array.isArray(selected) ||
      !selected.length ||
      selected.length > 10 ||
      new Set(selected).size !== selected.length ||
      selected.some((n) => !Number.isSafeInteger(n) || n < 1 || n > totalPages)
    )
      throw Error("Select 1 to 10 distinct page numbers within this PDF.");
    const pages = [];
    const batch = randomUUID();
    for (const page of selected) {
      const text = await run(
        "pdftotext",
        ["-f", String(page), "-l", String(page), "-layout", input, "-"],
        signal,
      );
      const item = {
        page,
        text: text.slice(0, 12000),
        ...(text.length > 12000 ? { truncated: true } : {}),
      };
      if (args.render) {
        const prefix = path.join(dir, `page-${page}`);
        await run(
          "pdftoppm",
          [
            "-f",
            String(page),
            "-l",
            String(page),
            "-singlefile",
            "-scale-to",
            "1800",
            "-png",
            input,
            prefix,
          ],
          signal,
        );
        item.imagePath = `.temp/${files.agentId}/pdf/${batch}/page-${page}.png`;
        files.write(item.imagePath, await fs.readFile(prefix + ".png"), true);
      }
      pages.push(item);
    }
    return { totalPages, pages };
  } catch (error) {
    return {
      error: "pdf_read_failed",
      description:
        error.code === "ENOENT"
          ? "PDF file or Poppler executable is missing. Install poppler-utils and check the permitted file path."
          : `PDF reading failed: ${error.message}`,
    };
  } finally {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  }
}
