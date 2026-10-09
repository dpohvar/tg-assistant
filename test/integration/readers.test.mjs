import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertPublicUrl, publicAddress } from "../../src/readers/network.mjs";
import { browserRead, summarizePage } from "../../src/readers/browser.mjs";
import { pdfRead } from "../../src/readers/pdf.mjs";
import { BotFiles } from "../../src/files/paths.mjs";
import { dynamicTools } from "../../src/codex/threads.mjs";

test("public URL policy rejects private, mapped, reserved addresses and credentials", async () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "0.0.0.0",
    "100.64.0.1",
    "198.18.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
  ])
    assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress("8.8.8.8"), true);
  assert.equal(publicAddress("2606:4700:4700::1111"), true);
  for (const url of [
    "file:///etc/passwd",
    "http://localhost",
    "https://u:p@example.com",
    "http://example.com:22",
    "http://[::1]",
  ])
    await assert.rejects(assertPublicUrl(url));
  await assert.rejects(
    assertPublicUrl("https://example.com", async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]),
  );
  assert.equal(
    (
      await assertPublicUrl("https://example.com", async () => [
        { address: "8.8.8.8", family: 4 },
      ])
    ).address,
    "8.8.8.8",
  );
});
test("browser output reports security challenges and bounded text", () => {
  assert.equal(
    summarizePage(
      "x",
      "https://example.com",
      "Let's confirm you are human\nBegin",
    ).error,
    "browser_challenge",
  );
  const result = summarizePage("x", "https://example.com", "a".repeat(40000));
  assert.equal(result.text.length, 30000);
  assert.equal(result.truncated, true);
});
test("browser rejects private URL before launching Chromium", async () => {
  let launched = false;
  const result = await browserRead(
    { url: "http://127.0.0.1" },
    {
      launch: () => {
        launched = true;
      },
    },
  );
  assert.equal(result.error, "browser_read_failed");
  assert.equal(launched, false);
});
test("pdf uses approved file bytes, page selection, render output and temporary cleanup", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reader-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = new BotFiles(root, "a1");
  files.write("ticket.pdf", Buffer.from("%PDF-1.3\nfixture"));
  const workdirs = [];
  const run = async (cmd, args) => {
    workdirs.push(
      path.dirname(args.find((a) => a.endsWith("input.pdf")) ?? args.at(-1)),
    );
    if (cmd === "pdfinfo") return "Pages: 4\n";
    if (cmd === "pdftotext") return `Page ${args[1]} text`;
    if (cmd === "pdftoppm") {
      fs.writeFileSync(args.at(-1) + ".png", Buffer.from("png"));
      return "";
    }
    throw Error(cmd);
  };
  const result = await pdfRead(
    files,
    { path: "ticket.pdf", pages: [3, 1], render: true },
    { run },
  );
  assert.equal(result.totalPages, 4);
  assert.deepEqual(
    result.pages.map((p) => p.page),
    [3, 1],
  );
  assert.equal(result.pages[0].text, "Page 3 text");
  assert.equal(files.read(result.pages[0].imagePath).toString(), "png");
  assert.ok(workdirs.every((dir) => !fs.existsSync(dir)));
  assert.equal(
    (await pdfRead(files, { path: ".temp/a2/input.pdf" }, { run })).error,
    "pdf_read_failed",
  );
  assert.equal(
    (await pdfRead(files, { path: "ticket.pdf", pages: [5] }, { run })).error,
    "pdf_read_failed",
  );
  assert.equal(
    (await pdfRead(files, { path: "ticket.pdf", pages: [1, 1] }, { run }))
      .error,
    "pdf_read_failed",
  );
});
test("reader dynamic tools expose only URL and permitted PDF reading", () => {
  assert.ok(dynamicTools.find((t) => t.name === "browser_read"));
  assert.ok(dynamicTools.find((t) => t.name === "pdf_read"));
});

test("ordinary CAPTCHA article is readable", () =>
  assert.equal(
    summarizePage(
      "What is CAPTCHA?",
      "https://example.com",
      "What is CAPTCHA? A guide to security challenges.",
    ).error,
    undefined,
  ));

test("browser route isolation, PDF URLs and failure cleanup", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "browser-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = new BotFiles(root, "a1");
  let closed = 0,
    options,
    contextOptions;
  const makeLaunch =
    (mime, fail = false) =>
    async (opts) => {
      options = opts;
      let handler;
      const frame = {};
      const page = {
        mainFrame: () => frame,
        goto: async (url) => {
          const req = {
            url: () => url,
            method: () => "GET",
            isNavigationRequest: () => true,
            frame: () => frame,
          };
          await handler({
            request: () => req,
            fulfill: async () => {},
            abort: async () => {},
          });
          if (fail) throw Error("navigation failed");
        },
        waitForTimeout: async () => {},
        locator: () => ({ innerText: async () => "Hello page" }),
        title: async () => "Title",
        url: () => "https://example.com",
      };
      return {
        close: async () => closed++,
        newContext: async (opts) => {
          contextOptions = opts;
          return {
            addInitScript: async () => {},
            routeWebSocket: async () => {},
            route: async (_pattern, h) => {
              handler = h;
            },
            pages: () => [page],
            newPage: async () => page,
          };
        },
      };
    };
  const fetch = async () => ({
    status: 200,
    headers: { "content-type": "application/pdf" },
    body: Buffer.from("%PDF-fixture"),
  });
  const result = await browserRead(
    { url: "https://example.com" },
    { files, launch: makeLaunch("pdf"), fetch },
  );
  assert.equal(result.contentType, "application/pdf");
  assert.equal(files.read(result.path).toString(), "%PDF-fixture");
  assert.equal(closed, 1);
  assert.equal(options.chromiumSandbox, true);
  assert.ok(
    options.args.includes(
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    ),
  );
  assert.ok(options.args.includes("--proxy-bypass-list=<-loopback>"));
  assert.equal(contextOptions.serviceWorkers, "block");
  assert.equal(
    (
      await browserRead(
        { url: "https://example.com" },
        { launch: makeLaunch("html", true), fetch },
      )
    ).error,
    "browser_read_failed",
  );
  assert.equal(closed, 2);
});

