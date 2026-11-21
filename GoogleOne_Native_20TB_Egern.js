// Egern native script API: https://egernapp.com/zh-CN/docs/javascript-api/
// Experimental, schema-free protobuf inspection. No live Google/Apple validation.
// Diagnostics persist bounded product-code candidates and counters locally.
// No account data, complete response bodies, cookies or receipts are uploaded.
const HOST = 'subscriptionsmobile-pa.googleapis.com';
const OLD_SKU = 'g1.ios.20tb.m.v2';
const NEW_SKU = 'com.google.one.20tb.m.iog';
const MAX_BODY = 2 * 1024 * 1024;
const MAX_FIELDS = 50000;
const MAX_DEPTH = 48;
const STORAGE_KEY = 'google-one-native-20tb:last';
const DIAGNOSTIC_VERSION = 3;
const MAX_CANDIDATES = 64;

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
  return { parsed_fields: 0, target_fields: 0, candidate_fields: 0,
    candidate_skus: [], candidates_truncated: false };
}

function rememberCandidate(diagnostics, candidate) {
  if (diagnostics.candidate_skus.some(item => item.value === candidate.value)) return;
  if (diagnostics.candidate_skus.length < MAX_CANDIDATES) diagnostics.candidate_skus.push(candidate);
  else diagnostics.candidates_truncated = true;
}

function mergeDiagnostics(into, from) {
  into.parsed_fields += from.parsed_fields;
  into.target_fields += from.target_fields;
  into.candidate_fields += from.candidate_fields;
  into.candidates_truncated ||= from.candidates_truncated;
  for (const candidate of from.candidate_skus) rememberCandidate(into, candidate);
}

