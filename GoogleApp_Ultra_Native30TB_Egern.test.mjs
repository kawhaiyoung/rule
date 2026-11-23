import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const source = await readFile(new URL('./GoogleApp_Ultra_Native30TB_Egern.js', import.meta.url), 'utf8');
const { default: run, patchProtobuf, patchPayload, parsePaths, isTarget } = await import('data:text/javascript;base64,' +
  Buffer.from(source + '\nexport { patchProtobuf, patchPayload, parsePaths, isTarget };').toString('base64'));
const logs = [];
const originalLog = console.log;
console.log = (...args) => logs.push(args.join(' '));
after(() => { console.log = originalLog; });
const SOURCE = 'g1.ios.30tb.ai.pro.m';
const TARGET = 'g1.ios.30tb.m';
const PATH = '1.11.1.11.1.18.1.2.20.1.11.1.11.1.11.1.13.1.11.1.12.1.3.4.9.4.1.2.2.1';
const OTHER = PATH.slice(0, -1) + '2';
const URL_NATIVE = 'https://subscriptionsmobile-pa.googleapis.com/$rpc/google.internal.subscriptions.mobile.v1.SubscriptionsApiMobileService/GetDynamicStorefrontInfo?';
const ascii = value => Uint8Array.from(value, c => c.charCodeAt(0));
const concat = (...parts) => Uint8Array.from(parts.flatMap(part => [...part]));
function varint(n) { const out = []; do { const next = n % 128; n = Math.floor(n / 128); out.push(next | (n ? 128 : 0)); } while (n); return Uint8Array.from(out); }
function field(n, bytes) { if (typeof bytes === 'string') bytes = ascii(bytes); return concat(varint(n * 8 + 2), varint(bytes.length), bytes); }
function at(path, value) { let bytes = typeof value === 'string' ? ascii(value) : value; for (const n of path.split('.').map(Number).reverse()) bytes = field(n, bytes); return bytes; }
function grpc(bytes, flag = 0) { const header = new Uint8Array(5); header[0] = flag; new DataView(header.buffer).setUint32(1, bytes.length, false); return concat(header, bytes); }
function context(bytes, { mode = 'rewrite', paths, type = 'application/x-protobuf', headers = {}, status = 200, url = URL_NATIVE } = {}) {
  let consumed = false;
  const database = new Map();
  const notifications = [];
  return {
    request: { url, method: 'POST', headers: new Headers({ authorization: 'SECRET_AUTH', cookie: 'SECRET_COOKIE' }) },
    response: { status, headers: new Headers({ 'content-type': type, ...headers }),
      async arrayBuffer() { assert.equal(consumed, false); consumed = true; return bytes.slice().buffer; } },
    env: { MODE: mode, ...(paths === undefined ? {} : { FIELD_PATHS: paths }) },
    app: { version: 'OFFLINE_FIXTURE' }, database, notifications, consumed: () => consumed,
    storage: { getJSON: key => database.get(key), setJSON: (key, value) => database.set(key, value) },
    notify: item => notifications.push(item),
  };
}
const latest = ctx => [...ctx.database.values()][0];

test('exact source at the observed deep path is replaced; other paths, 20TB, prices and business flags remain unchanged', () => {
  const suffix = concat(at(OTHER, SOURCE), field(2, 'g1.ios.20tb.m'), field(3, 'TRY 8999.99'), Uint8Array.of(32, 1));
  const original = concat(at(PATH, SOURCE), suffix);
  const saved = original.slice();
  const result = patchProtobuf(original, parsePaths(''));
  assert.deepEqual(result.bytes, concat(at(PATH, TARGET), suffix));
  assert.deepEqual(original, saved);
  assert.deepEqual(result.hits, [PATH]);
  assert.equal(result.diagnostics.source_fields, 2);
});

test('all complete occurrences at the selected repeated path are changed', () => {
  const result = patchProtobuf(concat(at(PATH, SOURCE), at(PATH, SOURCE)), parsePaths());
  assert.deepEqual(result.bytes, concat(at(PATH, TARGET), at(PATH, TARGET)));
  assert.equal(result.hits.length, 2);
});

test('source substrings, suffixed variants and unrelated complete identifiers are untouched', () => {
  for (const value of [SOURCE + '.v2', 'prefix:' + SOURCE, 'g1.ios.20tb.m.v2', 'g1.ios.100gb.m']) {
    const original = at(PATH, value);
    const result = patchProtobuf(original, parsePaths());
    assert.deepEqual(result.bytes, original);
    assert.equal(result.hits.length, 0);
  }
});

