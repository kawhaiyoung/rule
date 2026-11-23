"""macOS JavaScriptCore checks, using a minimal documented-default-entry loader.

The JS engine is real; the Egern API bridge is a fixture. This does not run Egern,
the user's iPhone, StoreKit, or Google billing. It cannot prove the phone error's
exact cause. URL and Headers are intentionally not polyfilled.
"""
from pathlib import Path
import ctypes as c
from ctypes.util import find_library
import json

ROOT = Path(__file__).parent
lib = c.CDLL(find_library('JavaScriptCore'))
p = c.c_void_p
for name, args, result in [
    ('JSGlobalContextCreate', [p], p),
    ('JSGlobalContextRelease', [p], None),
    ('JSStringCreateWithUTF8CString', [c.c_char_p], p),
    ('JSStringRelease', [p], None),
    ('JSEvaluateScript', [p, p, p, p, c.c_int, c.POINTER(p)], p),
    ('JSValueToStringCopy', [p, p, c.POINTER(p)], p),
    ('JSStringGetMaximumUTF8CStringSize', [p], c.c_size_t),
    ('JSStringGetUTF8CString', [p, p, c.c_size_t], c.c_size_t),
]:
    fn = getattr(lib, name)
    fn.argtypes, fn.restype = args, result


class Engine:
    def __init__(self):
        self.ctx = lib.JSGlobalContextCreate(None)

    def text(self, value):
        string = lib.JSValueToStringCopy(self.ctx, value, None)
        size = lib.JSStringGetMaximumUTF8CStringSize(string)
        buffer = c.create_string_buffer(size)
        lib.JSStringGetUTF8CString(string, buffer, size)
        lib.JSStringRelease(string)
        return buffer.value.decode()

    def evaluate(self, source):
        string = lib.JSStringCreateWithUTF8CString(source.encode())
        exception = p()
        value = lib.JSEvaluateScript(self.ctx, string, None, None, 1, c.byref(exception))
        lib.JSStringRelease(string)
        if exception.value:
            raise RuntimeError(self.text(exception.value))
        return self.text(value)

    def close(self):
        lib.JSGlobalContextRelease(self.ctx)


def default_entry(source):
    old = 'export default async function(ctx)'
    assert source.count(old) == 1
    return source.replace(old, 'globalThis.__run = async function(ctx)')


fixture = r'''
var __logs = [], __notifications = [], __records = {}, __out = 'pending';
var console = {log: function(value) { __logs.push(String(value)); }};
var __body = 'g1.ios.30tb.ai.pro.m';
var __requestHeaders = {values: {}, set: function(k,v) { this.values[k] = v; }, delete: function(k) { delete this.values[k]; }};
var __ctx = {
  env: {}, app: {version: 'JSC_FIXTURE'},
  request: {url: 'https://one.google.com/ai?example=1', method: 'GET', headers: __requestHeaders},
  response: {status: 200, headers: {get: function(n) { return n === 'content-type' ? 'text/html; charset=utf-8' : null; }},
    text: function() { return Promise.resolve(__body); }},
  storage: {getJSON: function(k) { return __records[k]; }, setJSON: function(k,v) { __records[k] = v; }},
  notify: function(n) { __notifications.push(n); }
};
'''

source = (ROOT / 'GoogleApp_Ultra_Web_Egern.js').read_text()
results = []
for scenario in ['manual', 'request', 'web', 'native']:
    engine = Engine()
    try:
        globals_seen = json.loads(engine.evaluate('JSON.stringify({URL: typeof URL, Headers: typeof Headers})'))
        assert globals_seen == {'URL': 'undefined', 'Headers': 'undefined'}
        engine.evaluate(fixture + default_entry(source))
        if scenario == 'manual':
            engine.evaluate('delete __ctx.request; delete __ctx.response;')
        elif scenario == 'request':
            engine.evaluate('delete __ctx.response;')
        elif scenario == 'native':
            engine.evaluate(r'''
              __ctx.request.url = 'https://subscriptionsmobile-pa.googleapis.com/$rpc/google.internal.subscriptions.mobile.v1.SubscriptionsApiMobileService/GetDynamicStorefrontInfo?';
              __ctx.request.method = 'POST';
              __ctx.response.headers.get = function(n) { return n === 'content-type' ? 'application/x-protobuf' : null; };
              var __bytes = Uint8Array.from([10, __body.length].concat(Array.from(__body, function(x) { return x.charCodeAt(0); })));
              __ctx.response.arrayBuffer = function() { return Promise.resolve(__bytes.buffer); };
            ''')
        engine.evaluate('__run(__ctx).then(function(v) { __out = v; }, function(e) { __out = {error: String(e)}; });')
        data = json.loads(engine.evaluate('JSON.stringify({out: __out, records: __records, logs: __logs, notifications: __notifications.length})'))
        assert data['out'] != 'pending', 'Promise did not settle in the fixture engine'
        assert not any('unexpected_error' in x for x in data['logs'])
        if scenario == 'manual':
            assert data['out']['type'] == 'widget'
            assert data['notifications'] == 1
        elif scenario == 'request':
            assert data['out']['headers']['values']['Accept-Encoding'] == 'identity'
        else:
            record = data['records']['google-app-ultra-web:diagnostic-v3'][scenario]
            assert record['status'] == ('source_found' if scenario == 'web' else 'native_source_found')
            assert record['replacements'] == 0
            assert data['notifications'] == 1
            if scenario == 'web':
                assert data['out']['body'] == 'g1.ios.30tb.ai.pro.m'
            else:
                assert list(data['out']['body'].values()) == [10, len('g1.ios.30tb.ai.pro.m'), *b'g1.ios.30tb.ai.pro.m']
        results.append({'scenario': scenario, 'passed': True, 'URL_global': globals_seen['URL']})
    finally:
        engine.close()

previous = ROOT / 'diagnostic_v2.js'
compatibility_observation = None
if previous.exists():
    engine = Engine()
    try:
        try:
            engine.evaluate(default_entry(previous.read_text()))
            compatibility_observation = 'parsed'
        except RuntimeError as error:
            compatibility_observation = str(error)
    finally:
        engine.close()

report = {'engine': 'macOS JavaScriptCore', 'loader': 'minimal documented-default-entry fixture',
          'api_bridge': 'test fixture, not Egern', 'checks': results,
          'previous_script_in_this_loader': compatibility_observation,
          'phone_root_cause_confirmed': False}
(ROOT / 'javascriptcore_validation.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(report, ensure_ascii=False))