function rawTargetOccurrences(data) {
  let count = 0;
  for (let i = 0; i + OLD_BYTES.length <= data.length; i++) {
    if (data[i] === OLD_BYTES[0] && equal(data.subarray(i, i + OLD_BYTES.length), OLD_BYTES)) {
      count++;
      i += OLD_BYTES.length - 1;
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
      if (equal(payload, OLD_BYTES)) {
        diagnostics.target_fields++;
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
export function patchProtobuf(data, allowedPaths = null) {
  if (!(data instanceof Uint8Array) || data.length > MAX_BODY) {
    throw new LimitExceeded('body size or type');
  }
  return message(data, 0, [], { fields: 0, paths: allowedPaths });
}

export function patchPayload(data, contentType, allowedPaths = null) {
  if (data.length > MAX_BODY) throw new LimitExceeded('body size');
  if (contentType.includes('grpc-web-text')) throw new Malformed('base64 grpc-web unsupported');
  if (!/^application\/grpc(?:[;+\-]|$)/i.test(contentType)) {
    return patchProtobuf(data, allowedPaths);
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
      const changed = patchProtobuf(data.subarray(offset + 5, end), allowedPaths);
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

export function isTarget(request) {
  if (!request || request.method !== 'POST') return false;
  try {
    const url = new URL(request.url);
    return url.protocol === 'https:' && url.hostname === HOST &&
      (!url.port || url.port === '443') &&
      /\/GetDynamicStorefrontInfo$/.test(url.pathname);
  } catch {
    return false;
  }
}

function report(ctx, record) {
  // Only bounded, prefix-filtered product candidates are retained, without headers or payloads.
  const summary = { diagnostic_version: DIAGNOSTIC_VERSION,
    mode: record.mode, status: record.status, matches: record.matches || 0,
    paths: [...new Set(record.paths || [])].slice(0, 12) };
  if (record.diagnostics) summary.diagnostics = record.diagnostics;
  const fingerprint = JSON.stringify(summary);
  let previous = null;
  try {
    previous = ctx.storage.getJSON(STORAGE_KEY);
    ctx.storage.setJSON(STORAGE_KEY, { ...summary, time: new Date().toISOString() });
  } catch {}
  const { time: previousTime, ...previousSummary } = previous || {};
  const oldFingerprint = previous ? JSON.stringify(previousSummary) : null;
  if (String(ctx.env?.NOTIFY ?? 'true') === 'true' && fingerprint !== oldFingerprint) {
    try {
      const detail = summary.diagnostics;
      const candidates = detail?.candidate_skus.slice(0, 8).map(item => item.value).join(', ');
      const reportText = [
        'Google One 原生接口 · 诊断3',
        `模式 ${summary.mode}; 状态 ${summary.status}; 匹配 ${summary.matches} 处`,
        ...(detail ? [
          `正文 ${detail.body_bytes} 字节; 目标原文 ${detail.raw_target_occurrences} 处`,
          `候选字段 ${detail.candidate_fields} 处; 已收录 ${detail.candidate_skus.length} 个不同编号; 收录截断 ${detail.candidates_truncated ? '是' : '否'}`,
          '候选商品字符串（未经商品语义或可售性验证）：',
          ...detail.candidate_skus.map(item => item.value),
        ] : []),
      ].join('\n');
      ctx.notify({ title: 'Google One 原生接口 · 诊断3',
        body: `${summary.mode}: ${summary.status}; 匹配 ${summary.matches} 处` +
          (summary.paths.length ? `; 路径 ${summary.paths.join(', ')}` : '') +
          (detail ? `; 正文 ${detail.body_bytes} 字节; 目标原文 ${detail.raw_target_occurrences} 处; 去重候选 ${candidates || '未识别'}; ` +
            `预览 ${Math.min(detail.candidate_skus.length, 8)}/${detail.candidate_skus.length}; 收录截断 ${detail.candidates_truncated ? '是' : '否'}` : '') +
          '; 点击复制报告',
        sound: false, action: { type: 'clipboard', text: reportText } });
    } catch {}
  }
}

export default async function(ctx) {
  if (!isTarget(ctx.request)) return;
  // Avoid content-coding ambiguity; if the upstream ignores identity, pass through.
  if (!ctx.response) {
    ctx.request.headers.set('Accept-Encoding', 'identity');
    return { headers: ctx.request.headers };
  }
  const mode = String(ctx.env?.MODE ?? 'inspect');
  const status = value => report(ctx, { mode, status: value });
  if (mode !== 'inspect' && mode !== 'rewrite') { status('invalid_mode'); return; }
  if (ctx.response.status < 200 || ctx.response.status >= 300) { status('http_error'); return; }
  const encoding = (ctx.response.headers.get('content-encoding') || '').trim().toLowerCase();
  if (encoding && encoding !== 'identity') { status('encoded_response_passthrough'); return; }
  const contentType = (ctx.response.headers.get('content-type') || '').toLowerCase();
  if (!/^application\/(?:x-(?:google-)?protobuf|protobuf|vnd\.google\.protobuf|grpc(?:-web(?:-text)?)?|octet-stream)(?:[;+]|$)/.test(contentType)) {
    status('unsupported_content_type'); return;
  }
  let paths = null;
  const pathText = String(ctx.env?.FIELD_PATHS ?? '').trim();
  if (pathText) {
    const list = pathText.split(',').map(value => value.trim());
    if (!list.every(value => /^[1-9]\d*(?:\.[1-9]\d*)*$/.test(value))) {
      status('invalid_field_paths'); return;
    }
    paths = new Set(list);
  }
  let original;
  try {
    original = new Uint8Array(await ctx.response.arrayBuffer());
    const result = patchPayload(original, contentType, paths);
    const changed = mode === 'rewrite' && result.hits.length > 0;
    report(ctx, { mode, status: changed ? 'rewritten' : result.hits.length ? 'candidate_found' : 'no_match',
      matches: result.hits.length, paths: result.hits,
      diagnostics: { body_bytes: original.length, raw_target_occurrences: rawTargetOccurrences(original),
        ...result.diagnostics } });
    if (!changed) return { body: original };
    const headers = ctx.response.headers;
    for (const name of ['content-length', 'etag', 'content-md5', 'digest', 'content-digest']) headers.delete(name);
    return { headers, body: result.bytes };
  } catch (error) {
    status(error instanceof LimitExceeded ? 'limit_passthrough' : 'parse_failed_passthrough');
    // Returning consumed bytes prevents an empty response after a parse failure.
    return original ? { body: original } : undefined;
  }
}
