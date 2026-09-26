import '../services/testEnv.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ImageRoutes } from './ImageRoutes.js';

function buildServer(thumbnailDir) {
  const app = express();
  app.use('/images', new ImageRoutes({ config: { thumbnailStorageDir: thumbnailDir } }).getRouter());
  const server = app.listen(0);
  return server;
}

async function request(server, method, p) {
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}${p}`, { method });
  const buf = await res.arrayBuffer();
  return { status: res.status, contentType: res.headers.get('content-type'), bytes: new Uint8Array(buf) };
}

test('serves a thumbnail by hash + suffix', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbnails-'));
  const file = path.join(dir, 'deadbeef-full.jpg');
  fs.writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
  t.after(() => serverClose(dir));

  const server = buildServer(dir);
  t.after(() => server.close());

  const res = await request(server, 'GET', '/images/deadbeef-full.jpg');
  assert.equal(res.status, 200);
  assert.match(res.contentType, /image\/jpeg/);
  assert.deepEqual(res.bytes, Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]));
});

test('returns 404 for a missing thumbnail', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbnails-'));
  t.after(() => serverClose(dir));

  const server = buildServer(dir);
  t.after(() => server.close());

  const res = await request(server, 'GET', '/images/deadbeef-large.jpg');
  assert.equal(res.status, 404);
});

test('rejects path traversal and invalid names with 400', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbnails-'));
  t.after(() => serverClose(dir));

  const server = buildServer(dir);
  t.after(() => server.close());

  const traversal = await request(server, 'GET', '/images/..%2f..%2fetc%2fpasswd');
  assert.ok(traversal.status === 400 || traversal.status === 403, `expected 400/403, got ${traversal.status}`);

  const invalid = await request(server, 'GET', '/images/notanimage.png');
  assert.equal(invalid.status, 400);
});

function serverClose(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}