test('shrinking payloads correctly cross 128 and 16384 length-prefix boundaries', () => {
  for (const boundary of [128, 16384]) {
    let padding;
    for (let n = boundary - 40; n < boundary; n++) {
      const candidate = field(2, new Uint8Array(n).fill(97));
      if (field(1, SOURCE).length + candidate.length === boundary) { padding = candidate; break; }
    }
    assert.ok(padding);
    const body = field(5, concat(field(1, SOURCE), padding));
    const expected = field(5, concat(field(1, TARGET), padding));
    const result = patchProtobuf(body, new Set(['5.1']));
    assert.deepEqual(result.bytes, expected);
    assert.equal(result.bytes.length, body.length - 8, '7 SKU bytes and one ancestor varint byte shrink');
  }
});

test('several ancestor prefixes are re-encoded around the observed thirty-level path', () => {
  const body = at(PATH, SOURCE);
  assert.deepEqual(patchProtobuf(body, parsePaths()).bytes, at(PATH, TARGET));
  assert.equal(PATH.split('.').length, 30);
});

test('gRPC frame lengths are recomputed and gRPC-web trailers are preserved', () => {
  const trailer = grpc(ascii('grpc-status: 0'), 128);
  const body = concat(grpc(at(PATH, SOURCE)), trailer);
  const result = patchPayload(body, 'application/grpc-web+proto', parsePaths());
  assert.deepEqual(result.bytes, concat(grpc(at(PATH, TARGET)), trailer));
});

test('compressed, base64, malformed and unknown gRPC frames are rejected', () => {
  const body = grpc(at(PATH, SOURCE));
  assert.throws(() => patchPayload(body, 'application/grpc-web-text', parsePaths()));
  assert.throws(() => patchPayload(grpc(at(PATH, SOURCE), 1), 'application/grpc+proto', parsePaths()));
  assert.throws(() => patchPayload(Uint8Array.of(0, 0, 0, 5), 'application/grpc', parsePaths()));
});

test('only exact native storefront POST URLs are in scope', () => {
  assert.equal(isTarget({ url: URL_NATIVE, method: 'POST' }), true);
  for (const [url, method] of [[URL_NATIVE, 'GET'], [URL_NATIVE + 'x#fragment', 'POST'], [URL_NATIVE.replace('googleapis.com', 'googleapis.com.evil.test'), 'POST'], ['https://one.google.com/ai', 'POST'], ['https://subscriptionsmobile-pa.googleapis.com/ValidateReceipt', 'POST']]) assert.equal(isTarget({ url, method }), false);
});

test('field-path configuration defaults to the observed path and rejects unbounded or malformed input', () => {
  assert.deepEqual([...parsePaths()], [PATH]);
  assert.deepEqual([...parsePaths('')], [PATH]);
  assert.deepEqual([...parsePaths('1.2, 3.4')], ['1.2', '3.4']);
  for (const paths of ['*', '0.1', '1..2', '1.2,', Array(10).fill('1.2').join(',')]) assert.throws(() => parsePaths(paths));
});

test('rewrite mode returns new bytes, removes stale integrity headers and reports only actual changes', async () => {
  const ctx = context(at(PATH, SOURCE), { headers: { etag: 'old', 'content-length': '50', digest: 'old', 'set-cookie': 'KEEP_COOKIE' } });
  const result = await run(ctx);
  assert.deepEqual(result.body, at(PATH, TARGET));
  assert.equal(result.headers.has('content-length'), false);
  assert.equal(result.headers.has('etag'), false);
  assert.equal(result.headers.has('digest'), false);
  assert.equal(result.headers.get('set-cookie'), 'KEEP_COOKIE');
  assert.equal(latest(ctx).status, 'rewritten');
  assert.equal(latest(ctx).replacements, 1);
  assert.equal(latest(ctx).raw_source_after, 0);
});

test('inspect mode reports selected candidates but returns the exact original bytes', async () => {
  const original = at(PATH, SOURCE);
  const ctx = context(original, { mode: 'inspect' });
  assert.deepEqual((await run(ctx)).body, original);
  assert.equal(latest(ctx).status, 'candidate_found');
  assert.equal(latest(ctx).selected_matches, 1);
  assert.equal(latest(ctx).replacements, 0);
});

test('reports distinguish selected replacements from source fields left at other paths', async () => {
  const ctx = context(concat(at(PATH, SOURCE), at(OTHER, SOURCE)));
  await run(ctx);
  assert.equal(latest(ctx).diagnostics.source_fields, 2);
  assert.equal(latest(ctx).selected_matches, 1);
  assert.equal(latest(ctx).raw_source_after, 1);
  assert.equal(ctx.notifications[0].action.text.includes('处理后剩余源编号字节: 1'), true);
});

test('a changed numeric path reports path_not_matched and never widens its rewrite scope', async () => {
  const original = at(OTHER, SOURCE);
  const ctx = context(original);
  assert.deepEqual((await run(ctx)).body, original);
  assert.equal(latest(ctx).status, 'path_not_matched');
  assert.equal(latest(ctx).diagnostics.source_fields, 1);
  assert.equal(latest(ctx).replacements, 0);
});

