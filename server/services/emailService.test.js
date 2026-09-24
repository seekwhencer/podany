import './testEnv.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EmailService } from './emailService.js';

test('local mode returns without calling fetch when no API key is set', async () => {
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return {};
  };
  try {
    const service = new EmailService({ resendApiKey: null, fromEmail: 'me@example.com' });
    assert.equal(service.enabled, false);
    const result = await service.send({ to: 'a@b.com', subject: 'x', html: '<p>y</p>' });
    assert.deepEqual(result, { sentVia: 'local', id: null });
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('resend mode posts the correct payload and extracts the id', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.resend.com/emails');
    const body = JSON.parse(init.body);
    assert.equal(body.from, 'team@podany.test');
    assert.deepEqual(body.to, ['a@b.com', 'c@d.com']);
    assert.equal(body.subject, 'Podany Login');
    assert.equal(init.headers.Authorization, 'Bearer sk-test');
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'msg_123' }) };
  };
  try {
    const service = new EmailService({ resendApiKey: 'sk-test', fromEmail: 'team@podany.test' });
    const result = await service.send({ to: ['a@b.com', 'c@d.com'], subject: 'Podany Login', html: '' });
    assert.equal(result.sentVia, 'resend');
    assert.equal(result.id, 'msg_123');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sandbox restriction is reported instead of throwing', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 403,
    text: async () => JSON.stringify({ statusCode: 403, message: 'You can only send testing emails' })
  });
  try {
    const service = new EmailService({ resendApiKey: 'sk-test', fromEmail: 'onboarding@resend.dev' });
    const result = await service.send({ to: 'a@b.com', subject: 'x', html: '' });
    assert.equal(result.sentVia, 'sandbox');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('delivery errors are thrown when not a sandbox restriction', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => 'boom' });
  try {
    const service = new EmailService({ resendApiKey: 'sk-test', fromEmail: 'team@podany.test' });
    await assert.rejects(() => service.send({ to: 'a@b.com', subject: 'x', html: '' }), /boom/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
