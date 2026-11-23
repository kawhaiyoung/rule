// Egern native API: https://egernapp.com/zh-CN/docs/javascript-api/
// Diagnostic revision 2, 2026-11-23. No live purchase or entitlement validation.
// Web mappings are the two fragments already used by GoogleApp_Ultra_Web_Egern.yaml.
// Native storefront responses are INSPECTED ONLY; no schema or product semantics inferred.
// Diagnostics contain bounded product-like tokens, counts and numeric field paths.
// No HTTP calls, account identifiers, headers, receipts or full bodies are saved by this script.
export const VERSION = 2;
const MAX_BODY = 2 * 1024 * 1024;
const MAX_FIELDS = 50000;
const MAX_DEPTH = 48;
const MAX_CANDIDATES = 64;
const KEY = 'google-app-ultra-web:diagnostic-v2';
const NATIVE_HOST = 'subscriptionsmobile-pa.googleapis.com';
const TOKEN = /(?:g\d+\.(?:ios|ai)\.|com\.google\.one\.)[A-Za-z0-9_.-]+/g;
const MAPPINGS = [
  ['20tb.m.v2', '20tb.m'],
  ['30tb.ai.pro.m', '30tb.m'],
];
class Malformed extends Error {}
class LimitExceeded extends Error {}

export function endpoint(request) {
  if (!request) return null;
  try {
    const url = new URL(request.url);
    if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.hash) return null;
    const method = String(request.method || '').toUpperCase();
    if (url.hostname === 'one.google.com' && /^\/ai\/?$/.test(url.pathname) && method === 'GET') return 'web';
    if (url.hostname === NATIVE_HOST && /\/GetDynamicStorefrontInfo$/.test(url.pathname) && method === 'POST') return 'native';
  } catch {}
  return null;
}

function diagnostics() {
  return { candidate_fields: 0, candidate_skus: [], candidates_truncated: false,
    source_fields: 0, source_paths: [], legacy_fields: 0 };
}

function skuKind(value) {
  if (MAPPINGS.some(([source]) => value.endsWith('.' + source))) return 'source';
  if (MAPPINGS.some(([, target]) => value.endsWith('.' + target))) return 'legacy';
  return 'other';
}

function remember(into, value, path) {
  into.candidate_fields++;
  const kind = skuKind(value);
  if (kind === 'source') {
    into.source_fields++;
    if (into.source_paths.length < 12) into.source_paths.push(path);
  } else if (kind === 'legacy') into.legacy_fields++;
  if (into.candidate_skus.some(item => item.value === value)) return;
  if (into.candidate_skus.length < MAX_CANDIDATES) into.candidate_skus.push({ value, path });
  else into.candidates_truncated = true;
}

function merge(into, from) {
  into.candidate_fields += from.candidate_fields;
  into.source_fields += from.source_fields;
  into.legacy_fields += from.legacy_fields;
  into.source_paths.push(...from.source_paths.slice(0, Math.max(0, 12 - into.source_paths.length)));
  into.candidates_truncated ||= from.candidates_truncated;
  for (const candidate of from.candidate_skus) {
    if (into.candidate_skus.some(item => item.value === candidate.value)) continue;
    if (into.candidate_skus.length < MAX_CANDIDATES) into.candidate_skus.push(candidate);
    else into.candidates_truncated = true;
  }
}

function textDiagnostics(text) {
  const result = diagnostics();
  for (const match of text.matchAll(new RegExp(TOKEN.source, 'g'))) {
    if (match[0].length <= 160) remember(result, match[0], 'text');
  }
  return result;
}

export function patchText(text, rewrite = true) {
  if (typeof text !== 'string' || text.length > MAX_BODY) throw new LimitExceeded('text size');
  const result = textDiagnostics(text);
  let body = text;
  let replacements = 0;
  for (const [source, target] of MAPPINGS) {
    const pattern = new RegExp('(^|[^A-Za-z0-9_-])' + source.replace(/\./g, '\\.') +
      '(?![A-Za-z0-9_.-])', 'g');
    body = body.replace(pattern, (_, prefix) => {
      replacements++;
      return prefix + (rewrite ? target : source);
    });
  }
  return { body, replacements, diagnostics: result };
}

function productToken(bytes) {
  if (bytes.length < 8 || bytes.length > 160) return null;
  let value = '';
  for (const byte of bytes) {
    if (!((byte >= 48 && byte <= 57) || (byte >= 65 && byte <= 90) ||
      (byte >= 97 && byte <= 122) || byte === 45 || byte === 46 || byte === 95)) return null;
    value += String.fromCharCode(byte);
  }
  return /^(?:g\d+\.(?:ios|ai)\.|com\.google\.one\.)/.test(value) ? value : null;
}

