// Any/fcapp auth fix for Minis Claude / same-site coexist.
// 1) Dynamically keeps x-api-key <-> Authorization in sync.
// 2) Does NOT inject Claude CLI / 1m beta headers.
// 3) Safe to coexist with same-host Codex modules because the module only matches /v1/models and /v1/messages.
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

  $done({ url: url, headers: headers });
})();
