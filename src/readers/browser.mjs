import { chromium } from "playwright-core";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { assertPublicUrl, fetchPublic, abortable } from "./network.mjs";

export function summarizePage(title, url, text) {
  if (
    /let.s confirm you are human|verify you are human|checking your browser|complete the security check/i.test(
      text.slice(0, 5000),
    )
  )
    return {
      error: "browser_challenge",
      description:
        "The website requires a human security check. Automated reading is unavailable; ask for a PDF, screenshot or pasted text.",
      url,
    };
  return {
    title,
    url,
    text: text.slice(0, 30000),
    ...(text.length > 30000 ? { truncated: true } : {}),
  };
}
export async function browserRead(
  args,
  { files, launch, fetch = fetchPublic, timeout = 30000 } = {},
) {
  let browser;
  const signal = AbortSignal.timeout(timeout);
  try {
    await assertPublicUrl(args.url, undefined, signal);
    signal.throwIfAborted();
    const executablePath =
      process.env.TG_CHROMIUM_PATH ??
      ["/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) =>
        fs.existsSync(p),
      );
    browser = await abortable(
      (launch ?? ((options) => chromium.launch(options)))({
        executablePath,
        headless: true,
        chromiumSandbox: true,
        timeout,
        args: [
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--in-process-gpu",
          "--disable-software-rasterizer",
          "--proxy-server=http://127.0.0.1:9",
          "--proxy-bypass-list=<-loopback>",
          "--host-resolver-rules=MAP * ~NOTFOUND",
          "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
        ],
      }).then(async (instance) => {
        if (signal.aborted) {
          await instance.close();
          signal.throwIfAborted();
        }
        return instance;
      }),
      signal,
    );
    signal.throwIfAborted();
    const context = await browser.newContext({
      serviceWorkers: "block",
      acceptDownloads: false,
    });
    await context.addInitScript(() => {
      for (const key of [
        "RTCPeerConnection",
        "webkitRTCPeerConnection",
        "RTCDataChannel",
      ])
        Object.defineProperty(globalThis, key, {
          value: undefined,
          writable: false,
          configurable: false,
        });
    });
    let count = 0,
      bytes = 0,
      mainResponse,
      blockedMain;
    await context.routeWebSocket("**/*", (socket) => socket.close());
    await context.route("**/*", async (route) => {
      try {
        const request = route.request();
        if (signal.aborted || ++count > 200 || request.method() !== "GET")
          throw Error("Request method, timeout or request budget exceeded.");
        const charge = (size) => {
          bytes += size;
          if (bytes > 100 * 1024 * 1024)
            throw Error("Download budget exceeded.");
        };
        const response = await fetch(request.url(), {
          signal,
          maxBytes: 20 * 1024 * 1024,
          onBytes: charge,
        });
        if (response.body.length > 20 * 1024 * 1024)
          throw Error("Response exceeds download limit.");
        if (!response.charged) charge(response.body.length);
        const headers = Object.fromEntries(
          Object.entries(response.headers).filter(
            ([key, value]) =>
              ![
                "set-cookie",
                "content-length",
                "transfer-encoding",
                "connection",
                "content-encoding",
              ].includes(key) && typeof value === "string",
          ),
        );
        if (
          request.isNavigationRequest() &&
          request.frame() === context.pages()[0]?.mainFrame()
        )
          mainResponse = { ...response, url: request.url() };
        if (
          mainResponse?.url === request.url() &&
          headers["content-type"]?.includes("application/pdf")
        )
          await route.fulfill({
            status: 200,
            contentType: "text/html",
            body: "<html><body>PDF downloaded</body></html>",
          });
        else
          await route.fulfill({
            status: response.status,
            headers,
            body: response.body,
          });
      } catch (error) {
        if (route.request().isNavigationRequest()) blockedMain = error;
        await route.abort().catch(() => {});
      }
    });
    const page = await context.newPage();
    const abort = () => {
      browser?.close().catch(() => {});
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    try {
      await page.goto(args.url, { waitUntil: "domcontentloaded", timeout });
      if (blockedMain) throw blockedMain;
      if (mainResponse?.headers["content-type"]?.includes("application/pdf")) {
        if (mainResponse.status >= 400)
          throw Error(`Website returned HTTP ${mainResponse.status}`);
        if (!files) throw Error("Temporary file storage is not configured.");
        const local = `.temp/${files.agentId}/download/${randomUUID()}.pdf`;
        files.write(local, mainResponse.body, true);
        return {
          url: mainResponse.url,
          path: local,
          contentType: "application/pdf",
        };
      }
      // Let JS fetch data, then wait until the visible text stops changing.
      let previous = "",
        stable = 0;
      for (let i = 0; i < 20; i++) {
        await page.waitForTimeout(500);
        const text = await page.locator("body").innerText({ timeout: 2000 });
        stable = text === previous ? stable + 1 : 0;
        previous = text;
        if (
          summarizePage("", page.url(), text).error ||
          (i >= 5 && stable >= 4)
        )
          break;
      }
      if (blockedMain) throw blockedMain;
      const result = summarizePage(
        await page.title(),
        page.url(),
        await page.locator("body").innerText({ timeout: 2000 }),
      );
      if (!result.error && mainResponse?.status >= 400)
        throw Error(`Website returned HTTP ${mainResponse.status}`);
      return result;
    } finally {
      signal.removeEventListener("abort", abort);
    }
  } catch (error) {
    return {
      error: "browser_read_failed",
      description: `Browser reading failed: ${error.message.split("\n")[0].slice(0, 250)}. Check URL, connectivity and sandboxed Chromium installation (TG_CHROMIUM_PATH).`,
    };
  } finally {
    await browser?.close().catch(() => {});
  }
}
