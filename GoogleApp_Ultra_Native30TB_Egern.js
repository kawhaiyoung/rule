export default async function(ctx) {
  try { return await run(ctx); }
  catch (error) {
    log('unexpected_error', { error_name: String(error && error.name || 'Error') });
    return;
  }
}
// Experimental native response rewrite. No verified Apple price or Google entitlement.
// Exact source SKU and default numeric path come from the diagnostic response.
// Numeric field paths are schema-free observations; field purpose is not confirmed.
const VERSION = 4;
const OLD_SKU = 'g1.ios.30tb.ai.pro.m';
const NEW_SKU = 'g1.ios.30tb.m';
const ALLOWED_SOURCES = new Set([OLD_SKU]);
const MAX_BODY = 2 * 1024 * 1024;
const MAX_FIELDS = 50000;
const MAX_DEPTH = 48;
const MAX_CANDIDATES = 64;
const KEY = 'google-app-ultra-native30tb:v4';
const DEFAULT_FIELD_PATH = '1.11.1.11.1.18.1.2.20.1.11.1.11.1.11.1.13.1.11.1.12.1.3.4.9.4.1.2.2.1';

class Malformed extends Error {}
class LimitExceeded extends Error {}

function ascii(value) {
  return Uint8Array.from(value, c => c.charCodeAt(0));
}
const OLD_BYTES = ascii(OLD_SKU);
const NEW_BYTES = ascii(NEW_SKU);

