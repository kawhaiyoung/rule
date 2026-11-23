import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
const production = await readFile(new URL('./GoogleApp_Ultra_Web_Egern.js', import.meta.url), 'utf8');
// Test-only exports are appended in memory, never shipped to Egern.
const { default: run, endpoint, inspectText, inspectPayload } = await import(
  'data:text/javascript;base64,' + Buffer.from(production + '\nexport { endpoint, inspectText, inspectPayload };').toString('base64'));
const logs = [];
const originalLog = console.log;
console.log = (...values) => logs.push(values.join(' '));
after(() => { console.log = originalLog; });

const SOURCE30 = 'g1.ios.30tb.ai.pro.m';
const SOURCE20 = 'g1.ios.20tb.m.v2';
const TARGET30 = 'g1.ios.30tb.m';
const WEB = 'https://one.google.com/ai?example=1';
const NATIVE = 'https://subscriptionsmobile-pa.googleapis.com/google.internal.subscriptions.v1.Service/GetDynamicStorefrontInfo';
const encode = s => new TextEncoder().encode(s);
const cat = (...items) => Uint8Array.from(items.flatMap(item => [...item]));
function varint(n) {
  const out = [];
  do { const v = n % 128; n = Math.floor(n / 128); out.push(v | (n ? 128 : 0)); } while (n);
  return Uint8Array.from(out);
}
function field(n, value) { const b = typeof value === 'string' ? encode(value) : value; return cat(varint(n * 8 + 2), varint(b.length), b); }
function frame(bytes, flag = 0) { const h = new Uint8Array(5); h[0] = flag; new DataView(h.buffer).setUint32(1, bytes.length, false); return cat(h, bytes); }
function context(body, { url = WEB, method = url === NATIVE ? 'POST' : 'GET', type = 'text/html; charset=utf-8', env = {}, headers = {}, status = 200, database = new Map() } = {}) {
  const notifications = [];
  let consumed = false;
  const bytes = typeof body === 'string' ? encode(body) : body;
  const consume = () => { assert.equal(consumed, false, 'body must be consumed at most once'); consumed = true; };
  return {
    request: { url, method, headers: new Headers({ authorization: 'DO_NOT_LOG_AUTH', cookie: 'DO_NOT_LOG_COOKIE' }) },
    response: { status, headers: new Headers({ 'content-type': type, ...headers }),
      async text() { consume(); return typeof body === 'string' ? body : new TextDecoder().decode(bytes); },
      async arrayBuffer() { consume(); return bytes.slice().buffer; } },
    env, notifications, database, wasConsumed: () => consumed,
    storage: { getJSON: k => database.get(k), setJSON: (k, v) => database.set(k, v) },
    notify: item => notifications.push(item),
  };
}
const latest = ctx => [...ctx.database.values()][0];
function configuration() {
  const path = fileURLToPath(new URL('./GoogleApp_Ultra_Web_Egern.yaml', import.meta.url));
  const ruby = spawnSync('/usr/bin/ruby', ['-r', 'yaml', '-r', 'json', '-e', 'puts JSON.generate(YAML.load_file(ARGV[0]))', path], { encoding: 'utf8' });
  assert.equal(ruby.status, 0, ruby.stderr);
  return JSON.parse(ruby.stdout);
}

test('URL matching covers queryless and trailing-slash AI pages but excludes payment and unrelated endpoints', () => {
  for (const url of [WEB, 'https://one.google.com/ai', 'https://one.google.com/ai/', 'https://one.google.com:443/ai/?x=1']) assert.equal(endpoint({ url, method: 'GET' }), 'web');
  for (const url of [NATIVE, NATIVE + '?x=1']) assert.equal(endpoint({ url, method: 'POST' }), 'native');
  for (const url of ['https://one.google.com.evil.test/ai', 'https://one.google.com:444/ai', 'http://one.google.com/ai', 'https://one.google.com/ai-student', 'https://one.google.com/ai/other', 'https://payments.google.com/ai', 'https://one.google.com/ai#private', NATIVE + '/extra', 'https://subscriptionsmobile-pa.googleapis.com/ValidateReceipt']) assert.equal(endpoint({ url, method: 'GET' }), null);
  assert.equal(endpoint({ url: WEB, method: 'POST' }), null);
  assert.equal(endpoint({ url: NATIVE, method: 'GET' }), null);
});