test(
  "native Alpine Chromium renders JS and blocks private subresources/WebRTC",
  { skip: process.env.TG_READERS_NATIVE !== "1" },
  async () => {
    const { fetchPublic } = await import("../../src/readers/network.mjs");
    const html = `<html><body>Loading<script>setTimeout(async()=>{let blocked;try{await fetch('http://127.0.0.1/secret');blocked=false;}catch{blocked=true;}document.body.innerText='JS ready; private blocked='+blocked+'; rtc='+(typeof RTCPeerConnection);},100);</script></body></html>`;
    const result = await browserRead(
      { url: "https://example.com" },
      {
        fetch: async (url, opts) =>
          url === "https://example.com/" || url === "https://example.com"
            ? {
                status: 200,
                headers: { "content-type": "text/html" },
                body: Buffer.from(html),
              }
            : fetchPublic(url, opts),
      },
    );
    assert.equal(result.error, undefined, result.description);
    assert.match(result.text, /JS ready; private blocked=true; rtc=undefined/);
  },
);

test(
  "native Poppler extracts page text and renders PNG",
  { skip: process.env.TG_READERS_NATIVE !== "1" },
  async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-native-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const files = new BotFiles(root, "a1");
    const content = "BT /F1 20 Tf 20 180 Td (PDF native test) Tj ET";
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 220] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    ];
    let pdf = "%PDF-1.4\n",
      offsets = [0];
    objects.forEach((object, index) => {
      offsets.push(Buffer.byteLength(pdf));
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((n) => String(n).padStart(10, "0") + " 00000 n ")
      .join(
        "\n",
      )}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    files.write("test.pdf", Buffer.from(pdf));
    const result = await pdfRead(files, { path: "test.pdf", render: true });
    assert.equal(result.error, undefined, result.description);
    assert.equal(result.totalPages, 1);
    assert.match(result.pages[0].text, /PDF native test/);
    assert.equal(
      files.read(result.pages[0].imagePath).subarray(1, 4).toString(),
      "PNG",
    );
  },
);

test("DNS and late Chromium launch obey timeout and close the late browser", async () => {
  const { abortable } = await import("../../src/readers/network.mjs");
  const control = new AbortController();
  const pending = assertPublicUrl(
    "https://example.com",
    () => new Promise(() => {}),
    control.signal,
  );
  control.abort(Error("expired"));
  await assert.rejects(pending, /expired/);
  let closed = false;
  const result = await browserRead(
    { url: "https://example.com" },
    {
      timeout: 50,
      launch: async () => {
        await new Promise((r) => setTimeout(r, 150));
        return {
          close: async () => {
            closed = true;
          },
        };
      },
    },
  );
  assert.equal(result.error, "browser_read_failed");
  await new Promise((r) => setTimeout(r, 160));
  assert.equal(closed, true);
});

test(
  "native browser handles more than five concurrent small JS resources",
  { skip: process.env.TG_READERS_NATIVE !== "1" },
  async () => {
    const html =
      '<html><body>Loading<script>Promise.all(Array.from({length:8},(_,i)=>fetch("/asset?i="+i).then(r=>r.text()))).then(v=>document.body.innerText="Loaded "+v.length).catch(()=>document.body.innerText="Failed");</script></body></html>';
    const result = await browserRead(
      { url: "https://example.com" },
      {
        fetch: async (url) => {
          await new Promise((r) => setTimeout(r, 100));
          return {
            status: 200,
            headers: {
              "content-type": url.includes("/asset?")
                ? "text/plain"
                : "text/html",
            },
            body: Buffer.from(url.includes("/asset?") ? "asset" : html),
          };
        },
      },
    );
    assert.equal(result.error, undefined, result.description);
    assert.equal(result.text, "Loaded 8");
  },
);

test("expanded IPv6 cannot bypass reserved-address checks", () => {
  for (const ip of [
    "2001:0000:0000:0000:0000:0000:0000:0001",
    "2001:0db8::1",
    "2001:0002::1",
    "3fff::1",
  ])
    assert.equal(publicAddress(ip), false, ip);
});

test("controller dispatches readers within current scope and rejects foreign temp", async (t) => {
  const { openDatabase } = await import("../../src/storage/database.mjs");
  const { createController } = await import("../../src/controller.mjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reader-controller-"));
  const db = openDatabase(path.join(root, "db.sqlite"));
  db.registerBot({ botId: "b", telegramId: 42, username: "bot", ownerId: 1 });
  db.saveChat("b", { id: 1, type: "private" });
  const agent = db.ensureAgent("b", 1);
  const controller = createController({
    db,
    agent: {},
    telegram: {},
    config: { botsDir: path.join(root, "bots") },
  });
  t.after(async () => {
    await controller.close();
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const scope = controller.lifecycle.scope(agent);
  assert.equal(
    (
      await controller.invoke(scope, "browser_read", {
        url: "http://127.0.0.1",
      })
    ).error,
    "browser_read_failed",
  );
  const pdf = await controller.invoke(scope, "pdf_read", {
    path: ".temp/other/private.pdf",
  });
  assert.equal(pdf.error, "pdf_read_failed");
  assert.match(pdf.description, /permitted/);
  controller.lifecycle.invalidate(agent.agentId);
  await assert.rejects(
    controller.invoke(scope, "browser_read", { url: "https://example.com" }),
  );
});
