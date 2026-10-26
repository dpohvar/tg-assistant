import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as registry from "../../src/widgets/module-registry.mjs";
import * as cacheModule from "../../src/widgets/build-cache.mjs";
import { compileWidget } from "../../src/widgets/build.mjs";

test("one module evaluation supplies store definition to multiple widget instances", async () => {
  assert.equal(typeof registry.loadWidgetModule, "function");
  let evaluations = 0;
  const factory = () => {
    evaluations++;
    registry.defineStore({ version: 2, initialState: { count: 0 } });
    return { Main() {} };
  };
  const [a,b] = await Promise.all([
    registry.loadWidgetModule("counter",factory),
    registry.loadWidgetModule("counter",factory),
  ]);
  assert.equal(evaluations, 1);
  assert.equal(a,b);
  assert.deepEqual(a.storeDefinition,{version:2,initialState:{count:0}});
});

test("compiled widget keeps React and SDK imports external and tracks source content", async () => {
  const cwd = new URL("../..", import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, s=>s.slice(1));
  const result = await compileWidget("test/fixtures/react-widgets/counter.tsx", { cwd, agentId:"a", assets:cwd });
  assert.match(result.code,/react\/jsx-runtime/);
  assert.match(result.code,/@tg-assistant\/widget/);
  assert.equal(result.manifest.length,1);
  assert.equal(result.manifest[0].path,"test/fixtures/react-widgets/counter.tsx");
  assert.match(result.manifest[0].contentHash,/^[a-f0-9]{64}$/);
});

test("top-level await is rejected before a widget build is accepted", async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"react-build-await-"));
  try {
    fs.writeFileSync(path.join(dir,"main.mjs"),"await Promise.resolve(); export function Main() {};");
    await assert.rejects(compileWidget("main.mjs",{cwd:dir,agentId:"a",assets:dir}),/Top-level await|top-level await/i);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test("cache reuses identical content after mtime changes and invalidates nested dependencies", async () => {
  assert.equal(typeof cacheModule.createBuildCache,"function");
  const files = new Map([["main.tsx","main"],["lib/nested.ts","one"],["package.json","old"]]);
  const read = path => { if (!files.has(path)) throw Error("missing"); return Buffer.from(files.get(path)); };
  const cache = cacheModule.createBuildCache({ read });
  let builds = 0;
  const build = async () => {
    builds++;
    return { snapshotId:`snapshot-${builds}`, manifest:["main.tsx","lib/nested.ts","package.json"].map(path =>
      ({path,contentHash:cacheModule.hashBytes(read(path))})) };
  };
  assert.equal((await cache.build("w",build)).snapshotId,"snapshot-1");
  assert.equal((await cache.build("w",build)).snapshotId,"snapshot-1");
  files.set("lib/nested.ts","two");
  assert.equal((await cache.build("w",build)).snapshotId,"snapshot-2");
  files.delete("package.json");
  await assert.rejects(cache.build("w",build),/missing/);
});

test("duplicate and late defineStore calls fail; missing definition defaults to v0", async () => {
  await assert.rejects(registry.loadWidgetModule("duplicate", () => {
    registry.defineStore({ version: 1, initialState: {} });
    registry.defineStore({ version: 2, initialState: {} });
    return {};
  }), /defineStore/);
  const module = await registry.loadWidgetModule("empty", () => ({ Main() {} }));
  assert.deepEqual(module.storeDefinition,{version:0,initialState:{}});
  assert.throws(() => registry.defineStore({version:1,initialState:{}}), /defineStore/);
});

test("failed builds do not cache metadata and parallel builds isolate definitions", async () => {
  await assert.rejects(registry.loadWidgetModule("retry", () => { throw Error("bad import"); }), /bad import/);
  const [a,b,c] = await Promise.all([
    registry.loadWidgetModule("retry", () => {registry.defineStore({version:3,initialState:{a:1}});return {}; }),
    registry.loadWidgetModule("other", () => {registry.defineStore({version:4,initialState:{b:1}});return {}; }),
    registry.loadWidgetModule("no-store", () => ({})),
  ]);
  assert.equal(a.storeDefinition.version,3);
  assert.equal(b.storeDefinition.version,4);
  assert.equal(c.storeDefinition.version,0);
});