test('built-in rules preserve tutorial mappings and price labels independently of scripts', () => {
  const text = JSON.stringify({ products: [SOURCE30, SOURCE20, 'com.google.one.30tb.ai.pro.m'], price: 'PAGE_PRICE_UNCHANGED', activeMember: true });
  let body = text;
  const rules = configuration().body_rewrites;
  assert.equal(rules.length, 2);
  for (const { response_regex: rule } of rules) {
    assert.equal(new RegExp(rule.match).test(WEB), true);
    assert.equal(rule.disabled, false);
    body = body.replace(new RegExp(rule.find, 'g'), rule.replace);
  }
  assert.deepEqual(JSON.parse(body), { products: [TARGET30, 'g1.ios.20tb.m', 'com.google.one.30tb.m'], price: 'PAGE_PRICE_UNCHANGED', activeMember: true });
});

test('text inspection excludes similar identifiers and unsupported SKU variants', () => {
  const text = 'g1.ios.130tb.ai.pro.m g1.ios.30tb.ai.pro.m.v2 g1.ios.30tb.ai.pro.month x30tb.ai.pro.m';
  assert.equal(inspectText(text).matches, 0);
});

test('inspection reports source candidates without offering any rewrite operation', () => {
  const result = inspectText(JSON.stringify([SOURCE30, SOURCE30, SOURCE20]));
  assert.equal(result.matches, 3);
  assert.equal(result.diagnostics.candidate_skus.length, 2);
  assert.equal('body' in result, false);
});

test('native nested candidates have numeric paths and input bytes remain identical', () => {
  const bytes = cat(field(1, field(3, SOURCE30)), field(2, field(4, SOURCE20)), field(3, 'NON_PRODUCT_PRIVATE_TEXT'));
  const original = bytes.slice();
  const result = inspectPayload(bytes, 'application/x-protobuf');
  assert.equal(result.source_fields, 2);
  assert.deepEqual(result.source_paths, ['1.3', '2.4']);
  assert.deepEqual(bytes, original);
  assert.equal(result.candidate_skus.some(item => item.value.includes('PRIVATE')), false);
});

test('native gRPC and gRPC-web frames inspect message fields and skip trailers', () => {
  const body = field(1, SOURCE30);
  assert.equal(inspectPayload(frame(body), 'application/grpc+proto').source_fields, 1);
  assert.equal(inspectPayload(cat(frame(body), frame(encode('authorization: DO_NOT_LOG'), 128)), 'application/grpc-web+proto').source_fields, 1);
  assert.throws(() => inspectPayload(frame(body, 1), 'application/grpc+proto'));
  assert.throws(() => inspectPayload(frame(body), 'application/grpc-web-text'));
});

test('malformed or truncated native messages are rejected without mutating their bytes', () => {
  for (const bytes of [Uint8Array.of(0), Uint8Array.of(10, 255), Uint8Array.of(10, 10, 1), Uint8Array.of(9, 0), Uint8Array.of(8, 255), Uint8Array.of(255, 255, 255, 255, 255)]) {
    const original = bytes.slice();
    assert.throws(() => inspectPayload(bytes));
    assert.deepEqual(bytes, original);
  }
});

test('native field, depth and body limits reject expensive payloads', () => {
  assert.throws(() => inspectPayload(new Uint8Array(2097153)));
  assert.throws(() => inspectPayload(Uint8Array.from({ length: 100002 }, (_, i) => i % 2 ? 1 : 8)));
  let nested = field(1, SOURCE30);
  for (let i = 0; i < 52; i++) nested = field(1, nested);
  assert.throws(() => inspectPayload(nested));
});

test('candidate storage is deduplicated and truncation is explicit', () => {
  const bytes = cat(...Array.from({ length: 80 }, (_, i) => field(1, 'g1.ios.example' + i + '.m')), field(1, 'g1.ios.example0.m'));
  const result = inspectPayload(bytes);
  assert.equal(result.candidate_fields, 81);
  assert.equal(result.candidate_skus.length, 64);
  assert.equal(result.candidates_truncated, true);
});

test('web inspection returns the current body unchanged and does not alter response headers', async () => {
  const ctx = context(SOURCE30, { headers: { 'content-length': '18', etag: 'old', 'content-md5': 'old', digest: 'old', 'content-digest': 'old', 'set-cookie': 'KEEP_COOKIE', 'cache-control': 'private' } });
  const result = await run(ctx);
  assert.equal(result.body, SOURCE30);
  assert.equal(result.headers, undefined);
  assert.equal(ctx.response.headers.get('etag'), 'old');
  assert.equal(ctx.response.headers.get('set-cookie'), 'KEEP_COOKIE');
  assert.equal(ctx.response.headers.get('cache-control'), 'private');
  assert.equal(latest(ctx).web.status, 'source_found');
  assert.equal(latest(ctx).web.replacements, 0);
});

