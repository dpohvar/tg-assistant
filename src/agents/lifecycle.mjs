import { randomUUID } from 'node:crypto';
export class Lifecycle {
  controllerId = randomUUID(); generations = new Map(); closed = false;
  scope(data) { return { ...data, controllerId: this.controllerId, generation: this.generations.get(data.agentId) ?? 0 }; }
  assertCurrent(scope) { if (this.closed || scope.controllerId !== this.controllerId || scope.generation !== (this.generations.get(scope.agentId) ?? 0)) throw Object.assign(new Error('Agent connection expired.'), { code: 'connection_expired' }); }
  invalidate(agentId) { this.generations.set(agentId, (this.generations.get(agentId) ?? 0) + 1); }
  close() { this.closed = true; }
}
