// JavaScript evaluated inside the QuickJS sandbox before every user script. It builds the
// Postman-compatible `pm` object on top of `__state` (plain JSON injected by the host) and two
// host functions: __host_log(level, message) and __host_send(requestJson, callbackId).
// Nothing here can reach Node, the filesystem or the network except through those two functions.
//
// Kept as a String.raw literal: no backticks or dollar-brace sequences may appear inside.

export const PRELUDE = String.raw`
(function () {
  'use strict';
  var S = globalThis.__state;
  var hostLog = globalThis.__host_log;
  var hostSend = globalThis.__host_send;
  delete globalThis.__state;
  delete globalThis.__host_log;
  delete globalThis.__host_send;

  var tests = [];
  var control = { nextRequestSet: false, nextRequest: null, skip: false };

  // ---------- helpers ----------
  function fmt(v) {
    if (typeof v === 'string') return v;
    if (v instanceof Error) return v.name + ': ' + v.message;
    if (v === undefined) return 'undefined';
    if (typeof v === 'function') return '[Function ' + (v.name || 'anonymous') + ']';
    try { return JSON.stringify(v, null, 2); } catch (e) { return String(v); }
  }
  function show(v) {
    if (typeof v === 'string') return "'" + v + "'";
    if (Array.isArray(v) || (v && typeof v === 'object')) { try { return JSON.stringify(v); } catch (e) { return String(v); } }
    return String(v);
  }
  function toStr(v) {
    if (v === undefined || v === null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }
  function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a === 'number' && typeof b === 'number') return a !== a && b !== b;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    var ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (var i = 0; i < ka.length; i++) if (!Object.prototype.hasOwnProperty.call(b, ka[i]) || !deepEqual(a[ka[i]], b[ka[i]])) return false;
    return true;
  }
  function typeOf(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    if (v instanceof RegExp) return 'regexp';
    if (v instanceof Date) return 'date';
    return typeof v;
  }

  globalThis.console = {
    log: function () { hostLog('log', Array.prototype.map.call(arguments, fmt).join(' ')); },
    info: function () { hostLog('info', Array.prototype.map.call(arguments, fmt).join(' ')); },
    warn: function () { hostLog('warn', Array.prototype.map.call(arguments, fmt).join(' ')); },
    error: function () { hostLog('error', Array.prototype.map.call(arguments, fmt).join(' ')); },
    debug: function () { hostLog('log', Array.prototype.map.call(arguments, fmt).join(' ')); }
  };

  // ---------- base64 (QuickJS has no atob/btoa) ----------
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  globalThis.btoa = function (input) {
    var str = String(input), out = '';
    for (var i = 0; i < str.length; i += 3) {
      var a = str.charCodeAt(i), b = str.charCodeAt(i + 1), c = str.charCodeAt(i + 2);
      if (a > 255 || b > 255 || c > 255) throw new Error('btoa: string contains characters outside of the Latin1 range');
      var n = (a << 16) | ((b || 0) << 8) | (c || 0);
      out += B64.charAt(n >> 18) + B64.charAt((n >> 12) & 63) + (i + 1 < str.length ? B64.charAt((n >> 6) & 63) : '=') + (i + 2 < str.length ? B64.charAt(n & 63) : '=');
    }
    return out;
  };
  globalThis.atob = function (input) {
    var str = String(input).replace(/=+$/, ''), out = '', bits = 0, buf = 0;
    for (var i = 0; i < str.length; i++) {
      var idx = B64.indexOf(str.charAt(i));
      if (idx < 0) throw new Error('atob: invalid character');
      buf = (buf << 6) | idx; bits += 6;
      if (bits >= 8) { bits -= 8; out += String.fromCharCode((buf >> bits) & 255); }
    }
    return out;
  };

  // ---------- assertions (chai-style subset) ----------
  function AssertionError(message) { this.name = 'AssertionError'; this.message = message; }
  AssertionError.prototype = Object.create(Error.prototype);
  AssertionError.prototype.constructor = AssertionError;

  function Assertion(obj, flags) { this._obj = obj; this._flags = flags || {}; }
  var A = Assertion.prototype;
  A._assert = function (cond, msg, negMsg) {
    var neg = !!this._flags.negate;
    var prefix = this._flags.message ? this._flags.message + ': ' : '';
    if (neg ? cond : !cond) throw new AssertionError(prefix + (neg ? negMsg : msg));
    return this;
  };
  ['to', 'be', 'been', 'is', 'that', 'which', 'and', 'has', 'have', 'with', 'at', 'of', 'same', 'but', 'does', 'still', 'also'].forEach(function (w) {
    Object.defineProperty(A, w, { get: function () { return this; } });
  });
  Object.defineProperty(A, 'not', { get: function () { this._flags.negate = !this._flags.negate; return this; } });
  Object.defineProperty(A, 'deep', { get: function () { this._flags.deep = true; return this; } });
  Object.defineProperty(A, 'nested', { get: function () { this._flags.nested = true; return this; } });
  Object.defineProperty(A, 'any', { get: function () { this._flags.any = true; return this; } });
  Object.defineProperty(A, 'all', { get: function () { this._flags.any = false; return this; } });

  function getter(name, fn) { Object.defineProperty(A, name, { get: fn }); }
  getter('ok', function () { return this._assert(!!this._obj, 'expected ' + show(this._obj) + ' to be truthy', 'expected ' + show(this._obj) + ' to be falsy'); });
  getter('true', function () { return this._assert(this._obj === true, 'expected ' + show(this._obj) + ' to be true', 'expected ' + show(this._obj) + ' not to be true'); });
  getter('false', function () { return this._assert(this._obj === false, 'expected ' + show(this._obj) + ' to be false', 'expected ' + show(this._obj) + ' not to be false'); });
  getter('null', function () { return this._assert(this._obj === null, 'expected ' + show(this._obj) + ' to be null', 'expected ' + show(this._obj) + ' not to be null'); });
  getter('undefined', function () { return this._assert(this._obj === undefined, 'expected ' + show(this._obj) + ' to be undefined', 'expected ' + show(this._obj) + ' not to be undefined'); });
  getter('NaN', function () { return this._assert(this._obj !== this._obj, 'expected ' + show(this._obj) + ' to be NaN', 'expected ' + show(this._obj) + ' not to be NaN'); });
  getter('exist', function () { return this._assert(this._obj !== null && this._obj !== undefined, 'expected ' + show(this._obj) + ' to exist', 'expected ' + show(this._obj) + ' not to exist'); });
  getter('empty', function () {
    var o = this._obj, len = typeof o === 'string' || Array.isArray(o) ? o.length : o && typeof o === 'object' ? Object.keys(o).length : -1;
    return this._assert(len === 0, 'expected ' + show(o) + ' to be empty', 'expected ' + show(o) + ' not to be empty');
  });

  A.a = A.an = function (type) {
    var t = typeOf(this._obj), want = String(type).toLowerCase();
    return this._assert(t === want, 'expected ' + show(this._obj) + ' to be a' + (/^[aeiou]/.test(want) ? 'n ' : ' ') + want, 'expected ' + show(this._obj) + ' not to be a ' + want);
  };
  A.equal = A.equals = A.eq = function (v) {
    if (this._flags.deep) return this.eql(v);
    return this._assert(this._obj === v, 'expected ' + show(this._obj) + ' to equal ' + show(v), 'expected ' + show(this._obj) + ' to not equal ' + show(v));
  };
  A.eql = A.eqls = function (v) {
    return this._assert(deepEqual(this._obj, v), 'expected ' + show(this._obj) + ' to deeply equal ' + show(v), 'expected ' + show(this._obj) + ' to not deeply equal ' + show(v));
  };
  A.include = A.includes = A.contain = A.contains = function (v) {
    var o = this._obj, ok;
    if (typeof o === 'string') ok = o.indexOf(v) >= 0;
    else if (Array.isArray(o)) ok = o.some(function (x) { return x === v || (v && typeof v === 'object' && deepEqual(x, v)); });
    else if (o && typeof o === 'object' && v && typeof v === 'object') ok = Object.keys(v).every(function (k) { return deepEqual(o[k], v[k]); });
    else ok = false;
    return this._assert(ok, 'expected ' + show(o) + ' to include ' + show(v), 'expected ' + show(o) + ' to not include ' + show(v));
  };
  A.string = function (s) { return this.include(s); };
  A.match = A.matches = function (re) {
    return this._assert(re.test(String(this._obj)), 'expected ' + show(this._obj) + ' to match ' + re, 'expected ' + show(this._obj) + ' not to match ' + re);
  };
  A.property = function (name, val) {
    var o = this._obj, has, actual;
    if ((this._flags.nested || name.indexOf('.') > 0) && !(o && Object.prototype.hasOwnProperty.call(Object(o), name))) {
      var parts = name.replace(/\[(\d+)\]/g, '.$1').split('.'), cur = o;
      has = true;
      for (var i = 0; i < parts.length; i++) {
        if (cur === null || cur === undefined || !(parts[i] in Object(cur))) { has = false; break; }
        cur = cur[parts[i]];
      }
      actual = cur;
    } else {
      has = o !== null && o !== undefined && name in Object(o);
      actual = has ? o[name] : undefined;
    }
    if (arguments.length > 1) {
      var same = this._flags.deep ? deepEqual(actual, val) : actual === val;
      this._assert(has && same, 'expected ' + show(o) + ' to have property ' + show(name) + ' of ' + show(val) + ', but got ' + show(actual), 'expected ' + show(o) + ' to not have property ' + show(name) + ' of ' + show(val));
    } else {
      this._assert(has, 'expected ' + show(o) + ' to have property ' + show(name), 'expected ' + show(o) + ' to not have property ' + show(name));
    }
    return new Assertion(actual, { negate: this._flags.negate, message: this._flags.message });
  };
  A.ownProperty = A.haveOwnProperty = function (name) {
    return this._assert(this._obj !== null && this._obj !== undefined && Object.prototype.hasOwnProperty.call(this._obj, name), 'expected ' + show(this._obj) + ' to have own property ' + show(name), 'expected ' + show(this._obj) + ' to not have own property ' + show(name));
  };
  A.lengthOf = A.length = function (n) {
    var len = this._obj === null || this._obj === undefined ? undefined : this._obj.length;
    return this._assert(len === n, 'expected ' + show(this._obj) + ' to have a length of ' + n + ' but got ' + len, 'expected ' + show(this._obj) + ' to not have a length of ' + n);
  };
  function cmp(name, test, word) {
    A[name] = function (n) {
      var v = this._obj;
      return this._assert(test(v, n), 'expected ' + show(v) + ' to be ' + word + ' ' + n, 'expected ' + show(v) + ' to not be ' + word + ' ' + n);
    };
  }
  cmp('above', function (a, b) { return a > b; }, 'above'); A.gt = A.greaterThan = A.above;
  cmp('below', function (a, b) { return a < b; }, 'below'); A.lt = A.lessThan = A.below;
  cmp('least', function (a, b) { return a >= b; }, 'at least'); A.gte = A.least;
  cmp('most', function (a, b) { return a <= b; }, 'at most'); A.lte = A.most;
  A.within = function (lo, hi) {
    return this._assert(this._obj >= lo && this._obj <= hi, 'expected ' + show(this._obj) + ' to be within ' + lo + '..' + hi, 'expected ' + show(this._obj) + ' to not be within ' + lo + '..' + hi);
  };
  A.oneOf = function (list) {
    var o = this._obj;
    return this._assert(list.some(function (x) { return x === o || deepEqual(x, o); }), 'expected ' + show(o) + ' to be one of ' + show(list), 'expected ' + show(o) + ' to not be one of ' + show(list));
  };
  A.keys = A.key = function () {
    var want = Array.isArray(arguments[0]) ? arguments[0] : Array.prototype.slice.call(arguments);
    var have = Object.keys(this._obj || {});
    var ok = this._flags.any
      ? want.some(function (k) { return have.indexOf(k) >= 0; })
      : want.every(function (k) { return have.indexOf(k) >= 0; });
    return this._assert(ok, 'expected ' + show(this._obj) + ' to have ' + (this._flags.any ? 'any of ' : 'keys ') + show(want), 'expected ' + show(this._obj) + ' to not have keys ' + show(want));
  };
  A.members = function (list) {
    var o = this._obj || [];
    var ok = o.length === list.length && list.every(function (x) { return o.some(function (y) { return deepEqual(x, y); }); });
    return this._assert(ok, 'expected ' + show(o) + ' to have the same members as ' + show(list), 'expected ' + show(o) + ' to not have the same members as ' + show(list));
  };
  A.instanceOf = A.instanceof = function (C) {
    return this._assert(this._obj instanceof C, 'expected ' + show(this._obj) + ' to be an instance of ' + (C && C.name), 'expected ' + show(this._obj) + ' to not be an instance of ' + (C && C.name));
  };
  A.satisfy = A.satisfies = function (fn) {
    return this._assert(!!fn(this._obj), 'expected ' + show(this._obj) + ' to satisfy the given function', 'expected ' + show(this._obj) + ' to not satisfy the given function');
  };
  A.throw = A.throws = function (match) {
    var threw = false, err;
    try { this._obj(); } catch (e) { threw = true; err = e; }
    var ok = threw && (!match || (match instanceof RegExp ? match.test(err && err.message) : typeof match === 'string' ? String(err && err.message).indexOf(match) >= 0 : err instanceof match));
    return this._assert(ok, 'expected function to throw' + (match ? ' ' + show(String(match)) : ''), 'expected function not to throw' + (err ? ', but it threw ' + show(err.message) : ''));
  };

  function expect(v, message) { return new Assertion(v, { message: message }); }
  expect.fail = function (msg) { throw new AssertionError(msg || 'expect.fail()'); };

  // ---------- variables ----------
  var ORDER = ['local', 'data', 'environment', 'collection', 'globals'];
  function has(m, k) { return Object.prototype.hasOwnProperty.call(m, k); }
  function lookup(k) {
    for (var i = 0; i < ORDER.length; i++) if (has(S.vars[ORDER[i]], k)) return S.vars[ORDER[i]][k];
    return undefined;
  }
  var DYNAMIC = {
    '$guid': function () { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }); },
    '$timestamp': function () { return String(Math.floor(Date.now() / 1000)); },
    '$isoTimestamp': function () { return new Date().toISOString(); },
    '$randomInt': function () { return String(Math.floor(Math.random() * 1001)); }
  };
  DYNAMIC['$randomUUID'] = DYNAMIC['$guid'];
  function replaceIn(input) {
    var out = String(input);
    for (var pass = 0; pass < 10; pass++) {
      var changed = false;
      out = out.replace(/\{\{([^{}]+?)\}\}/g, function (m, name) {
        var k = name.trim(), v = lookup(k);
        if (v === undefined && DYNAMIC[k]) v = DYNAMIC[k]();
        if (v === undefined) return m;
        changed = true;
        return v;
      });
      if (!changed) break;
    }
    return out;
  }
  function scope(name, readOnly) {
    var m = S.vars[name];
    var api = {
      get: function (k) { return has(m, k) ? m[k] : undefined; },
      has: function (k) { return has(m, k); },
      toObject: function () { return Object.assign({}, m); },
      replaceIn: replaceIn
    };
    if (!readOnly) {
      api.set = function (k, v) { m[String(k)] = toStr(v); };
      api.unset = function (k) { delete m[k]; };
      api.clear = function () { Object.keys(m).forEach(function (k) { delete m[k]; }); };
    }
    return api;
  }

  // ---------- headers ----------
  function HeaderList(list, readOnly) {
    function idx(k) { k = String(k).toLowerCase(); for (var i = 0; i < list.length; i++) if (list[i][0].toLowerCase() === k) return i; return -1; }
    function norm(a, b) { return typeof a === 'object' && a !== null ? [String(a.key), toStr(a.value)] : [String(a), toStr(b)]; }
    var api = {
      get: function (k) { var i = idx(k); return i >= 0 ? list[i][1] : undefined; },
      has: function (k, v) { var i = idx(k); return i >= 0 && (v === undefined || list[i][1] === v); },
      toObject: function () { var o = {}; list.forEach(function (h) { o[h[0]] = h[1]; }); return o; },
      all: function () { return list.map(function (h) { return { key: h[0], value: h[1] }; }); },
      each: function (fn) { list.forEach(function (h) { fn({ key: h[0], value: h[1] }); }); },
      count: function () { return list.length; }
    };
    if (!readOnly) {
      api.add = function (a, b) { list.push(norm(a, b)); };
      api.upsert = function (a, b) { var h = norm(a, b), i = idx(h[0]); if (i >= 0) list[i] = h; else list.push(h); };
      api.remove = function (k) { for (var i = list.length - 1; i >= 0; i--) if (list[i][0].toLowerCase() === String(k).toLowerCase()) list.splice(i, 1); };
    }
    return api;
  }

  // ---------- request ----------
  var R = S.request;
  var urlObj = {
    toString: function () { return R.url; },
    update: function (u) { R.url = String(u); },
    getHost: function () { var m = /^[a-z]+:\/\/([^/?#:]+)/i.exec(R.url); return m ? m[1] : ''; },
    getPath: function () { var m = /^[a-z]+:\/\/[^/?#]*([^?#]*)/i.exec(R.url); return m && m[1] ? m[1] : '/'; },
    getQueryString: function () { var q = R.url.split('#')[0].split('?')[1]; return q || ''; },
    addQueryParams: function (params) {
      var list = typeof params === 'string' ? [params] : params.map(function (p) { return encodeURIComponent(p.key) + '=' + encodeURIComponent(toStr(p.value)); });
      var parts = R.url.split('#');
      parts[0] += (parts[0].indexOf('?') >= 0 ? '&' : '?') + list.join('&');
      R.url = parts.join('#');
    }
  };
  var bodyObj = {
    get mode() { return R.body === null ? undefined : 'raw'; },
    get raw() { return R.body === null ? undefined : R.body; },
    set raw(v) { R.body = toStr(v); },
    update: function (v) { R.body = typeof v === 'object' && v !== null && 'raw' in v ? toStr(v.raw) : toStr(v); },
    toString: function () { return R.body || ''; }
  };
  var request = {
    get url() { return urlObj; },
    set url(v) { R.url = String(v); },
    get method() { return R.method; },
    set method(v) { R.method = String(v).toUpperCase(); },
    headers: HeaderList(R.headers, false),
    get body() { return R.body === null ? undefined : bodyObj; },
    set body(v) { bodyObj.update(v); },
    addHeader: function (h) { request.headers.add(h); },
    removeHeader: function (k) { request.headers.remove(k); }
  };

  // ---------- response ----------
  function makeResponse(r) {
    var headers = HeaderList(r.headers, true);
    var res = {
      code: r.code,
      status: r.status,
      responseTime: r.responseTime,
      responseSize: r.responseSize,
      headers: headers,
      text: function () { return r.body; },
      json: function () {
        try { return JSON.parse(r.body); } catch (e) { throw new Error('Response body is not valid JSON: ' + e.message); }
      }
    };
    function statusIs(lo, hi, word) {
      return function () { return new Assertion(r.code)._assert(r.code >= lo && r.code < hi, 'expected response to be ' + word + ' but got ' + r.code, 'expected response not to be ' + word); };
    }
    var be = {};
    Object.defineProperty(be, 'ok', { get: statusIs(200, 300, '2xx') });
    Object.defineProperty(be, 'success', { get: statusIs(200, 300, '2xx') });
    Object.defineProperty(be, 'redirection', { get: statusIs(300, 400, '3xx') });
    Object.defineProperty(be, 'clientError', { get: statusIs(400, 500, '4xx') });
    Object.defineProperty(be, 'serverError', { get: statusIs(500, 600, '5xx') });
    Object.defineProperty(be, 'error', { get: statusIs(400, 600, '4xx or 5xx') });
    Object.defineProperty(be, 'notFound', { get: statusIs(404, 405, '404') });
    Object.defineProperty(be, 'json', { get: function () { res.json(); } });
    var hav = {
      status: function (s) {
        var ok = typeof s === 'number' ? r.code === s : r.status === s;
        if (!ok) throw new AssertionError('expected response to have status ' + (typeof s === 'number' ? 'code ' : 'reason ') + show(s) + ' but got ' + r.code + ' ' + r.status);
      },
      header: function (k, v) {
        if (!headers.has(k)) throw new AssertionError('expected response to have header ' + show(k));
        if (arguments.length > 1 && headers.get(k) !== v) throw new AssertionError('expected header ' + show(k) + ' to be ' + show(v) + ' but got ' + show(headers.get(k)));
      },
      body: function (b) {
        if (arguments.length === 0) { if (!r.body) throw new AssertionError('expected response to have a body'); return; }
        var ok = b instanceof RegExp ? b.test(r.body) : r.body === b;
        if (!ok) throw new AssertionError('expected response body to ' + (b instanceof RegExp ? 'match ' + b : 'equal ' + show(b)));
      },
      jsonBody: function (path, val) {
        var json = res.json();
        if (path === undefined) return;
        var a = new Assertion(json, { nested: true });
        if (arguments.length > 1) a.property(path, val); else a.property(path);
      },
      responseTime: {
        below: function (ms) { if (!(r.responseTime < ms)) throw new AssertionError('expected response time ' + r.responseTime + 'ms to be below ' + ms + 'ms'); }
      }
    };
    res.to = { be: be, have: hav };
    return res;
  }

  // ---------- sendRequest ----------
  var pending = {};
  var nextId = 1;
  function sendRequest(req, cb) {
    var id = nextId++;
    var p = new Promise(function (resolve, reject) { pending[id] = { resolve: resolve, reject: reject, cb: cb }; });
    hostSend(JSON.stringify(typeof req === 'string' ? { url: req } : req), id);
    if (typeof cb === 'function') p.catch(function () {});
    return p;
  }
  globalThis.__deliver = function (id, err, resJson) {
    var p = pending[id];
    delete pending[id];
    if (!p) return;
    var res = resJson ? makeResponse(JSON.parse(resJson)) : null;
    var error = err ? new Error(err) : null;
    if (typeof p.cb === 'function') {
      try { p.cb(error, res); } catch (e) { hostLog('error', 'Error in sendRequest callback: ' + fmt(e)); }
    }
    if (error) p.reject(error); else p.resolve(res);
  };

  // ---------- tests ----------
  function test(name, fn) {
    var entry = { name: String(name), passed: true };
    tests.push(entry);
    try {
      var r = fn();
      if (r && typeof r.then === 'function') {
        r.then(null, function (e) { entry.passed = false; entry.error = e && e.message ? e.message : String(e); });
      }
    } catch (e) {
      entry.passed = false;
      entry.error = e && e.message ? e.message : String(e);
    }
    return pm;
  }
  test.skip = function (name) { hostLog('info', 'Skipped test: ' + name); return pm; };

  function setNextRequest(n) { control.nextRequestSet = true; control.nextRequest = n === null || n === undefined ? null : String(n); }

  var pm = {
    info: S.info,
    environment: scope('environment'),
    collectionVariables: scope('collection'),
    globals: scope('globals'),
    iterationData: scope('data', true),
    variables: {
      get: function (k) { return lookup(k); },
      has: function (k) { return lookup(k) !== undefined; },
      set: function (k, v) { S.vars.local[String(k)] = toStr(v); },
      unset: function (k) { delete S.vars.local[k]; },
      toObject: function () { var o = {}; for (var i = ORDER.length - 1; i >= 0; i--) Object.assign(o, S.vars[ORDER[i]]); return o; },
      replaceIn: replaceIn
    },
    request: request,
    response: S.response ? makeResponse(S.response) : undefined,
    test: test,
    expect: expect,
    sendRequest: sendRequest,
    execution: { setNextRequest: setNextRequest, skipRequest: function () { control.skip = true; } },
    setNextRequest: setNextRequest
  };
  globalThis.pm = pm;
  globalThis.postman = {
    setNextRequest: setNextRequest,
    setEnvironmentVariable: function (k, v) { pm.environment.set(k, v); },
    getEnvironmentVariable: function (k) { return pm.environment.get(k); },
    clearEnvironmentVariable: function (k) { pm.environment.unset(k); },
    setGlobalVariable: function (k, v) { pm.globals.set(k, v); },
    getGlobalVariable: function (k) { return pm.globals.get(k); },
    clearGlobalVariable: function (k) { pm.globals.unset(k); }
  };

  globalThis.__pendingCount = function () { return Object.keys(pending).length; };
  globalThis.__export = function () {
    return JSON.stringify({ vars: S.vars, request: R, tests: tests, control: control });
  };
})();
`
