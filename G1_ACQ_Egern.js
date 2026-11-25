export default async function(ctx) {
  try { return await main(ctx); }
  catch (error) { log('entry_error', { error: errorName(error) }); return; }
}
// Egern native Script API. Offer mappings independently adapted from:
// crhywun/g1-acq, commit 3112623ade6a49d9e08b991a3e17333d599314b6 (v7.7.0).
// Native protobuf handling extends the separately preserved experiment4 engine.
// This script has no outbound HTTP calls. Reports contain product tokens and counts,
// never headers, account identifiers, transaction payloads or full response bodies.
const VERSION = 'g1-acq-egern-v1.0.0';
const KEY = 'g1.acq.egern.state.v1';
const REPORT_ROOT = 'https://one.google.com/g1-egern-report';
const MAX_BODY = 2 * 1024 * 1024;
const MAX_FIELDS = 50000;
const MAX_DEPTH = 48;
const SKU_LIMIT = 300;
const EVENT_LIMIT = 10;
const SOURCE30 = 'g1.ios.30tb.ai.pro.m';
const SOURCE20 = 'g1.ios.20tb.m.v2';
const PRO_TARGET = 'g1.2tb.ai.12months_ip_90p';
const DEFAULT_PATH = '1.11.1.11.1.18.1.2.20.1.11.1.11.1.11.1.13.1.11.1.12.1.3.4.9.4.1.2.2.1';
const SKU_VALID = /^(?:g1\.|com\.google\.one\.)[A-Za-z0-9._-]{1,160}$/;
const TOKEN = /(^|[^A-Za-z0-9._@%-])((?:g1\.|com\.google\.one\.)[A-Za-z0-9._-]+)(?=$|[^A-Za-z0-9._-])/g;
const OFFERS = {
  discount: {
    [SOURCE20]: ['g1.20tb.3months_ip_90p.acq', 'g1.20tb.3months_ip_75p.acq'],
    [SOURCE30]: ['g1.ai.ultra.3months_ip_90p.acq', 'g1.ai.ultra.3months_ip_75p.acq'],
  },
  trial: {
    [SOURCE20]: ['g1.20tb.1month_eft.acq', 'g1.20tb.3months_ip_90p.acq'],
    [SOURCE30]: ['g1.ai.ultra.1month_eft.acq', 'g1.ai.ultra.3months_ip_90p.acq'],
  },
};
class Malformed extends Error {}
class LimitExceeded extends Error {}