function equal(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function productCandidate(payload) {
  if (payload.length < 8 || payload.length > 160) return null;
  let value = '';
  for (const byte of payload) {
    if (!((byte >= 48 && byte <= 57) || (byte >= 65 && byte <= 90) ||
      (byte >= 97 && byte <= 122) || byte === 45 || byte === 46 || byte === 95)) return null;
    value += String.fromCharCode(byte);
  }
  return /^(?:g\d+\.ios\.|com\.google\.one\.)/.test(value) ? value : null;
}

function emptyDiagnostics() {
  return { parsed_fields: 0, source_fields: 0, candidate_fields: 0,
    candidate_skus: [], candidates_truncated: false };
}

function rememberCandidate(diagnostics, candidate) {
  if (diagnostics.candidate_skus.some(item => item.value === candidate.value)) return;
  if (diagnostics.candidate_skus.length < MAX_CANDIDATES) diagnostics.candidate_skus.push(candidate);
  else diagnostics.candidates_truncated = true;
}

function mergeDiagnostics(into, from) {
  into.parsed_fields += from.parsed_fields;
  into.source_fields += from.source_fields;
  into.candidate_fields += from.candidate_fields;
  into.candidates_truncated ||= from.candidates_truncated;
  for (const candidate of from.candidate_skus) rememberCandidate(into, candidate);
}

function rawTargetOccurrences(data, needle = OLD_BYTES) {
  let count = 0;
  for (let i = 0; i + needle.length <= data.length; i++) {
    if (data[i] === needle[0] && equal(data.subarray(i, i + needle.length), needle)) {
      count++;
      i += needle.length - 1;
    }
  }
  return count;
}

function concat(parts) {
  const output = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function uvarint(value) {
  const bytes = [];
  do {
    const next = value % 128;
    value = Math.floor(value / 128);
    bytes.push(next | (value ? 128 : 0));
  } while (value);
  return Uint8Array.from(bytes);
}

function readU32(data, offset, end) {
  let value = 0;
  let power = 1;
  for (let i = 0; i < 5; i++) {
    if (offset >= end) throw new Malformed('truncated varint');
    const byte = data[offset++];
    if (i === 4 && byte > 15) throw new Malformed('uint32 overflow');
    value += (byte & 127) * power;
    if (!(byte & 128)) return { value, offset };
    power *= 128;
  }
  throw new Malformed('overlong uint32');
}

function skipVarint(data, offset, end) {
  for (let i = 0; i < 10; i++) {
    if (offset >= end) throw new Malformed('truncated scalar');
    const byte = data[offset++];
    if (i === 9 && byte > 1) throw new Malformed('uint64 overflow');
    if (!(byte & 128)) return offset;
  }
  throw new Malformed('overlong scalar');
}

function message(data, depth, path, state) {
  if (depth > MAX_DEPTH) throw new LimitExceeded('nesting limit');
  const parts = [];
  const hits = [];
  const diagnostics = emptyDiagnostics();
  let offset = 0;
  while (offset < data.length) {
    if (++state.fields > MAX_FIELDS) throw new LimitExceeded('field limit');
    diagnostics.parsed_fields++;
    const start = offset;
    const tag = readU32(data, offset, data.length);
    offset = tag.offset;
    const number = Math.floor(tag.value / 8);
    const wire = tag.value % 8;
    if (number === 0) throw new Malformed('zero field number');
    const fieldPath = path.concat(number);
    if (wire === 0) offset = skipVarint(data, offset, data.length);
    else if (wire === 1) offset += 8;
    else if (wire === 5) offset += 4;
    else if (wire === 2) {
      const size = readU32(data, offset, data.length);
      const payloadStart = size.offset;
      const payloadEnd = payloadStart + size.value;
      if (payloadEnd > data.length) throw new Malformed('truncated length-delimited field');
      const payload = data.subarray(payloadStart, payloadEnd);
      const candidate = productCandidate(payload);
      if (candidate) {
        diagnostics.candidate_fields++;
        rememberCandidate(diagnostics, { path: fieldPath.join('.'), value: candidate });
      }
      let next = payload;
      let nestedHits = [];
      if (equal(payload, state.sourceBytes)) {
        diagnostics.source_fields++;
        const dotted = fieldPath.join('.');
        if (!state.paths || state.paths.has(dotted)) {
          next = NEW_BYTES;
          nestedHits = [dotted];
        }
      } else if (payload.length) {
        try {
          const nested = message(payload, depth + 1, fieldPath, state);
          mergeDiagnostics(diagnostics, nested.diagnostics);
          next = nested.bytes;
          nestedHits = nested.hits;
        } catch (error) {
          // LEN can also contain opaque bytes, strings or packed scalars.
          if (!(error instanceof Malformed)) throw error;
        }
      }
      if (nestedHits.length) {
        parts.push(data.subarray(start, tag.offset), uvarint(next.length), next);
        hits.push(...nestedHits);
      } else {
        parts.push(data.subarray(start, payloadEnd));
      }
      offset = payloadEnd;
      continue;
    } else {
      // Deprecated groups and unknown wire types are left unmodified.
      throw new Malformed('unsupported wire type');
    }
    if (offset > data.length) throw new Malformed('truncated fixed-width field');
    parts.push(data.subarray(start, offset));
  }
  return { bytes: hits.length ? concat(parts) : data, hits, diagnostics };
}

// Exported only for reproducible offline verification; no external dependencies.
function patchProtobuf(data, allowedPaths = null, sourceSku = OLD_SKU) {
  if (!ALLOWED_SOURCES.has(sourceSku)) throw new RangeError('unsupported source SKU');
  if (!(data instanceof Uint8Array) || data.length > MAX_BODY) {
    throw new LimitExceeded('body size or type');
  }
  return message(data, 0, [], { fields: 0, paths: allowedPaths, sourceBytes: ascii(sourceSku) });
}

function patchPayload(data, contentType, allowedPaths = null, sourceSku = OLD_SKU) {
  if (!ALLOWED_SOURCES.has(sourceSku)) throw new RangeError('unsupported source SKU');
  if (data.length > MAX_BODY) throw new LimitExceeded('body size');
  if (contentType.includes('grpc-web-text')) throw new Malformed('base64 grpc-web unsupported');
  if (!/^application\/grpc(?:[;+\-]|$)/i.test(contentType)) {
    return patchProtobuf(data, allowedPaths, sourceSku);
  }
  const parts = [];
  const hits = [];
  const diagnostics = emptyDiagnostics();
  let offset = 0;
  while (offset < data.length) {
    if (offset + 5 > data.length) throw new Malformed('truncated grpc header');
    const flag = data[offset];
    const length = new DataView(data.buffer, data.byteOffset + offset + 1, 4).getUint32(0, false);
    const end = offset + 5 + length;
    if (end > data.length) throw new Malformed('truncated grpc frame');
    if (flag === 128 && contentType.includes('grpc-web')) {
      parts.push(data.subarray(offset, end));
    } else {
      if (flag !== 0) throw new Malformed('compressed or unknown grpc frame');
      const changed = patchProtobuf(data.subarray(offset + 5, end), allowedPaths, sourceSku);
      mergeDiagnostics(diagnostics, changed.diagnostics);
      if (changed.hits.length) {
        const header = new Uint8Array(5);
        new DataView(header.buffer).setUint32(1, changed.bytes.length, false);
        parts.push(header, changed.bytes);
        hits.push(...changed.hits);
      } else {
        parts.push(data.subarray(offset, end));
      }
    }
    offset = end;
  }
  return { bytes: hits.length ? concat(parts) : data, hits, diagnostics };
}


function isTarget(request) {
  return !!request && String(request.method || '').toUpperCase() === 'POST' &&
    /^https:\/\/subscriptionsmobile-pa\.googleapis\.com(?::443)?\/(?:[^?#]*\/)?GetDynamicStorefrontInfo(?:\?[^#]*)?$/.test(String(request.url || ''));
}

function parsePaths(value) {
  const text = String(value || '').trim() || DEFAULT_FIELD_PATH;
  const parts = text.split(',').map(value => value.trim());
  if (parts.length > 8 || !parts.every(path => path.length < 512 && /^[1-9]\d*(?:\.[1-9]\d*)*$/.test(path))) {
    throw new RangeError('invalid field paths');
  }
  return new Set(parts);
}

function log(stage, details = {}) {
  try {
    if (typeof console !== 'undefined' && typeof console.log === 'function') {
      console.log('[ultra_native4] ' + JSON.stringify({ version: VERSION, stage, ...details }));
    }
  } catch {}
}

function last(ctx) {
  try { return ctx.storage.getJSON(KEY); } catch { return null; }
}

function reportText(record) {
  if (!record) return 'Ultra 原生30TB · 实验4\n尚无原生响应记录';
  const detail = record.diagnostics;
  return [
    'Ultra 原生30TB · 实验4',
    '仅更改指定数字路径中的完整商品编号；字段语义仍需核对。',
    '状态: ' + record.status + '; 模式: ' + record.mode,
    '源编号: ' + OLD_SKU,
    '目标编号: ' + NEW_SKU,
    '原文源编号字节出现: ' + (record.raw_source_before || 0),
    '处理后剩余源编号字节: ' + (record.raw_source_after || 0) + '（未选中的路径保持原样）',
    '可解析源字段: ' + (detail && detail.source_fields || 0),
    '选定路径匹配: ' + (record.selected_matches || 0),
    '实际替换: ' + (record.replacements || 0),
    '配置路径: ' + (record.configured_paths || []).join(', '),
    '命中路径: ' + (record.paths || []).join(', '),
    '正文长度: ' + (record.body_before || 0) + ' → ' + (record.body_after || record.body_before || 0),
    ...(detail ? ['候选字段: ' + detail.candidate_fields +
      '; 去重: ' + detail.candidate_skus.length + '; 收录截断: ' + (detail.candidates_truncated ? '是' : '否'),
      ...detail.candidate_skus.map(item => item.path + ': ' + item.value)] : []),
    'rewritten只证明已构造本地响应，不证明Apple报价、购买或Ultra权益。',
  ].join('\n');
}

function notify(ctx, record) {
  try {
    ctx.notify({ title: 'Ultra 原生30TB · 实验4',
      body: record.status + '; 模式 ' + record.mode +
        '; 源字段 ' + (record.diagnostics && record.diagnostics.source_fields || 0) +
        '; 指定路径匹配 ' + (record.selected_matches || 0) +
        '; 实际替换 ' + (record.replacements || 0) + '; 点击复制报告',
      sound: false, action: { type: 'clipboard', text: reportText(record) } });
  } catch (error) { log('notify_failed', { error_name: String(error && error.name || 'Error') }); }
}

function report(ctx, record) {
  const summary = { version: VERSION, time: new Date().toISOString(), ...record };
  log('result', summary);
  try { ctx.storage.setJSON(KEY, summary); } catch {}
  if (String(ctx.env && ctx.env.NOTIFY || 'true') === 'true') notify(ctx, summary);
}

async function run(ctx) {
  log('entry', { has_request: !!(ctx && ctx.request), has_response: !!(ctx && ctx.response),
    egern_version: String(ctx && ctx.app && ctx.app.version || 'unknown') });
  if (!ctx || typeof ctx !== 'object') return;
  if (!ctx.request) {
    const record = last(ctx);
    if (record) notify(ctx, record);
    return { type: 'widget', padding: 12, children: [
      { type: 'text', text: 'Ultra 原生30TB · 实验4' },
      { type: 'text', text: record ? record.status : '尚无原生响应记录' },
    ] };
  }
  if (!isTarget(ctx.request)) return;
  if (!ctx.response) {
    const headers = ctx.request.headers;
    headers.set('Accept-Encoding', 'identity');
    headers.set('Cache-Control', 'no-cache');
    headers.delete('If-None-Match');
    headers.delete('If-Modified-Since');
    log('request_seen');
    return { headers };
  }
  const mode = String(ctx.env && ctx.env.MODE || 'rewrite');
  const status = (value, extra = {}) => report(ctx, { mode, status: value,
    source_sku: OLD_SKU, target_sku: NEW_SKU, ...extra });
  if (mode !== 'rewrite' && mode !== 'inspect') { status('invalid_mode'); return; }
  let paths;
  try { paths = parsePaths(ctx.env && ctx.env.FIELD_PATHS); }
  catch { status('invalid_field_paths'); return; }
  if (ctx.response.status < 200 || ctx.response.status >= 300) { status('http_not_2xx'); return; }
  const encoding = (ctx.response.headers.get('content-encoding') || '').trim().toLowerCase();
  if (encoding && encoding !== 'identity') { status('encoded_response_passthrough'); return; }
  const contentType = (ctx.response.headers.get('content-type') || '').toLowerCase();
  if (!/^application\/(?:x-(?:google-)?protobuf|protobuf|vnd\.google\.protobuf|grpc(?:-web(?:-text)?)?|octet-stream)(?:[;+]|$)/.test(contentType)) {
    status('unsupported_content_type'); return;
  }
  let original;
  try {
    original = new Uint8Array(await ctx.response.arrayBuffer());
    const result = patchPayload(original, contentType, paths);
    const changed = mode === 'rewrite' && result.hits.length > 0;
    status(changed ? 'rewritten' : result.hits.length ? 'candidate_found' :
      result.diagnostics.source_fields ? 'path_not_matched' : 'no_source_sku', {
      selected_matches: result.hits.length, replacements: changed ? result.hits.length : 0,
      configured_paths: [...paths], paths: [...new Set(result.hits)].slice(0, 12),
      raw_source_before: rawTargetOccurrences(original),
      raw_source_after: changed ? rawTargetOccurrences(result.bytes) : rawTargetOccurrences(original),
      body_before: original.length, body_after: changed ? result.bytes.length : original.length,
      diagnostics: result.diagnostics,
    });
    if (!changed) return { body: original };
    const headers = ctx.response.headers;
    for (const name of ['content-length', 'etag', 'content-md5', 'digest', 'content-digest']) headers.delete(name);
    return { headers, body: result.bytes };
  } catch (error) {
    status(error instanceof LimitExceeded ? 'limit_passthrough' : 'parse_failed_passthrough');
    return original ? { body: original } : undefined;
  }
}

