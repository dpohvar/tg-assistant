import dns from "node:dns/promises";
import net from "node:net";
import http from "node:http";
import https from "node:https";

export function abortable(promise, signal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

export function publicAddress(address) {
  if (net.isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && [0, 168].includes(b)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && [18, 19, 51].includes(b)) ||
      (a === 203 && b === 0)
    );
  }
  // Only globally routed IPv6 unicast; reject mapped IPv4, local and transition ranges.
  if (net.isIP(address) !== 6) return false;
  const canonical = new URL(`http://[${address}]`).hostname.slice(1, -1);
  const [first, second] = canonical
    .split(":")
    .map((s) => parseInt(s || "0", 16));
  return (
    /^[23][0-9a-f]{3}:/i.test(canonical) &&
    first !== 0x2002 &&
    first !== 0x3fff &&
    !(first === 0x2001 && (second <= 0x1ff || second === 0xdb8))
  );
}

export async function assertPublicUrl(
  input,
  lookup = (hostname) => dns.lookup(hostname, { all: true }),
  signal,
) {
  const url = new URL(input);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["80", "443"].includes(url.port))
  )
    throw Error(
      "Only public HTTP(S) URLs without credentials on ports 80/443 are supported.",
    );
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const records = net.isIP(hostname)
    ? [{ address: hostname, family: net.isIP(hostname) }]
    : await abortable(lookup(hostname), signal);
  if (!records.length || records.some((r) => !publicAddress(r.address)))
    throw Error("Local, private and reserved network addresses are forbidden.");
  return { url, ...records[0] };
}

export async function fetchPublic(
  input,
  { signal, maxBytes = 20 * 1024 * 1024, onBytes } = {},
) {
  const { url, address, family } = await assertPublicUrl(
    input,
    undefined,
    signal,
  );
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).get(
      url,
      {
        signal,
        agent: false,
        headers: {
          "accept-encoding": "identity",
          "user-agent": "Mozilla/5.0 TelegramAssistantReader",
        },
        // Pin validated DNS for the actual socket; do not follow redirects here.
        lookup: (_host, options, callback) =>
          callback(null, options.all ? [{ address, family }] : address, family),
      },
      (response) => {
        if (
          response.headers["content-encoding"] &&
          response.headers["content-encoding"] !== "identity"
        ) {
          response.destroy(
            Error(
              "Compressed response unsupported despite identity encoding request.",
            ),
          );
          response.on("error", reject);
          return;
        }
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          try {
            onBytes?.(chunk.length);
          } catch (error) {
            response.destroy(error);
            return;
          }
          size += chunk.length;
          if (size > maxBytes)
            response.destroy(Error("Response exceeds download limit."));
          else chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks),
            charged: Boolean(onBytes),
          }),
        );
      },
    );
    request.on("error", reject);
  });
}