function errorName(error) { return String(error && error.name || 'Error').slice(0, 40); }
function log(stage, data = {}) {
  try { console.log('[g1-egern] ' + JSON.stringify({ version: VERSION, stage, ...data })); } catch {}
}
function config(env = {}) {
  const mode = String(env.OFFER_MODE || 'discount');
  const action = String(env.ACTION || 'rewrite');
  if (!['discount', 'trial'].includes(mode) || !['rewrite', 'inspect'].includes(action)) throw new RangeError('Invalid mode/action');
  const pathText = String(env.NATIVE_PATHS || '').trim() || DEFAULT_PATH;
  const paths = pathText.split(',').map(value => value.trim());
  if (paths.length > 8 || !paths.every(value => value.length < 512 && /^[1-9]\d*(?:\.[1-9]\d*)*$/.test(value))) throw new RangeError('Invalid paths');
  return { mode, action, paths: new Set(paths), native: String(env.NATIVE_30TB || 'true') === 'true',
    pro: String(env.PRO_2TB || 'false') === 'true', notify: String(env.NOTIFY || 'true') === 'true' };
}
function route(request) {
  if (!request || typeof request.url !== 'string') return null;
  const url = request.url;
  const method = String(request.method || '').toUpperCase();
  if (/^https:\/\/one\.google\.com(?::443)?\/g1-egern-report\/?(?:\?[^#]*)?$/.test(url)) return method === 'GET' ? 'report' : 'report-denied';
  if (method === 'POST' && /^https:\/\/subscriptionsmobile-pa\.googleapis\.com(?::443)?\/(?:[^?#]*\/)?GetDynamicStorefrontInfo(?:\?[^#]*)?$/.test(url)) return 'native';
  if (method === 'GET' && /^https:\/\/one\.google\.com(?::443)?\/[^#]*$/.test(url)) {
    return /^https:\/\/one\.google\.com(?::443)?\/ai\/?(?:\?[^#]*)?$/.test(url) ? 'web' : 'scan';
  }
  return null;
}
function safeRoute(url, kind) {
  if (kind === 'native') return 'native/GetDynamicStorefrontInfo';
  const path = String(url).replace(/^https:\/\/one\.google\.com(?::443)?/, '').split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  if (['/', '/ai', '/plans'].includes(path)) return path;
  return /^\/_\/[^?#]+\/data\/batchexecute$/.test(path) ? '/_/…/data/batchexecute' : '[other one.google.com path]';
}
function discoverText(body) {
  // Decode only a discovery copy; keep original source matching and body intact.
  const text = body.replace(/\\u002e|\\x2e|&#0*46;|&#x0*2e;|&period;/gi, '.');
  const rows = new Map();
  for (const match of text.matchAll(new RegExp(TOKEN.source, 'g'))) {
    const id = match[2];
    if (!SKU_VALID.test(id)) continue;
    rows.set(id, (rows.get(id) || 0) + 1);
  }
  return [...rows].map(([id, count]) => ({ id, count }));
}
function choose(mode, source, observed) {
  const [preferred, fallback] = OFFERS[mode][source];
  if (observed.has(preferred)) return { to: preferred, fallback: false, basis: 'preferred-in-response' };
  if (observed.has(fallback)) return { to: fallback, fallback: true, basis: 'fallback-in-response' };
  return { to: preferred, fallback: false, basis: 'default-not-observed' };
}
function rewriteText(body, cfg) {
  const candidates = discoverText(body);
  const observed = new Set(candidates.map(row => row.id));
  const mappings = new Map();
  let hits = 0;
  const output = body.replace(new RegExp(TOKEN.source, 'g'), (match, before, id) => {
    let selection;
    if (id === SOURCE20 || id === SOURCE30) selection = choose(cfg.mode, id, observed);
    else if (cfg.pro && id.startsWith('g1.ios.2tb.') && id.length > 'g1.ios.2tb.'.length) selection = { to: PRO_TARGET, fallback: false, basis: 'optional-pro-candidate' };
    else return match;
    const item = mappings.get(id) || { id, ...selection, count: 0 };
    item.count++;
    mappings.set(id, item);
    hits++;
    return before + (cfg.action === 'rewrite' ? selection.to : id);
  });
  return { body: output, candidates, hits, mappings: [...mappings.values()] };
}

// Schema-free protobuf parser. Only complete ASCII source values at cfg.paths
// can change. Invalid nested LEN payloads remain opaque; limits abort the response.
const ascii = value => Uint8Array.from(value, character => character.charCodeAt(0));
function equal(a, b) { return a.length === b.length && a.every((value, index) => value === b[index]); }
function join(parts) {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}
function varint(value) {
  const out = [];
  do { const byte = value % 128; value = Math.floor(value / 128); out.push(byte | (value ? 128 : 0)); } while (value);
  return Uint8Array.from(out);
}
function readU32(data, offset) {
  let value = 0, power = 1;
  for (let i = 0; i < 5; i++) {
    if (offset >= data.length) throw new Malformed();
    const byte = data[offset++];
    if (i === 4 && byte > 15) throw new Malformed();
    value += (byte & 127) * power;
    if (!(byte & 128)) return { value, offset };
    power *= 128;
  }
  throw new Malformed();
}
function skipVarint(data, offset) {
  for (let i = 0; i < 10; i++) {
    if (offset >= data.length) throw new Malformed();
    const byte = data[offset++];
    if (i === 9 && byte > 1) throw new Malformed();
    if (!(byte & 128)) return offset;
  }
  throw new Malformed();
}
function binaryToken(bytes) {
  if (bytes.length < 4 || bytes.length > 180) return null;
  let value = '';
  for (const byte of bytes) {
    if (!((byte >= 48 && byte <= 57) || (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122) || [45, 46, 95].includes(byte))) return null;
    value += String.fromCharCode(byte);
  }
  return SKU_VALID.test(value) ? value : null;
}
function emptyDiag() { return { candidates: [], candidateFields: 0, candidatesTruncated: false, sourceFields: 0, sourcePaths: [] }; }
function mergeDiag(into, from) {
  into.candidateFields += from.candidateFields;
  into.sourceFields += from.sourceFields;
  into.sourcePaths.push(...from.sourcePaths.slice(0, Math.max(0, 64 - into.sourcePaths.length)));
  into.candidatesTruncated ||= from.candidatesTruncated;
  for (const item of from.candidates) {
    const old = into.candidates.find(row => row.id === item.id);
    if (old) old.count += item.count;
    else if (into.candidates.length < SKU_LIMIT) into.candidates.push({ ...item });
    else into.candidatesTruncated = true;
  }
}
function message(data, depth, path, state) {
  if (depth > MAX_DEPTH) throw new LimitExceeded();
  const parts = [], hits = [], diag = emptyDiag();
  let offset = 0;
  while (offset < data.length) {
    if (++state.fields > MAX_FIELDS) throw new LimitExceeded();
    const start = offset, tag = readU32(data, offset);
    offset = tag.offset;
    const number = Math.floor(tag.value / 8), wire = tag.value % 8;
    if (!number) throw new Malformed();
    if (wire === 0) offset = skipVarint(data, offset);
    else if (wire === 1) offset += 8;
    else if (wire === 5) offset += 4;
    else if (wire === 2) {
      const size = readU32(data, offset), end = size.offset + size.value;
      if (end > data.length) throw new Malformed();
      const payload = data.subarray(size.offset, end), dotted = path.concat(number).join('.');
      const token = binaryToken(payload);
      if (token) {
        diag.candidateFields++;
        diag.candidates.push({ id: token, count: 1 });
      }
      let next = payload, nestedHits = [];
      if (equal(payload, state.source)) {
        diag.sourceFields++;
        if (diag.sourcePaths.length < 64) diag.sourcePaths.push(dotted);
        if (state.target && state.paths.has(dotted)) { next = state.target; nestedHits = [dotted]; }
      } else if (payload.length && !token) {
        try {
          const nested = message(payload, depth + 1, path.concat(number), state);
          mergeDiag(diag, nested.diag); next = nested.bytes; nestedHits = nested.hits;
        } catch (error) { if (!(error instanceof Malformed)) throw error; }
      }
      if (nestedHits.length) { parts.push(data.subarray(start, tag.offset), varint(next.length), next); hits.push(...nestedHits); }
      else parts.push(data.subarray(start, end));
      offset = end;
      continue;
    } else throw new Malformed();
    if (offset > data.length) throw new Malformed();
    parts.push(data.subarray(start, offset));
  }
  // Deduplicate siblings as well as nested messages, bounded before publication.
  const bounded = emptyDiag(); mergeDiag(bounded, diag);
  return { bytes: hits.length ? join(parts) : data, hits, diag: bounded };
}
function parsePayload(data, contentType, target, paths) {
  if (!(data instanceof Uint8Array) || data.length > MAX_BODY) throw new LimitExceeded();
  const type = contentType.toLowerCase();
  if (type.includes('grpc-web-text')) throw new Malformed();
  const state = { fields: 0, source: ascii(SOURCE30), target: target ? ascii(target) : null, paths };
  if (!/^application\/grpc(?:[;+\-]|$)/.test(type)) return message(data, 0, [], state);
  const parts = [], hits = [], diag = emptyDiag();
  let offset = 0;
  while (offset < data.length) {
    if (offset + 5 > data.length) throw new Malformed();
    const flag = data[offset], length = new DataView(data.buffer, data.byteOffset + offset + 1, 4).getUint32(0, false);
    const end = offset + 5 + length;
    if (end > data.length) throw new Malformed();
    if (flag === 128 && type.includes('grpc-web')) parts.push(data.subarray(offset, end));
    else {
      if (flag !== 0) throw new Malformed();
      const changed = message(data.subarray(offset + 5, end), 0, [], state);
      mergeDiag(diag, changed.diag); hits.push(...changed.hits);
      if (changed.hits.length) {
        const header = new Uint8Array(5); new DataView(header.buffer).setUint32(1, changed.bytes.length, false);
        parts.push(header, changed.bytes);
      } else parts.push(data.subarray(offset, end));
    }
    offset = end;
  }
  return { bytes: hits.length ? join(parts) : data, hits, diag };
}
function rewriteNative(bytes, contentType, cfg) {
  const inspected = parsePayload(bytes, contentType, null, cfg.paths);
  const observed = new Set(inspected.diag.candidates.map(row => row.id));
  const selection = choose(cfg.mode, SOURCE30, observed);
  const result = parsePayload(bytes, contentType, selection.to, cfg.paths);
  const change = cfg.action === 'rewrite' && cfg.native && result.hits.length > 0;
  return { body: change ? result.bytes : bytes, candidates: inspected.diag.candidates,
    hits: result.hits.length, replacements: change ? result.hits.length : 0,
    paths: [...new Set(result.hits)].slice(0, 64), sourceFields: inspected.diag.sourceFields,
    sourcePaths: [...new Set(inspected.diag.sourcePaths)].slice(0, 64),
    candidatesTruncated: inspected.diag.candidatesTruncated,
    mappings: [{ id: SOURCE30, ...selection, count: result.hits.length }],
    status: change ? 'rewritten' : result.hits.length ? 'candidate_found' : inspected.diag.sourceFields ? 'path_not_matched' : 'no_source_sku' };
}

function counter(value) { return Number.isSafeInteger(value) && value >= 0 ? value : 0; }
function freshState() { return { schema: 1, version: VERSION, skus: [], recent: [], latest: {}, counters: { text: 0, native: 0, skipped: 0 }, truncated: false }; }
function loadState(ctx) {
  try {
    const raw = ctx.storage.getJSON(KEY);
    if (!raw || raw.schema !== 1 || !Array.isArray(raw.skus) || !Array.isArray(raw.recent)) return freshState();
    const state = freshState();
    state.skus = raw.skus.slice(0, SKU_LIMIT).filter(row => row && SKU_VALID.test(row.id) && typeof row.id === 'string')
      .map(row => ({ id: row.id, count: counter(row.count), lastSeen: String(row.lastSeen || '').slice(0, 32) }));
    state.recent = raw.recent.slice(-EVENT_LIMIT).filter(row => row && ['web', 'scan', 'native'].includes(row.endpoint))
      .map(row => ({ time: String(row.time || '').slice(0, 32), endpoint: row.endpoint,
        mode: ['discount', 'trial'].includes(row.mode) ? row.mode : '',
        route: ['/', '/ai', '/plans', '/_/…/data/batchexecute', '[other one.google.com path]', 'native/GetDynamicStorefrontInfo'].includes(row.route) ? row.route : '[other one.google.com path]',
        status: String(row.status || '').replace(/[^a-z0-9_-]/g, '').slice(0, 64), candidates: counter(row.candidates), added: counter(row.added), omitted: counter(row.omitted), matches: counter(row.matches), replacements: counter(row.replacements) }));
    for (const kind of ['web', 'native']) {
      const item = raw.latest && raw.latest[kind];
      if (!item || !['discount', 'trial'].includes(item.mode)) continue;
      state.latest[kind] = { mode: item.mode, action: ['rewrite', 'inspect'].includes(item.action) ? item.action : '',
        time: String(item.time || '').slice(0, 32), status: String(item.status || '').replace(/[^a-z0-9_-]/g, '').slice(0, 64),
        matches: counter(item.matches), replacements: counter(item.replacements), sourceFields: counter(item.sourceFields),
        paths: Array.isArray(item.paths) ? item.paths.slice(0, 64).filter(path => typeof path === 'string' && /^[1-9]\d*(?:\.[1-9]\d*)*$/.test(path) && path.length < 512) : [],
        mappings: Array.isArray(item.mappings) ? item.mappings.slice(0, 32).filter(row => row && SKU_VALID.test(row.id) && SKU_VALID.test(row.to))
          .map(row => ({ id: row.id, to: row.to, count: counter(row.count), fallback: row.fallback === true,
            basis: ['preferred-in-response', 'fallback-in-response', 'default-not-observed', 'optional-pro-candidate'].includes(row.basis) ? row.basis : '' })) : [] };
    }
    for (const key of ['text', 'native', 'skipped']) state.counters[key] = counter(raw.counters && raw.counters[key]);
    state.truncated = raw.truncated === true;
    return state;
  } catch { return freshState(); }
}
function saveEvent(ctx, cfg, kind, requestUrl, status, details = {}) {
  const state = loadState(ctx), time = new Date().toISOString(), rows = details.candidates || [];
  let added = 0, omitted = 0;
  for (const row of rows) {
    if (!SKU_VALID.test(row.id)) continue;
    const old = state.skus.find(item => item.id === row.id);
    if (old) { old.count += row.count; old.lastSeen = time; }
    else if (state.skus.length < SKU_LIMIT) { state.skus.push({ id: row.id, count: row.count, lastSeen: time }); added++; }
    else { omitted++; state.truncated = true; }
  }
  if (details.candidatesTruncated) state.truncated = true;
  const event = { time, endpoint: kind, mode: cfg.mode, route: safeRoute(requestUrl, kind), status,
    candidates: rows.length, added, omitted, matches: details.hits || 0, replacements: details.replacements || 0 };
  state.recent.push(event); state.recent = state.recent.slice(-EVENT_LIMIT);
  state.counters[details.skipped ? 'skipped' : kind === 'native' ? 'native' : 'text']++;
  if (kind !== 'scan') state.latest[kind] = { time, mode: cfg.mode, action: cfg.action, status,
    matches: details.hits || 0, replacements: details.replacements || 0,
    sourceFields: details.sourceFields || 0, paths: details.paths || [], mappings: details.mappings || [] };
  let saved = false;
  try { ctx.storage.setJSON(KEY, state); saved = true; } catch {}
  log('result', { ...event, saved });
  if (cfg.notify && kind !== 'scan') {
    const text = `G1 ACQ Egern ${VERSION}\n${kind}: ${status}; 模式 ${cfg.mode}\n匹配 ${event.matches}; 实际替换 ${event.replacements}\n` +
      (details.mappings || []).map(item => `${item.id} → ${item.to}; x${item.count}; ${item.basis}`).join('\n') +
      `\n存储 ${saved ? '已保存' : '失败'}; 完整报告 ${REPORT_ROOT}\n本地改写不证明资格、Apple报价、旧订阅退款或Google权益。`;
    try { ctx.notify({ title: 'G1 ACQ Egern · ' + cfg.mode, body: `${kind}: ${status}; 实际替换 ${event.replacements}；点击复制`,
      sound: false, action: { type: 'clipboard', text } }); } catch {}
  }
}
function reportObject(ctx, cfg) {
  return { reportVersion: VERSION, configuredMode: cfg.mode, configuredAction: cfg.action,
    native30TB: cfg.native, nativePaths: [...cfg.paths], optionalPro2TB: cfg.pro,
    notice: '候选编号来自实际响应，非商店目录校验。记录模式和时间独立于当前配置；改写不证明价格、资格、退款或权益。',
    ...loadState(ctx) };
}
function escape(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function reportHtml(report) {
  return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>G1 ACQ Egern 本地报告</title><style>body{font:16px/1.6 -apple-system,sans-serif;max-width:950px;margin:28px auto;padding:0 20px;background:#f5f7fa;color:#202b3b}section{background:white;padding:20px;border-radius:12px;margin:18px 0}h1{font-size:25px}pre{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#1458b8}table{border-collapse:collapse;width:100%;font-size:14px}td,th{text-align:left;padding:8px;border-bottom:1px solid #ddd;overflow-wrap:anywhere}.scroll{overflow:auto}button{font:inherit;padding:10px}</style>' +
    '<h1>G1 ACQ Egern 本地报告</h1><p>本机脚本已接管 · ' + escape(VERSION) + '</p>' +
    '<p>当前配置：' + escape(report.configuredMode) + ' / ' + escape(report.configuredAction) + '；原生30TB：' + report.native30TB + '</p>' +
    '<p>' + escape(report.notice) + '</p><p><a href="' + REPORT_ROOT + '">刷新</a> · <a href="' + REPORT_ROOT + '?format=json">导出 JSON</a></p>' +
    '<section><h2>最近网页与原生改写记录</h2><pre>' + escape(JSON.stringify(report.latest, null, 2)) + '</pre></section>' +
    '<section><h2>最近10次响应</h2><pre>' + escape(JSON.stringify(report.recent.slice().reverse(), null, 2)) + '</pre></section>' +
    '<section><h2>改写前的候选编号</h2><p>累计 ' + report.skus.length + '/300；截断：' + report.truncated + '</p><div class="scroll"><table><tr><th>编号</th><th>次数</th><th>最近UTC</th></tr>' +
    report.skus.map(row => '<tr><td>' + escape(row.id) + '</td><td>' + row.count + '</td><td>' + escape(row.lastSeen) + '</td></tr>').join('') +
    '</table></div></section><p>本页在 Egern 本机生成；脚本不上传报告。</p></html>';
}
function reportResponse(ctx, cfg, denied = false) {
  const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-G1-Egern-Version': VERSION,
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" };
  if (denied) return ctx.respond({ status: 405, headers, body: 'Local report accepts GET only.' });
  const report = reportObject(ctx, cfg);
  if (/(?:\?|&)format=json(?:&|$)/.test(ctx.request.url)) {
    headers['Content-Type'] = 'application/json; charset=utf-8'; headers['Content-Disposition'] = 'attachment; filename="g1-egern-report.json"';
    return ctx.respond({ status: 200, headers, body: JSON.stringify(report, null, 2) });
  }
  return ctx.respond({ status: 200, headers, body: reportHtml(report) });
}
async function main(ctx) {
  if (!ctx || typeof ctx !== 'object') return;
  let cfg;
  try { cfg = config(ctx.env || {}); }
  catch (error) {
    log('invalid_config', { error: errorName(error) });
    if (ctx.request && ['report', 'report-denied'].includes(route(ctx.request))) return ctx.respond({ status: 400, body: 'Invalid Egern module parameters; check OFFER_MODE, ACTION and NATIVE_PATHS.' });
    return;
  }
  if (!ctx.request) {
    const report = reportObject(ctx, cfg);
    try { ctx.notify({ title: 'G1 ACQ Egern', body: `当前模式 ${cfg.mode}；点击复制最近记录`, sound: false,
      action: { type: 'clipboard', text: JSON.stringify(report, null, 2) } }); } catch {}
    return { type: 'widget', padding: 12, children: [{ type: 'text', text: VERSION }, { type: 'text', text: cfg.mode }, { type: 'text', text: REPORT_ROOT }] };
  }
  const kind = route(ctx.request);
  if (!kind) return;
  if (kind === 'report' || kind === 'report-denied') {
    if (ctx.response) return; // Never rescan or recreate our own local response.
    return reportResponse(ctx, cfg, kind === 'report-denied');
  }
  if (!ctx.response) {
    if (kind === 'scan') return;
    const headers = ctx.request.headers;
    headers.set('Accept-Encoding', 'identity'); headers.set('Cache-Control', 'no-cache');
    headers.delete('If-None-Match'); headers.delete('If-Modified-Since');
    return { headers };
  }
  const skipped = status => saveEvent(ctx, cfg, kind, ctx.request.url, status, { skipped: true });
  if (ctx.response.status < 200 || ctx.response.status >= 300) { skipped('http_not_2xx'); return; }
  const encoding = (ctx.response.headers.get('content-encoding') || '').trim().toLowerCase();
  if (encoding && encoding !== 'identity') { skipped('encoded_response_passthrough'); return; }
  const type = (ctx.response.headers.get('content-type') || '').toLowerCase();
  const textType = /^(?:text\/(?:html|plain)|application\/(?:json|javascript|x-javascript))(?:[;+]|$)/.test(type);
  const binaryType = /^application\/(?:x-(?:google-)?protobuf|protobuf|vnd\.google\.protobuf|grpc(?:-web(?:-text)?)?|octet-stream)(?:[;+]|$)/.test(type);
  if ((kind === 'native' && !binaryType) || (kind !== 'native' && !textType)) { skipped('unsupported_content_type'); return; }
  const charset = type.match(/charset\s*=\s*["']?([^;"'\s]+)/);
  if (textType && charset && !/^(?:utf-8|utf8|us-ascii)$/.test(charset[1])) { skipped('unsupported_charset'); return; }
  let original;
  try {
    let result;
    if (kind === 'native') {
      original = new Uint8Array(await ctx.response.arrayBuffer());
      result = rewriteNative(original, type, cfg);
    } else {
      original = await ctx.response.text();
      if (original.length > MAX_BODY) throw new LimitExceeded();
      if (kind === 'scan') {
        const candidates = discoverText(original);
        result = { body: original, candidates, hits: 0, replacements: 0, status: candidates.length ? 'collected' : 'no_skus' };
      } else {
        result = rewriteText(original, cfg);
        result.replacements = cfg.action === 'rewrite' ? result.hits : 0;
        result.status = result.replacements ? 'rewritten' : result.hits ? 'candidate_found' : 'no_source_sku';
      }
    }
    saveEvent(ctx, cfg, kind, ctx.request.url, result.status, result);
    if (!result.replacements) return { body: original };
    const headers = ctx.response.headers;
    for (const key of ['content-length', 'etag', 'content-md5', 'digest', 'content-digest']) headers.delete(key);
    return { headers, body: result.body };
  } catch (error) {
    skipped(error instanceof LimitExceeded ? 'limit_passthrough' : 'parse_failed_passthrough');
    return original !== undefined ? { body: original } : undefined;
  }
}
