import './testEnv.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UserService, UserError } from './userService.js';

class InMemoryUser {
  constructor() {
    this.rows = [];
  }
  generateId(prefix = '') {
    return `${prefix}usr_${this.rows.length + 1}`;
  }
  async findById(id) {
    return this.rows.find((u) => u.id === id) ?? null;
  }
  async create({ id, email, color = '#d8cdbe' }) {
    this.rows.push({ id, email, color, created_at: Math.floor(Date.now() / 1000) });
    return { affectedRows: 1 };
  }
  async updateColor(id, color) {
    const user = this.rows.find((u) => u.id === id);
    if (user) user.color = color;
    return { affectedRows: user ? 1 : 0 };
  }
}

function buildUser(deps = {}) {
  const users = deps.users ?? new InMemoryUser();
  return { service: new UserService({ users }), users };
}

test('getOptions returns the stored color for a user', async () => {
  const { service, users } = buildUser();
  await users.create({ id: 'usr_1', email: 'a@example.com', color: '#123abc' });
  assert.deepEqual(await service.getOptions('usr_1'), { color: '#123abc' });
});

test('getOptions returns null for an unknown user', async () => {
  const { service } = buildUser();
  assert.equal(await service.getOptions('missing'), null);
});

test('updateOptions stores a valid hex color', async () => {
  const { service, users } = buildUser();
  await users.create({ id: 'usr_1', email: 'a@example.com' });
  const result = await service.updateOptions('usr_1', { color: '#00ff80' });
  assert.deepEqual(result, { color: '#00ff80' });
  assert.equal((await users.findById('usr_1')).color, '#00ff80');
});

test('updateOptions rejects an invalid color and does not change it', async () => {
  const { service, users } = buildUser();
  await users.create({ id: 'usr_1', email: 'a@example.com', color: '#111111' });
  await assert.rejects(
    () => service.updateOptions('usr_1', { color: 'purple' }),
    (err) => err instanceof UserError && err.status === 400
  );
  assert.equal((await users.findById('usr_1')).color, '#111111');
});

test('updateOptions ignores a missing color and returns current options', async () => {
  const { service, users } = buildUser();
  await users.create({ id: 'usr_1', email: 'a@example.com', color: '#222222' });
  assert.deepEqual(await service.updateOptions('usr_1', {}), { color: '#222222' });
});
