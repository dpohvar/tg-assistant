import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { widgetError } from "./contract.mjs";
import { createBuildCache, hashBytes } from "./build-cache.mjs";
export function buildWidget({ host, persist, read }) {
  const caches=new Map();
  return async (owner, handler) => {
    const ownerKey=JSON.stringify([owner.botId,owner.agentId]);
    if(read && !caches.has(ownerKey))caches.set(ownerKey,createBuildCache({read:path=>read(owner,path)}));
    const cache=caches.get(ownerKey);
    const produce = () => host.request(owner, "build", { handler });
    const result = cache ? await cache.build(JSON.stringify([owner.botId,owner.agentId,handler]),async () => {
      const built=await produce();
      const snapshotId=createHash("sha256").update(built.code).digest("hex");
      return {...built,snapshotId};
    }) : await produce();
    if (
      typeof result?.code !== "string" ||
      Buffer.byteLength(result.code) > 1024 * 1024 ||
      !Array.isArray(result.manifest) ||
      result.manifest.some(
        (entry) => {
          const p=typeof entry==="string"?entry:entry?.path;
          return typeof p !== "string" || path.isAbsolute(p) || p.split(/[\\/]/).includes("..") ||
            (typeof entry==="object" && (!/^[a-f0-9]{64}$/.test(entry.contentHash) ||
              typeof entry.mtimeNs!=="string" || !Number.isSafeInteger(entry.size)));
        },
      )
    )
      throw widgetError("sandbox_unavailable", "Invalid build snapshot.");
    const snapshotId = createHash("sha256").update(result.code).digest("hex");
    await persist(snapshotId, result.code, owner);
    return { snapshotId, manifest: result.manifest };
  };
}
let activeCompiles=0;
// This runs ONLY inside the owner sandbox. Release esbuild's child process when
// all concurrent compilations finish; runtime-only widgets do not need it.
export async function compileWidget(handler, options) {
  activeCompiles++;let compiler;
  try{compiler=await import('esbuild');return await compile(handler,options,compiler.build);}
  finally{if(--activeCompiles===0)compiler?.stop();}
}
async function compile(handler, { cwd, agentId, assets }, build) {
  const file = path.resolve(cwd, handler),
    rel = path.relative(cwd, file);
  if (
    !rel ||
    rel.startsWith("..") ||
    path.isAbsolute(rel) ||
    rel.split(path.sep).some((p) => p.startsWith(".") && p !== ".temp") ||
    (rel.startsWith(".temp" + path.sep) &&
      !rel.startsWith(path.join(".temp", agentId) + path.sep))
  )
    throw widgetError("invalid_argument", "Handler outside owner files.");
  try {
    if (!fs.statSync(file).isFile()) throw new Error("not a file");
    if (fs.lstatSync(file).isSymbolicLink() ||
        !fs.realpathSync.native(file).startsWith(fs.realpathSync.native(cwd) + path.sep))
      throw new Error("outside or symlink");
  } catch {
    throw widgetError(
      "invalid_argument",
      "Handler file was not found or is unreadable. First write the module in the bot workspace, then call create_widget or update_widget with its file path.",
    );
  }
  function resolvedFile(p) {
    for (const candidate of [
      p,
      ...[".ts", ".tsx", ".mjs", ".js", ".cjs", ".json"].map((ext) => p + ext),
      ...["index.ts", "index.tsx", "index.mjs", "index.js", "index.cjs"].map(
        (f) => path.join(p, f),
      ),
    ]) {
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {}
    }
    throw widgetError(
      "invalid_argument",
      "Unresolved dependency: " + path.basename(p),
    );
  }
  function exportTarget(value) {
    if (typeof value === "string") return value;
    if (value && typeof value === "object")
      for (const k of ["node", "import", "default"])
        if (value[k]) {
          const target = exportTarget(value[k]);
          if (target) return target;
        }
    return null;
  }
  const packageInputs=new Set();
  const result = await build({
    entryPoints: [file],
    absWorkingDir: cwd,
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    preserveSymlinks: true,
    banner: {
      js: "import {createRequire as __widgetRequire} from 'node:module';const require=__widgetRequire(import.meta.url);",
    },
    jsx: "automatic",
    jsxImportSource: "react",
    supported: { "top-level-await": false },
    metafile: true,
    write: false,
    tsconfigRaw: { compilerOptions: {} },
    logLevel: "silent",
    plugins: [
      {
        name: "trusted-path-policy",
        setup(b) {
          b.onResolve({ filter: /.*/ }, (args) => {
            if (["@tg-assistant/widget", "react", "react/jsx-runtime", "react/jsx-dev-runtime"].includes(args.path))
              return { path: args.path, external: true };
            if (
              args.path === "node:worker_threads" ||
              args.path === "worker_threads"
            )
              throw widgetError(
                "invalid_argument",
                "Worker threads are forbidden.",
              );
            if (args.path.startsWith("node:") || builtin(args.path))
              return { path: args.path, external: true };
            let resolved;
            if (path.isAbsolute(args.path) || args.path.startsWith("."))
              resolved = resolvedFile(
                path.resolve(
                  args.importer ? path.dirname(args.importer) : cwd,
                  args.path,
                ),
              );
            else {
              const parts = args.path.split("/"),
                name = parts[0].startsWith("@")
                  ? parts.splice(0, 2).join("/")
                  : parts.shift(),
                dir = path.join(cwd, "node_modules", name),
                pkgPath=path.join(dir,"package.json"),
                pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")),
                sub = parts.length ? "./" + parts.join("/") : ".";
              const target =
                exportTarget(
                  pkg.exports?.[sub] ?? (sub === "." ? pkg.exports : undefined),
                ) ??
                (parts.length
                  ? parts.join("/")
                  : (pkg.module ?? pkg.main ?? "index.js"));
              packageInputs.add(pkgPath);
              resolved = resolvedFile(path.resolve(dir, target));
            }
            const resolvedParts=path.relative(cwd,resolved).split(path.sep);
            const modulesAt=resolvedParts.indexOf("node_modules");
            if(modulesAt>=0 && ["react","react-reconciler","scheduler","immer","@tg-assistant"]
              .includes(resolvedParts[modulesAt+1]))
              throw widgetError("invalid_argument","Import trusted React and widget SDK packages by package name.");
            return { path: resolved, namespace: "widget-source" };
          });
          b.onLoad({ filter: /.*/, namespace: "widget-source" }, (args) => {
            const real = fs.realpathSync.native(args.path),
              r = path.relative(cwd, real),
              sdk = false;
            if (
              !sdk &&
              (r.startsWith("..") ||
                path.isAbsolute(r) ||
                r
                  .split(path.sep)
                  .some((p) => p.startsWith(".") && p !== ".temp") ||
                (r.startsWith(".temp" + path.sep) &&
                  !r.startsWith(path.join(".temp", agentId) + path.sep)))
            )
              throw widgetError(
                "invalid_argument",
                "Dependency outside owner sandbox.",
              );
            if (fs.lstatSync(args.path).isSymbolicLink())
              throw widgetError(
                "invalid_argument",
                "Symlink dependencies are not supported.",
              );
            const contents = fs.readFileSync(real, "utf8");
            if (
              /(?:from\s*|import\s*\(|require\s*\()\s*['"](?:node:)?worker_threads['"]/.test(
                contents,
              )
            )
              throw widgetError(
                "invalid_argument",
                "Worker threads are forbidden.",
              );
            const extension = path.extname(real);
            if (
              ![".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"].includes(
                extension,
              )
            )
              throw widgetError(
                "invalid_argument",
                "Unsupported dependency asset; read data explicitly inside the sandbox.",
              );
            return {
              contents,
              loader:
                extension === ".tsx"
                  ? "tsx"
                  : extension === ".ts"
                    ? "ts"
                    : extension === ".json"
                      ? "json"
                      : "jsx",
              resolveDir: path.dirname(real),
            };
          });
        },
      },
    ],
  });
  const sourcePaths=Object.keys(result.metafile.inputs).map(p=>p.startsWith("widget-source:")
    ? p.slice("widget-source:".length):p);
  const manifest=[...new Set([...sourcePaths,...packageInputs])].map(full=>{
    const relative=path.relative(cwd,full);
    if(!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw widgetError("invalid_argument","Build input outside owner files.");
    const stat=fs.statSync(full,{bigint:true}),bytes=fs.readFileSync(full);
    return {path:relative.replaceAll("\\","/"),mtimeNs:String(stat.mtimeNs),size:Number(stat.size),contentHash:hashBytes(bytes)};
  });
  // Static code/JSON are bundled. Non-JS assets, native addons and unresolved dynamic imports are explicit diagnostics.
  if (
    result.metafile.outputs &&
    Object.values(result.metafile.outputs).some((o) =>
      o.imports.some(
        (i) => i.external && !i.path.startsWith("node:") && !builtin(i.path) &&
          !["@tg-assistant/widget","react","react/jsx-runtime","react/jsx-dev-runtime"].includes(i.path),
      ),
    )
  )
    throw widgetError(
      "invalid_argument",
      "Unresolved dynamic dependency; use static imports or explicit sandbox file data.",
    );
  return { code: result.outputFiles[0].text, manifest };
}
function builtin(name) {
  return [
    "fs",
    "path",
    "crypto",
    "os",
    "url",
    "util",
    "stream",
    "events",
    "buffer",
    "http",
    "https",
    "net",
    "tls",
    "dns",
    "zlib",
    "child_process",
    "assert",
    "module",
    "timers",
    "querystring",
    "string_decoder",
    "tty",
    "punycode",
    "process",
    "v8",
  ].some((n) => name === n || name.startsWith(n + "/"));
}
