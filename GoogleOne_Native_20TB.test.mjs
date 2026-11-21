import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test, after } from 'node:test';

const source = await readFile(new URL('./GoogleOne_Native_20TB_Egern.js', import.meta.url), 'utf8');
const { default: run, patchProtobuf, patchPayload, isTarget } = await import(
  'data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const OLD = Buffer.from('g1.ios.20tb.m.v2');
const NEW = Buffer.from('com.google.one.20tb.m.iog');
const oldLeaf = Buffer.concat([Buffer.from([0x0a, 0x10]), OLD]);
const newLeaf = Buffer.concat([Buffer.from([0x0a, 0x19]), NEW]);
const url = 'https://subscriptionsmobile-pa.googleapis.com/$rpc/example.Service/GetDynamicStorefrontInfo';
const passed = [];
function check(name, fn) {
  test(name, async () => { await fn(); passed.push(name); });
}
function context(body = oldLeaf, { mode, type = 'application/x-protobuf', status = 200, extraHeaders = {}, env = {} } = {}) {
  const state = new Map();
  const notes = [];
  let consumed = 0;
  const response = new Response(body, { status, headers: { 'content-type': type, ...extraHeaders } });
  const ctx = {
    request: { method: 'POST', url, headers: new Headers() },
    response: { status: response.status, headers: response.headers, async arrayBuffer() { consumed++; return response.arrayBuffer(); } },
    env: { ...(mode ? { MODE: mode } : {}), ...env },
    storage: { getJSON: key => state.get(key), setJSON: (key, value) => state.set(key, value) },
    notify: value => notes.push(value),
  };
  return { ctx, notes, state, consumed: () => consumed, last: () => [...state.values()].at(-1) };
}
function grpc(payload, flag = 0) {
  const prefix = Buffer.alloc(5);
  prefix[0] = flag;
  prefix.writeUInt32BE(payload.length, 1);
  return Buffer.concat([prefix, payload]);
}

check('golden wire bytes: 16-byte SKU becomes 25 bytes', () => {
  assert.equal(OLD.length, 16); assert.equal(NEW.length, 25);
  const out = patchProtobuf(oldLeaf);
  assert.deepEqual(Buffer.from(out.bytes), newLeaf);
  assert.deepEqual(out.hits, ['1']);
});
check('nested lengths grow across the 127-byte varint boundary', () => {
  const tail = Buffer.concat([Buffer.from([0x12, 0x6a]), Buffer.alloc(106, 0x61)]);
  const input = Buffer.concat([Buffer.from([0x0a, 0x7e]), oldLeaf, tail]);
  const expected = Buffer.concat([Buffer.from([0x0a, 0x87, 0x01]), newLeaf, tail]);
  const result = patchProtobuf(input);
  assert.deepEqual(Buffer.from(result.bytes), expected);
  assert.deepEqual(result.hits, ['1.1']);
});
check('ancestor lengths grow across the 16383-byte varint boundary', () => {
  const tail = Buffer.concat([Buffer.from([0x12, 0xea, 0x7f]), Buffer.alloc(16362, 0x61)]);
  const input = Buffer.concat([Buffer.from([0x0a, 0xff, 0x7f]), oldLeaf, tail]);
  const expected = Buffer.concat([Buffer.from([0x0a, 0x88, 0x80, 0x01]), newLeaf, tail]);
  assert.deepEqual(Buffer.from(patchProtobuf(input).bytes), expected);
});
check('full-value matching preserves an SKU embedded in longer text', () => {
  const value = Buffer.from('prefix.' + OLD + '.suffix');
  const input = Buffer.concat([Buffer.from([0x0a, value.length]), value]);
  const out = patchProtobuf(input);
  assert.strictEqual(out.bytes, input); assert.equal(out.hits.length, 0);
});
check('unrelated title and price bytes are unchanged', () => {
  const other = Buffer.from([0x12, 0x05, 0x32, 0x30, 0x20, 0x54, 0x42, 0x1a, 0x04, 0x54, 0x52, 0x59, 0x21]);
  assert.deepEqual(Buffer.from(patchProtobuf(Buffer.concat([oldLeaf, other])).bytes), Buffer.concat([newLeaf, other]));
});
check('uint64, fixed32, fixed64 and noncanonical varints remain byte identical', () => {
  const scalars = Buffer.from([0x10, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01,
    0x1d, 1, 2, 3, 4, 0x21, 1, 2, 3, 4, 5, 6, 7, 8, 0x28, 0x81, 0x00]);
  assert.deepEqual(Buffer.from(patchProtobuf(Buffer.concat([scalars, oldLeaf])).bytes), Buffer.concat([scalars, newLeaf]));
});
check('field path allowlist selects only the requested nested occurrence', () => {
  const input = Buffer.concat([oldLeaf, Buffer.from([0x12, 0x12]), oldLeaf]);
  const expected = Buffer.concat([oldLeaf, Buffer.from([0x12, 0x1b]), newLeaf]);
  const out = patchProtobuf(input, new Set(['2.1']));
  assert.deepEqual(Buffer.from(out.bytes), expected); assert.deepEqual(out.hits, ['2.1']);
});
check('invalid/truncated root messages are rejected without partial results', () => {
  for (const tail of [[0], [0x12, 0x7f], [0x18, 0x80], [0x1d, 1], [0x21, 1], [0x0b], [0x0f], [0x12, 0xff, 0xff, 0xff, 0xff, 0x10]]) {
    assert.throws(() => patchProtobuf(Buffer.concat([oldLeaf, Buffer.from(tail)])));
  }
});
check('uncompressed gRPC lengths and unrelated frames are preserved correctly', () => {
  const other = grpc(Buffer.from([0x08, 0x01]));
  const out = patchPayload(Buffer.concat([grpc(oldLeaf), other]), 'application/grpc+proto');
  assert.deepEqual(Buffer.from(out.bytes), Buffer.concat([grpc(newLeaf), other]));
});
check('gRPC-web trailer bytes are preserved', () => {
  const trailer = grpc(Buffer.from('grpc-status: 0\r\n'), 128);
  const out = patchPayload(Buffer.concat([grpc(oldLeaf), trailer]), 'application/grpc-web+proto');
  assert.deepEqual(Buffer.from(out.bytes), Buffer.concat([grpc(newLeaf), trailer]));
});
check('compressed, truncated and base64 gRPC are rejected', () => {
  assert.throws(() => patchPayload(grpc(oldLeaf, 1), 'application/grpc'));
  assert.throws(() => patchPayload(grpc(oldLeaf).subarray(0, -1), 'application/grpc'));
  assert.throws(() => patchPayload(grpc(oldLeaf), 'application/grpc-web-text'));
});
check('target scope excludes other domains, methods and purchase verification', () => {
  assert.ok(isTarget({ method: 'POST', url }));
  for (const bad of [url.replace('https:', 'http:'), url.replace('.com/', '.com.evil/'),
    url.replace('/GetDynamicStorefrontInfo', '/VerifyPurchase'), url + '/extra', url.replace('.com/', '.com:444/')]) {
    assert.equal(isTarget({ method: 'POST', url: bad }), false);
  }
  assert.equal(isTarget({ method: 'GET', url }), false);
});
check('request phase asks for identity encoding and retains auth headers', async () => {
  const c = context(); delete c.ctx.response;
  c.ctx.request.headers.set('authorization', 'synthetic-token');
  const out = await run(c.ctx);
  assert.equal(out.headers.get('accept-encoding'), 'identity');
  assert.equal(out.headers.get('authorization'), 'synthetic-token');
});
check('default inspect reports a candidate and returns identical bytes', async () => {
  const c = context(); const out = await run(c.ctx);
  assert.deepEqual(Buffer.from(out.body), oldLeaf); assert.equal(c.consumed(), 1);
  assert.equal(c.last().status, 'candidate_found'); assert.equal(c.last().mode, 'inspect');
  assert.equal(c.notes.length, 1);
  assert.ok(!JSON.stringify(c.last()).includes('synthetic-token'));
});
check('rewrite returns valid bytes and clears stale length/digest metadata', async () => {
  const c = context(oldLeaf, { mode: 'rewrite', extraHeaders: { 'content-length': String(oldLeaf.length), etag: 'x', 'content-md5': 'x', digest: 'x', 'set-cookie': 'fixture=yes' } });
  const out = await run(c.ctx);
  assert.deepEqual(Buffer.from(out.body), newLeaf);
  for (const name of ['content-length', 'etag', 'content-md5', 'digest']) assert.equal(out.headers.has(name), false);
  assert.equal(out.headers.get('set-cookie'), 'fixture=yes'); assert.equal(c.last().status, 'rewritten');
});
check('gRPC MIME is accepted by the Egern entrypoint', async () => {
  const c = context(grpc(oldLeaf), { mode: 'rewrite', type: 'application/grpc+proto' });
  assert.deepEqual(Buffer.from((await run(c.ctx)).body), grpc(newLeaf));
});
check('malformed payload after a candidate passes through all original bytes', async () => {
  const input = Buffer.concat([oldLeaf, Buffer.from([0x12, 0x7f])]);
  const c = context(input, { mode: 'rewrite' });
  assert.deepEqual(Buffer.from((await run(c.ctx)).body), input);
  assert.equal(c.last().status, 'parse_failed_passthrough');
});
check('compression, errors, JSON and invalid options pass through before consuming', async () => {
  for (const options of [{ extraHeaders: { 'Content-Encoding': 'gzip' } }, { status: 403 },
    { type: 'application/json' }, { mode: 'typo' }, { env: { FIELD_PATHS: '1..2' } }]) {
    const c = context(oldLeaf, options);
    assert.equal(await run(c.ctx), undefined); assert.equal(c.consumed(), 0);
  }
});
check('no-match response stays byte identical', async () => {
  const data = Buffer.from([0x08, 1]); const c = context(data, { mode: 'rewrite' });
  assert.deepEqual(Buffer.from((await run(c.ctx)).body), data); assert.equal(c.last().status, 'no_match');
});
check('field-count and nesting limits fail open in Egern', async () => {
  const huge = Buffer.alloc(100002); for (let i = 0; i < huge.length; i += 2) huge[i] = 8;
  const c = context(huge, { mode: 'rewrite' });
  assert.deepEqual(Buffer.from((await run(c.ctx)).body), huge); assert.equal(c.last().status, 'limit_passthrough');
  // All wrappers are <128 bytes, so the fixture lengths fit one byte.
  let deep = Buffer.from([8, 1]);
  for (let i = 0; i < 50; i++) deep = Buffer.concat([Buffer.from([10, deep.length]), deep]);
  const d = context(deep, { mode: 'rewrite' });
  assert.deepEqual(Buffer.from((await run(d.ctx)).body), deep); assert.equal(d.last().status, 'limit_passthrough');
});
check('body-size limit returns original bytes', async () => {
  const data = Buffer.alloc(2 * 1024 * 1024 + 1); const c = context(data, { mode: 'rewrite' });
  assert.deepEqual(Buffer.from((await run(c.ctx)).body), data); assert.equal(c.last().status, 'limit_passthrough');
});
check('disabled notifications do not affect processing', async () => {
  const c = context(oldLeaf, { env: { NOTIFY: 'false' } });
  await run(c.ctx); assert.equal(c.notes.length, 0); assert.equal(c.last().matches, 1);
});

after(async () => {
  await writeFile(new URL('./GoogleOne_Egern_validation.json', import.meta.url), JSON.stringify({
    result: passed.length === 22 ? 'PASS' : 'INCOMPLETE', checks: passed.length,
    scope: 'Node.js offline synthetic-wire and mocked Egern API checks only. No Egern/iOS runtime, live Google response, Apple product availability, price or entitlement verification.',
    checks_passed: passed,
  }, null, 2) + '\n');
});
