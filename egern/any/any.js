// Any/fcapp Claude fix for Minis Claude mode.
// 1) Dynamically copies x-api-key to Authorization: Bearer <key>.
// 2) Enables Claude 1m context beta for /v1/messages.
// No API key is hardcoded or logged.
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

  function addCsvHeader(name, values) {
    var current = getHeader(name);
    var parts = [];
    if (current) {
      parts = String(current).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    }
    for (var i = 0; i < values.length; i++) {
      if (parts.indexOf(values[i]) < 0) parts.push(values[i]);
    }
    setHeader(name, parts.join(','));
  }

  var xApiKey = getHeader('x-api-key');
  var authorization = getHeader('authorization');

  if (authorization) {
    var auth = String(authorization).trim();
    if (auth && !/^Bearer\s+/i.test(auth)) {
      setHeader('Authorization', 'Bearer ' + auth);
    }
  } else if (xApiKey) {
    var key = String(xApiKey).trim();
    if (key) {
      setHeader('Authorization', /^Bearer\s+/i.test(key) ? key : 'Bearer ' + key);
    }
  }

  var finalAuth = getHeader('authorization');
  var finalXApiKey = getHeader('x-api-key');
  if (!finalXApiKey && finalAuth && /^Bearer\s+/i.test(String(finalAuth).trim())) {
    setHeader('x-api-key', String(finalAuth).trim().replace(/^Bearer\s+/i, ''));
  }

  if (/\/v1\/messages(?:\?|$)/.test(url)) {
    setHeader('anthropic-version', getHeader('anthropic-version') || '2023-06-01');
    setHeader('anthropic-dangerous-direct-browser-access', 'true');
    setHeader('x-app', getHeader('x-app') || 'cli');
    addCsvHeader('anthropic-beta', [
      'claude-code-20250219',
      'context-1m-2025-08-07',
      'interleaved-thinking-2025-05-14',
      'mid-conversation-system-2026-04-07',
      'effort-2025-11-24'
    ]);
    if (url.indexOf('?') < 0) {
      url = url + '?beta=true';
    } else if (!/[?&]beta=/.test(url)) {
      url = url + '&beta=true';
    }
  }

  $done({ url: url, headers: headers });
})();