function readU32(data, offset) {
  let value = 0;
  let power = 1;
  for (let i = 0; i < 5; i++) {
    if (offset >= data.length) throw new Malformed('truncated uint32');
    const byte = data[offset++];
    if (i === 4 && byte > 15) throw new Malformed('uint32 overflow');
    value += (byte & 127) * power;
    if (!(byte & 128)) return { value, offset };
    power *= 128;
  }
  throw new Malformed('overlong uint32');
}

function skipVarint(data, offset) {
  for (let i = 0; i < 10; i++) {
    if (offset >= data.length) throw new Malformed('truncated scalar');
    const byte = data[offset++];
    if (i === 9 && byte > 1) throw new Malformed('uint64 overflow');
    if (!(byte & 128)) return offset;
  }
  throw new Malformed('overlong scalar');
}

function inspectMessage(data, path, depth, state) {
  if (depth > MAX_DEPTH) throw new LimitExceeded('nesting limit');
  const found = diagnostics();
  let offset = 0;
  while (offset < data.length) {
    if (++state.fields > MAX_FIELDS) throw new LimitExceeded('field limit');
    const tag = readU32(data, offset);
    offset = tag.offset;
    const number = Math.floor(tag.value / 8);
    const wire = tag.value % 8;
    if (!number) throw new Malformed('zero field number');
    if (wire === 0) offset = skipVarint(data, offset);
    else if (wire === 1) offset += 8;
    else if (wire === 5) offset += 4;
    else if (wire === 2) {
      const size = readU32(data, offset);
      const end = size.offset + size.value;
      if (end > data.length) throw new Malformed('truncated length field');
      const payload = data.subarray(size.offset, end);
      const fieldPath = path.concat(number);
      const candidate = productToken(payload);
      if (candidate) remember(found, candidate, fieldPath.join('.'));
      else if (payload.length) {
        try {
          merge(found, inspectMessage(payload, fieldPath, depth + 1, state));
        } catch (error) {
          if (!(error instanceof Malformed)) throw error;
        }
      }
      offset = end;
    } else throw new Malformed('unsupported wire type');
    if (offset > data.length) throw new Malformed('truncated fixed field');
  }
  return found;
}

export function inspectPayload(bytes, contentType = '') {
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_BODY) throw new LimitExceeded('binary size');
  const type = contentType.toLowerCase();
  if (type.includes('grpc-web-text')) throw new Malformed('base64 grpc-web unsupported');
  const state = { fields: 0 };
  if (!/^application\/grpc(?:[;+\-]|$)/.test(type)) return inspectMessage(bytes, [], 0, state);
  const found = diagnostics();
  let offset = 0;
  while (offset < bytes.length) {
    if (offset + 5 > bytes.length) throw new Malformed('truncated grpc header');
    const flag = bytes[offset];
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset + 1, 4).getUint32(0, false);
    const end = offset + 5 + length;
    if (end > bytes.length) throw new Malformed('truncated grpc frame');
    if (flag === 128 && type.includes('grpc-web')) {
      // Trailer metadata is deliberately not inspected or retained.
    } else {
      if (flag !== 0) throw new Malformed('compressed grpc unsupported');
      merge(found, inspectMessage(bytes.subarray(offset + 5, end), [], 0, state));
    }
    offset = end;
  }
  return found;
}

function loadReports(ctx) {
  try { return ctx.storage.getJSON(KEY) || {}; } catch { return {}; }
}

function reportText(records) {
  const lines = ['Google App Ultra 土区升级 · 诊断2',
    '网页只替换旧模块中的商品片段；原生接口只检查。',
    'Google 页面价签、Apple 报价、Google 实际权益需要分别核对。'];
  for (const kind of ['web', 'native']) {
    const item = records[kind];
    if (!item) { lines.push(kind + ': 本脚本尚无记录'); continue; }
    lines.push('', kind + ': ' + item.status, '时间: ' + item.time,
      '模式: ' + item.mode + '; HTTP: ' + item.http_status +
      '; 类型: ' + (item.content_type || '未提供'),
      '源片段匹配: ' + (item.matches || 0) + '; 实际替换: ' + (item.replacements || 0));
    const detail = item.diagnostics;
    if (detail) {
      lines.push('候选字段: ' + detail.candidate_fields + '; 去重候选: ' +
        detail.candidate_skus.length + '; 收录截断: ' + (detail.candidates_truncated ? '是' : '否'),
        '候选商品字符串（字段语义和可售性未验证）：');
      for (const candidate of detail.candidate_skus) lines.push(candidate.path + ': ' + candidate.value);
    }
  }
  return lines.join('\n');
}

