import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioProxyService } from './audioProxyService.js';

function streamResponse(chunks, headers = {}) {
  let receivedRange = null;
  const body = {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next() {
          if (i < chunks.length) {
            const value = Buffer.from(chunks[i++]);
            return Promise.resolve({ value, done: false });
          }
          return Promise.resolve({ value: undefined, done: true });
        }
      };
    }
  };
  const service = new AudioProxyService({
    fetchImpl: async (url, init) => {
      receivedRange = init.headers.get('Range');
      return {
        status: 206,
        statusText: 'Partial Content',
        headers: new Headers({ 'content-type': 'audio/mpeg', 'accept-ranges': 'bytes', 'content-range': 'bytes 0-99/1000' }),
        body
      };
    }
  });
  return { service, getRange: () => receivedRange };
}

test('proxy forwards the Range header and returns 206 with CORS + accept-ranges', async () => {
  const { service, getRange } = streamResponse(['hello', 'world']);
  const result = await service.fetch({ url: 'https://cdn.example.com/audio.mp3', method: 'GET', range: 'bytes=0-99' });
  assert.equal(getRange(), 'bytes=0-99');
  assert.equal(result.status, 206);
  assert.equal(result.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(result.headers.get('accept-ranges'), 'bytes');
  assert.equal(result.headers.get('content-range'), 'bytes 0-99/1000');
  const collected = [];
  for await (const chunk of result.body) collected.push(chunk.toString());
  assert.equal(collected.join(''), 'helloworld');
});

test('proxy injects accept-ranges when upstream omits it', async () => {
  const service = new AudioProxyService({
    fetchImpl: async () => ({
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'audio/mpeg' }),
      body: null
    })
  });
  const result = await service.fetch({ url: 'https://cdn.example.com/a.mp3' });
  assert.equal(result.headers.get('accept-ranges'), 'bytes');
});

test('proxy rejects SSRF urls', async () => {
  const service = new AudioProxyService({ fetchImpl: async () => ({}) });
  await assert.rejects(() => service.fetch({ url: 'http://169.254.169.254/latest' }), /Invalid or disallowed/);
  await assert.rejects(() => service.fetch({ url: '' }), /Invalid or disallowed/);
});