test('malformed protobuf after a candidate restores the full consumed response', async () => {
  const original = concat(at(PATH, SOURCE), Uint8Array.of(0));
  const ctx = context(original);
  assert.deepEqual((await run(ctx)).body, original);
  assert.equal(latest(ctx).status, 'parse_failed_passthrough');
});

test('unsupported response states and invalid configuration do not consume the body', async () => {
  for (const [options, expected] of [[{ mode: 'invalid' }, 'invalid_mode'], [{ paths: '*' }, 'invalid_field_paths'], [{ status: 403 }, 'http_not_2xx'], [{ headers: { 'content-encoding': 'gzip' } }, 'encoded_response_passthrough'], [{ type: 'application/json' }, 'unsupported_content_type']]) {
    const ctx = context(at(PATH, SOURCE), options);
    assert.equal(await run(ctx), undefined);
    assert.equal(ctx.consumed(), false);
    assert.equal(latest(ctx).status, expected);
  }
});

test('unrelated requests do not consume or modify their responses', async () => {
  const ctx = context(at(PATH, SOURCE), { url: 'https://one.google.com/ai' });
  assert.equal(await run(ctx), undefined);
  assert.equal(ctx.consumed(), false);
  assert.equal(ctx.database.size, 0);
});

test('request cache refresh preserves authorization, cookies, method and URL', async () => {
  const ctx = context(new Uint8Array());
  delete ctx.response;
  ctx.request.headers.set('If-None-Match', 'old');
  const result = await run(ctx);
  assert.equal(result.headers.get('accept-encoding'), 'identity');
  assert.equal(result.headers.get('cache-control'), 'no-cache');
  assert.equal(result.headers.has('if-none-match'), false);
  assert.equal(result.headers.get('authorization'), 'SECRET_AUTH');
  assert.equal(result.headers.get('cookie'), 'SECRET_COOKIE');
  assert.equal(ctx.request.method, 'POST');
  assert.equal(ctx.request.url, URL_NATIVE);
});

test('reports exclude unknown payload strings, query parameters, headers and receipts', async () => {
  const start = logs.length;
  const ctx = context(concat(at(PATH, SOURCE), field(2, 'SECRET_RECEIPT')), { url: URL_NATIVE + 'account=SECRET_ACCOUNT' });
  await run(ctx);
  const output = JSON.stringify({ log: logs.slice(start), reports: [...ctx.database.values()], notifications: ctx.notifications });
  for (const secret of ['SECRET_AUTH', 'SECRET_COOKIE', 'SECRET_RECEIPT', 'SECRET_ACCOUNT']) assert.equal(output.includes(secret), false);
});

test('body, field and nesting limits reject expensive payloads without partial rewrites', () => {
  assert.throws(() => patchProtobuf(new Uint8Array(2097153), parsePaths()));
  assert.throws(() => patchProtobuf(Uint8Array.from({ length: 100002 }, (_, i) => i % 2 ? 1 : 8), parsePaths()));
  let bytes = field(1, SOURCE);
  for (let i = 0; i < 52; i++) bytes = field(1, bytes);
  assert.throws(() => patchProtobuf(bytes, parsePaths()));
});

test('the script runs without browser URL or Headers globals and has only the default production export', async () => {
  assert.equal(/export\s+(?:function|const|let|\{)/.test(source), false);
  assert.equal(source.startsWith('export default async function(ctx)'), true);
  const ctx = context(at(PATH, SOURCE));
  const oldURL = globalThis.URL;
  const oldHeaders = globalThis.Headers;
  try {
    globalThis.URL = undefined; globalThis.Headers = undefined;
    assert.deepEqual((await run(ctx)).body, at(PATH, TARGET));
  } finally { globalThis.URL = oldURL; globalThis.Headers = oldHeaders; }
});

test('YAML preserves web rules and exposes bounded native rewrite settings', () => {
  const path = fileURLToPath(new URL('./GoogleApp_Ultra_Native30TB_Egern.yaml', import.meta.url));
  const result = spawnSync('/usr/bin/ruby', ['-r', 'yaml', '-r', 'json', '-e', 'puts JSON.generate(YAML.load_file(ARGV[0]))', path], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout);
  assert.equal(config.env_schema.MODE.default_value, 'rewrite');
  assert.equal(config.env_schema.FIELD_PATHS.default_value, PATH);
  assert.equal(config.body_rewrites.length, 2);
  const response = config.scriptings.find(item => item.http_response).http_response;
  assert.equal(new RegExp(response.match).test(URL_NATIVE), true);
  assert.equal(new RegExp(response.match).test('https://one.google.com/ai'), false);
  assert.equal(response.binary_body, true);
  assert.equal(response.body_required, true);
});
