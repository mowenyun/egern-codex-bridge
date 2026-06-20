// Any/fcapp unified coexist module for same-host Codex + Claude.
// Path routing:
// - /v1/responses, /v1/chat/completions => Codex-style headers
// - /v1/messages, /v1/models => Claude/auth only
// Shared behavior:
// - Keep x-api-key <-> Authorization in sync
// - Remove opposite-protocol headers on each path to avoid cross pollution
(function () {
  var headers = $request.headers || {};
  var url = $request.url || '';

  function findHeader(name) {
    var target = String(name).toLowerCase();
    var keys = Object.keys(headers);
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i]).toLowerCase() === target) return keys[i];
    }
    return null;
  }

  function getHeader(name) {
    var key = findHeader(name);
    return key ? headers[key] : undefined;
  }

  function setHeader(name, value) {
    var oldKey = findHeader(name);
    if (oldKey && oldKey !== name) delete headers[oldKey];
    headers[name] = value;
  }

  function delHeader(name) {
    var key = findHeader(name);
    if (key) delete headers[key];
  }

  function delHeaders(list) {
    for (var i = 0; i < list.length; i++) delHeader(list[i]);
  }

  function syncAuth() {
    var xApiKey = getHeader('x-api-key');
    var authorization = getHeader('authorization');

    if (authorization) {
      var auth = String(authorization).trim();
      if (auth) {
        setHeader('Authorization', /^Bearer\s+/i.test(auth) ? auth : 'Bearer ' + auth);
      }
    } else if (xApiKey) {
      var key = String(xApiKey).trim();
      if (key) {
        setHeader('Authorization', /^Bearer\s+/i.test(key) ? key : 'Bearer ' + key);
      }
    }

    var finalAuth = getHeader('authorization');
    var finalXApiKey = getHeader('x-api-key');
    if (!finalXApiKey && finalAuth) {
      var auth2 = String(finalAuth).trim();
      if (/^Bearer\s+/i.test(auth2)) {
        setHeader('x-api-key', auth2.replace(/^Bearer\s+/i, ''));
      }
    }
  }

  function randomHex(n) {
    var s = '';
    var dict = '0123456789abcdef';
    for (var i = 0; i < n; i++) s += dict.charAt(Math.floor(Math.random() * 16));
    return s;
  }

  function pseudoId() {
    return randomHex(8) + '-' + randomHex(4) + '-' + randomHex(4) + '-' + randomHex(4) + '-' + randomHex(12);
  }

  function isCodexPath(u) {
    return /\/v1\/(responses|chat\/completions)(?:\?|$)/i.test(u);
  }

  function isClaudePath(u) {
    return /\/v1\/(messages|models)(?:\?|$)/i.test(u);
  }

  syncAuth();

  if (isCodexPath(url)) {
    delHeaders([
      'anthropic-version',
      'anthropic-beta',
      'anthropic-dangerous-direct-browser-access',
      'x-app'
    ]);
    delHeaders([
      'accept-language',
      'priority'
    ]);

    setHeader('User-Agent', 'codex-tui/0.141.0 (iOS 27.0; aarch64) xterm-256color');
    setHeader('originator', 'codex-tui');
    setHeader('x-codex-beta-features', 'remote_compaction_v2');

    var sid = getHeader('session-id') || pseudoId();
    setHeader('session-id', sid);
    setHeader('thread-id', getHeader('thread-id') || sid);
    if (!getHeader('x-client-request-id')) setHeader('x-client-request-id', sid);
  }

  if (isClaudePath(url)) {
    delHeaders([
      'originator',
      'x-codex-beta-features',
      'session-id',
      'thread-id',
      'x-codex-window-id',
      'x-codex-turn-metadata',
      'x-client-request-id'
    ]);
  }

  $done({ url: url, headers: headers });
})();