test('native responses stay byte-identical even with web rewrite mode enabled', async () => {
  const bytes = field(1, field(2, SOURCE30));
  const ctx = context(bytes, { url: NATIVE, type: 'application/x-protobuf', env: { MODE: 'rewrite' } });
  const result = await run(ctx);
  assert.deepEqual(result.body, bytes);
  assert.equal(latest(ctx).native.mode, 'inspect');
  assert.equal(latest(ctx).native.status, 'native_source_found');
  assert.equal(latest(ctx).native.replacements, 0);
});

test('native JSON responses are inspected but never rewritten', async () => {
  const body = JSON.stringify({ sku: SOURCE30, isMember: true });
  const ctx = context(body, { url: NATIVE, type: 'application/json' });
  assert.equal((await run(ctx)).body, body);
  assert.equal(latest(ctx).native.replacements, 0);
});

test('inspect, no-match and existing-legacy paths preserve text after stream consumption', async () => {
  for (const [body, env, expected] of [[SOURCE30, { MODE: 'inspect' }, 'source_found'], ['unrelated text', {}, 'no_source_sku'], [TARGET30, {}, 'legacy_sku_present']]) {
    const ctx = context(body, { env });
    assert.equal((await run(ctx)).body, body);
    assert.equal(latest(ctx).web.status, expected);
  }
});

test('unknown encoding, charset, content type and non-2xx status leave the body unread', async () => {
  const cases = [
    [{ headers: { 'content-encoding': 'br' } }, 'encoded_response_passthrough'],
    [{ type: 'text/html; charset=gbk' }, 'unsupported_charset'],
    [{ type: 'image/png' }, 'unsupported_content_type'],
    [{ status: 304 }, 'http_not_2xx'],
  ];
  for (const [options, expected] of cases) {
    const ctx = context(SOURCE30, options);
    assert.equal(await run(ctx), undefined);
    assert.equal(ctx.wasConsumed(), false);
    assert.equal(latest(ctx).web.status, expected);
  }
});

test('parse failure after consuming native bytes restores the original response', async () => {
  const bytes = cat(field(1, SOURCE30), Uint8Array.of(0));
  const ctx = context(bytes, { url: NATIVE, type: 'application/x-protobuf' });
  assert.deepEqual((await run(ctx)).body, bytes);
  assert.equal(latest(ctx).native.status, 'parse_failed_passthrough');
});

test('fresh-request handling changes cache and encoding headers while preserving credentials and URL', async () => {
  const ctx = context(SOURCE30);
  delete ctx.response;
  ctx.request.headers.set('If-None-Match', 'old');
  ctx.request.headers.set('If-Modified-Since', 'old');
  const result = await run(ctx);
  assert.equal(result.headers.get('accept-encoding'), 'identity');
  assert.equal(result.headers.get('cache-control'), 'no-cache');
  assert.equal(result.headers.has('if-none-match'), false);
  assert.equal(result.headers.has('if-modified-since'), false);
  assert.equal(result.headers.get('authorization'), 'DO_NOT_LOG_AUTH');
  assert.equal(result.headers.get('cookie'), 'DO_NOT_LOG_COOKIE');
  assert.equal(ctx.request.url, WEB);
});

test('reports and console diagnostics exclude account URLs, full responses, auth headers and receipts', async () => {
  const start = logs.length;
  const ctx = context(JSON.stringify({ sku: SOURCE30, account: 'DO_NOT_LOG_ACCOUNT', receipt: 'DO_NOT_LOG_RECEIPT' }), { url: WEB + '&account=DO_NOT_LOG_URL' });
  await run(ctx);
  const output = JSON.stringify({ records: latest(ctx), notifications: ctx.notifications, logs: logs.slice(start) });
  for (const secret of ['DO_NOT_LOG_ACCOUNT', 'DO_NOT_LOG_RECEIPT', 'DO_NOT_LOG_AUTH', 'DO_NOT_LOG_COOKIE', 'DO_NOT_LOG_URL']) assert.equal(output.includes(secret), false);
  assert.equal(output.includes(SOURCE30), true);
});

