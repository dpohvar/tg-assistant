import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { EventEmitter } from 'node:events';
export class RpcProcess extends EventEmitter {
  serial = 0; pending = new Map(); waiters = new Set(); failure = null;
  constructor({ executable, args, cwd, env, handleRequest = async () => { throw new Error('Unattended permissions are not granted.'); } }) {
    super(); this.handleRequest = handleRequest;
    this.child = spawn(executable, args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.exited = new Promise(resolve => this.child.once('close', resolve));
    let stderr=''; // Memory only, bounded; diagnostics classify it without logging text.
    this.child.stderr.on('data', chunk => { stderr=(stderr+chunk.toString()).slice(-16384); });
    this.child.stdin.on('error', cause => this.fail(Object.assign(new Error('Codex connection failed.'),{code:'codex_connection_failed',cause})));
    this.child.on('error', cause => this.fail(Object.assign(new Error('Codex process could not start.'),{code:'codex_process_start_failed',cause})));
    this.child.on('exit', (exitCode,signal) => this.fail(Object.assign(new Error('Codex process exited.'),{code:'codex_process_exited',diagnostic:{exitCode,signal,stderr}})));
    readline.createInterface({ input: this.child.stdout }).on('line', line => { let m; try { m = JSON.parse(line); } catch { return this.fail(Object.assign(new Error('Invalid Codex JSON-RPC output.'),{code:'codex_protocol_error'})); } this.accept(m); });
  }
  write(m) { if (this.failure) throw this.failure; this.child.stdin.write(JSON.stringify(m) + '\n'); }
  request(method, params = {}, timeout = 30000) {
    if (this.failure) return Promise.reject(this.failure);
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Object.assign(new Error(`Codex RPC timed out: ${method}`),{code:'codex_rpc_timeout',diagnostic:{rpcMethod:method}})); }, timeout);
      this.pending.set(id, { method, resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
      try { this.write({ id, method, params }); } catch (e) { this.pending.get(id)?.reject(e); this.pending.delete(id); }
    });
  }
  notify(method, params = {}) { this.write({ method, params }); }
  async accept(m) {
    if (m.method && m.id !== undefined) {
      let response;
      try { response = { id: m.id, result: await this.handleRequest(m) }; }
      catch { response = { id: m.id, error: { code: -32000, message: 'Controller rejected this request.' } }; }
      try { this.write(response); } catch {}
    } else if (m.id !== undefined) {
      const p = this.pending.get(m.id); if (!p) return;
      this.pending.delete(m.id); m.error ? p.reject(Object.assign(new Error(`Codex RPC rejected request (${m.error.code ?? 'unknown'}).`),{code:'codex_rpc_rejected',diagnostic:{rpcMethod:p.method,rpcCode:m.error.code},cause:m.error})) : p.resolve(m.result);
    } else {
      try { this.emit('notification', m); } catch { return this.fail(new Error('Controller could not process a Codex notification.')); }
      for (const w of [...this.waiters]) if (w.predicate(m)) { this.waiters.delete(w); w.resolve(m); }
    }
  }
  waitFor(predicate, timeout = 600000) {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiters.delete(w); reject(Object.assign(new Error('Codex event timed out.'),{code:'codex_event_timeout'})); }, timeout);
      const w = { predicate, resolve: m => { clearTimeout(timer); resolve(m); }, reject: e => { clearTimeout(timer); reject(e); } }; this.waiters.add(w);
    });
  }
  fail(error) { if (this.failure) return; this.failure = error; for (const p of this.pending.values()) p.reject(error); for (const w of this.waiters) w.reject(error); this.pending.clear(); this.waiters.clear(); this.emit('closed'); }
  close(graceMs = 1000) {
    if (this.closing) return this.closing;
    this.fail(new Error('Codex connection closed.')); this.child.stdin.end(); this.child.kill();
    const wait = async () => { let timer; try { return await Promise.race([this.exited.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), graceMs); })]); } finally { clearTimeout(timer); } };
    this.closing = (async () => { if (await wait()) return; this.child.kill('SIGKILL'); if (!await wait()) throw new Error('Codex process could not be stopped.'); })();
    // Some callers close from an event callback; awaiting callers still receive failures.
    this.closing.catch(() => {}); return this.closing;
  }
}