function notifyReport(ctx, records, body) {
  try {
    ctx.notify({ title: 'Google App Ultra · 诊断2', body: body + '；点击复制报告',
      sound: false, action: { type: 'clipboard', text: reportText(records) } });
  } catch {}
}

function report(ctx, kind, record) {
  const records = loadReports(ctx);
  const previous = records[kind];
  const next = { version: VERSION, endpoint: kind, time: new Date().toISOString(), ...record };
  records[kind] = next;
  try { ctx.storage.setJSON(KEY, records); } catch {}
  const { time: previousTime, ...oldSummary } = previous || {};
  const { time: nextTime, ...newSummary } = next;
  if (String(ctx.env?.NOTIFY ?? 'true') !== 'true') return;
  if (JSON.stringify(oldSummary) === JSON.stringify(newSummary) &&
    Date.now() - Date.parse(previousTime || '') < 15000) return;
  notifyReport(ctx, records, kind + ': ' + next.status + '; 匹配 ' + (next.matches || 0) +
    '; 替换 ' + (next.replacements || 0));
}

export default async function(ctx) {
  if (!ctx.request) {
    const records = loadReports(ctx);
    notifyReport(ctx, records, '最近网页及原生接口状态');
    return { type: 'widget', padding: 12, children: [
      { type: 'text', text: 'Ultra 土区升级 · 诊断2' },
      { type: 'text', text: 'web: ' + (records.web?.status || '尚无记录') },
      { type: 'text', text: 'native: ' + (records.native?.status || '尚无记录') },
    ] };
  }
  const kind = endpoint(ctx.request);
  if (!kind) return;
  if (!ctx.response) {
    const headers = ctx.request.headers;
    headers.set('Accept-Encoding', 'identity');
    headers.set('Cache-Control', 'no-cache');
    headers.delete('If-None-Match');
    headers.delete('If-Modified-Since');
    return { headers };
  }
  const mode = String(ctx.env?.MODE ?? 'rewrite');
  const contentType = (ctx.response.headers.get('content-type') || '').toLowerCase();
  const status = (value, extra = {}) => report(ctx, kind, {
    mode: kind === 'native' ? 'inspect' : mode, status: value,
    http_status: ctx.response.status,
    content_type: contentType.split(';')[0].slice(0, 80), ...extra,
  });
  if (mode !== 'rewrite' && mode !== 'inspect') { status('invalid_mode'); return; }
  if (ctx.response.status < 200 || ctx.response.status >= 300) { status('http_not_2xx'); return; }
  const encoding = (ctx.response.headers.get('content-encoding') || '').trim().toLowerCase();
  if (encoding && encoding !== 'identity') { status('encoded_response_passthrough'); return; }
  const textType = /^(?:text\/(?:html|plain)|application\/(?:json|javascript|x-javascript))(?:[;+]|$)/.test(contentType);
  const binaryType = /^application\/(?:x-(?:google-)?protobuf|protobuf|vnd\.google\.protobuf|grpc(?:-web(?:-text)?)?|octet-stream)(?:[;+]|$)/.test(contentType);
  if ((kind === 'web' && !textType) || (kind === 'native' && !textType && !binaryType)) {
    status('unsupported_content_type'); return;
  }
  const charset = contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/)?.[1];
  if (textType && charset && !/^(?:utf-8|utf8|us-ascii)$/.test(charset)) {
    status('unsupported_charset'); return;
  }
  let original;
  try {
    if (textType) {
      original = await ctx.response.text();
      if (original.length > MAX_BODY) throw new LimitExceeded('text size');
      const changed = patchText(original, kind === 'web' && mode === 'rewrite');
      const replacements = kind === 'web' && mode === 'rewrite' ? changed.replacements : 0;
      status(replacements ? 'web_rewritten' : changed.replacements ? 'source_found' :
        changed.diagnostics.legacy_fields ? 'legacy_sku_present' : 'no_source_sku', {
        matches: changed.replacements, replacements, diagnostics: changed.diagnostics,
      });
      if (!replacements) return { body: original };
      const headers = ctx.response.headers;
      for (const name of ['content-length', 'etag', 'content-md5', 'digest', 'content-digest']) headers.delete(name);
      return { headers, body: changed.body };
    }
    original = new Uint8Array(await ctx.response.arrayBuffer());
    const found = inspectPayload(original, contentType);
    status(found.source_fields ? 'native_source_found' :
      found.legacy_fields ? 'legacy_sku_present' : 'no_source_sku',
      { matches: found.source_fields, replacements: 0, diagnostics: found });
    return { body: original };
  } catch (error) {
    status(error instanceof LimitExceeded ? 'limit_passthrough' : 'parse_failed_passthrough');
    return original !== undefined ? { body: original } : undefined;
  }
}