test('notification or storage failures do not break response inspection and are visible in logs', async () => {
  const start = logs.length;
  const ctx = context(SOURCE30);
  ctx.notify = () => { throw Error('notifications unavailable'); };
  ctx.storage = { getJSON() { throw Error('storage unavailable'); }, setJSON() { throw Error('storage unavailable'); } };
  assert.equal((await run(ctx)).body, SOURCE30);
  assert.equal(logs.slice(start).some(x => x.includes('notify_failed')), true);
});

test('manual report includes both endpoints and works independently of automatic notifications', async () => {
  const database = new Map();
  const ctx = context(SOURCE30, { env: { NOTIFY: 'false' }, database });
  await run(ctx);
  await run(context(field(1, SOURCE20), { url: NATIVE, type: 'application/x-protobuf', database }));
  delete ctx.request;
  delete ctx.response;
  const result = await run(ctx);
  assert.equal(result.type, 'widget');
  const report = ctx.notifications.at(-1).action.text;
  assert.equal(report.includes('source_found'), true);
  assert.equal(report.includes('native_source_found'), true);
});

test('YAML and script agree on scoped URL matching and default native inspection', () => {
  const config = configuration();
  assert.equal('MODE' in config.env_schema, false);
  assert.equal(config.body_rewrites.length, 2, 'built-in rewrite remains independent of inspection scripts');
  assert.deepEqual(config.mitm.hostnames, ['one.google.com', 'subscriptionsmobile-pa.googleapis.com']);
  const request = config.scriptings.find(x => x.http_request).http_request;
  const responses = config.scriptings.filter(x => x.http_response).map(x => x.http_response);
  for (const url of [WEB, 'https://one.google.com/ai', 'https://one.google.com/ai/', NATIVE, NATIVE + '?x=1']) {
    assert.equal(new RegExp(request.match).test(url), true, url);
    assert.equal(responses.filter(r => new RegExp(r.match).test(url)).length, 1, url);
  }
  for (const url of ['https://one.google.com.evil.test/ai', 'https://one.google.com:444/ai', 'https://one.google.com/ai-student', NATIVE + '/extra', 'https://subscriptionsmobile-pa.googleapis.com/ValidateReceipt']) {
    assert.equal(new RegExp(request.match).test(url), false, url);
    assert.equal(responses.some(r => new RegExp(r.match).test(url)), false, url);
  }
  assert.equal(responses.every(x => x.body_required && x.binary_body && x.max_size === 2097152), true);
  const scriptUrls = config.scriptings.map(x => Object.values(x)[0].script_url);
  assert.equal(new Set(scriptUrls).size, 1);
  assert.equal(scriptUrls.every(x => /^https:\/\/raw\.githubusercontent\.com\/kawhaiyoung\/rule\/[0-9a-f]{40}\/GoogleApp_Ultra_Web_Egern\.js$/.test(x)), true);
});

test('production script uses only the documented default export', () => {
  assert.equal(/\bexport\s+(?:const|let|var|function|class|\{)/.test(production), false);
  assert.equal(/\bexport\s+default\s+async\s+function\(ctx\)/.test(production), true);
});

test('request handling works when browser URL and Headers globals are absent', async () => {
  const originalURL = globalThis.URL;
  const originalHeaders = globalThis.Headers;
  const ctx = context(SOURCE30);
  try {
    globalThis.URL = undefined;
    globalThis.Headers = undefined;
    assert.equal(endpoint(ctx.request), 'web');
    assert.equal((await run(ctx)).body, SOURCE30);
    assert.equal(latest(ctx).web.status, 'source_found');
  } finally {
    globalThis.URL = originalURL;
    globalThis.Headers = originalHeaders;
  }
});

test('manual self-test exposes version and notification API failures without a traffic match', async () => {
  const ctx = context('');
  delete ctx.request;
  delete ctx.response;
  ctx.app = { version: 'EXAMPLE_VERSION' };
  ctx.notify = undefined;
  const result = await run(ctx);
  const text = result.children.map(x => x.text).join('\n');
  assert.equal(text.includes('诊断3自检运行成功'), true);
  assert.equal(text.includes('EXAMPLE_VERSION'), true);
  assert.equal(text.includes('通知调用: 失败'), true);
});

test('the actual RPC path shown in the phone log is recognized without URL parsing', () => {
  assert.equal(endpoint({ method: 'POST', url: 'https://subscriptionsmobile-pa.googleapis.com/$rpc/google.internal.subscriptions.mobile.v1.SubscriptionsApiMobileService/GetDynamicStorefrontInfo?' }), 'native');
});
