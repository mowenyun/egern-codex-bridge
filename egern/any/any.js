// Any/fcapp Claude auth fix for Minis Claude mode.
// Dynamically copies x-api-key to Authorization: Bearer <key>.
// No API key is hardcoded or logged.
(function () {
  var headers = $request.headers || {};

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

  $done({ headers: headers });
})();
