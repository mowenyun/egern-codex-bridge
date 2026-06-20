// SharedChat Codex Bridge for Egern
// 原生 Minis 工具版：保留 Minis 原始 tools（shell_execute/file_read/...），不再替换成 Codex 工具。
// 只做：路径 /codex/responses、codex-tui 头、input 多轮 schema 修复、非 message 项清洗、client_metadata 补齐。

function uuidv7Like() {
  const hex = '0123456789abcdef';
  function r(n) { let s=''; for (let i=0;i<n;i++) s += hex[Math.floor(Math.random()*16)]; return s; }
  const ms = Date.now().toString(16).padStart(12, '0');
  return `${ms.slice(0,8)}-${ms.slice(8,12)}-7${r(3)}-${'89ab'[Math.floor(Math.random()*4)]}${r(3)}-${r(12)}`;
}

function ensureArray(v) { return Array.isArray(v) ? v : []; }
function extractText(x) {
  if (typeof x === 'string') return x;
  if (!x || typeof x !== 'object') return '';
  return x.text || x.content || x.refusal || x.output || x.summary_text || '';
}
function flattenSummary(summary) {
  if (typeof summary === 'string') return summary;
  if (!Array.isArray(summary)) return '';
  return summary.map(s => typeof s === 'string' ? s : (s && (s.text || s.summary_text || s.content)) || '').filter(Boolean).join('\n');
}
function roleContentType(role, origType) {
  if (role === 'assistant') return origType === 'refusal' ? 'refusal' : 'output_text';
  return 'input_text';
}
function normalizeContent(role, content) {
  const arr = Array.isArray(content) ? content : [content];
  const out = [];
  for (const c of arr) {
    const type = roleContentType(role, c && c.type);
    const text = extractText(c);
    if (type === 'refusal') out.push({ type: 'refusal', refusal: text });
    else out.push({ type, text });
  }
  return out.length ? out : [{ type: role === 'assistant' ? 'output_text' : 'input_text', text: '' }];
}
function toMessage(role, text) {
  return { type: 'message', role, content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text: text || '' }] };
}
function normalizeInputItem(item) {
  if (!item || typeof item !== 'object') return toMessage('user', extractText(item));
  const itemType = item.type;
  const role = item.role;
  if (!itemType || itemType === 'message' || role || item.content) {
    const finalRole = role || 'user';
    return { type: 'message', role: finalRole, content: normalizeContent(finalRole, item.content) };
  }
  if (itemType === 'reasoning') {
    return toMessage('assistant', flattenSummary(item.summary) || extractText(item) || '[reasoning]');
  }
  if (itemType === 'function_call' || itemType === 'tool_call' || itemType === 'computer_call' || itemType === 'web_search_call') {
    const name = item.name || item.tool_name || itemType;
    const args = item.arguments || item.input || '';
    return toMessage('assistant', `[${itemType}:${name}] ${typeof args === 'string' ? args : JSON.stringify(args)}`);
  }
  if (itemType === 'function_call_output' || itemType === 'tool_result' || itemType === 'computer_call_output' || itemType === 'web_search_result') {
    const text = extractText(item.output) || extractText(item.content) || extractText(item) || `[${itemType}]`;
    return toMessage('user', text);
  }
  return toMessage('user', extractText(item) || `[${itemType || 'unknown'}]`);
}
function normalizeInput(messagesOrInput) {
  return ensureArray(messagesOrInput).map(normalizeInputItem).filter(Boolean);
}

function minimalInstructions(original) {
  // 保留原 instructions，避免破坏 Minis 工具提示；但如果过长也不裁剪，交给上游处理
  return original.instructions || 'You are a helpful AI assistant. Use the provided tools when necessary.';
}

function normalizeTools(originalTools) {
  const tools = ensureArray(originalTools);
  // 保留 Minis 原生 tools，但兼容 Chat Completions / Responses 两种函数工具形态。
  return tools.map(t => {
    if (!t || typeof t !== 'object') return null;
    const x = Object.assign({}, t);

    // Chat Completions: {type:'function', function:{name,description,parameters}}
    if (x.type === 'function' && x.function && typeof x.function === 'object') {
      const f = x.function;
      x.name = x.name || f.name;
      x.description = x.description || f.description || '';
      x.parameters = x.parameters || f.parameters || { type: 'object', properties: {} };
      delete x.function;
    }

    // Responses-style custom function tool
    if (!x.type) x.type = 'function';
    if (x.type === 'function') {
      if (x.input_schema && !x.parameters) x.parameters = x.input_schema;
      delete x.input_schema;
      if (!x.name) return null;
      if (!x.description) x.description = '';
      if (!x.parameters) x.parameters = { type: 'object', properties: {} };
      if (x.strict === undefined) x.strict = false;
    }
    return x;
  }).filter(Boolean);
}

function buildCodexBody(original, ids) {
  const model = original.model || 'gpt-5.4-openai-compact';
  const reasoning = original.reasoning || { effort: 'medium' };
  const stream = original.stream !== false;
  let input = [];
  if (Array.isArray(original.input)) input = normalizeInput(original.input);
  else if (Array.isArray(original.messages)) input = normalizeInput(original.messages);
  else input = [toMessage('user', extractText(original.input || ''))];
  if (!input.length) input = [toMessage('user', '')];

  const hasDeveloper = input.some(x => x.role === 'developer');
  const hasEnv = input.some(x => JSON.stringify(x).includes('<environment_context>'));
  const out = [];
  if (!hasDeveloper) {
    out.push({ type: 'message', role: 'developer', content: [{ type: 'input_text', text: '<permissions instructions> Tool-enabled session. Use available tools when needed.' }] });
  }
  if (!hasEnv) {
    out.push({ type: 'message', role: 'user', content: [{ type: 'input_text', text: `<environment_context>\n<cwd>/</cwd>\n<shell>unknown</shell>\n<current_date>${new Date().toISOString().slice(0,10)}</current_date>\n<timezone>Asia/Shanghai</timezone>\n</environment_context>` }] });
  }
  out.push(...input);

  const turnMeta = JSON.stringify({
    installation_id: ids.installationId,
    session_id: ids.sessionId,
    thread_id: ids.sessionId,
    turn_id: ids.turnId,
    window_id: `${ids.sessionId}:0`,
    request_kind: 'turn',
    sandbox: 'none',
    turn_started_at_unix_ms: ids.turnStartedAt
  });

  const tools = normalizeTools(original.tools);
  return {
    model,
    instructions: minimalInstructions(original),
    input: out,
    tools,
    tool_choice: original.tool_choice || 'auto',
    parallel_tool_calls: original.parallel_tool_calls !== false,
    reasoning,
    store: false,
    stream,
    include: original.include || ['reasoning.encrypted_content'],
    prompt_cache_key: original.prompt_cache_key || `sharedchat-minis-tools-${Date.now()}`,
    text: original.text || { verbosity: 'low' },
    client_metadata: Object.assign({}, original.client_metadata || {}, {
      'x-codex-installation-id': ids.installationId,
      'turn_id': ids.turnId,
      'x-codex-turn-metadata': turnMeta,
      'thread_id': ids.sessionId,
      'session_id': ids.sessionId,
      'x-codex-window-id': `${ids.sessionId}:0`
    })
  };
}

(function() {
  const req = $request;
  const headers = req.headers || {};
  let url = req.url;

  const sessionId = uuidv7Like();
  const turnId = uuidv7Like();
  const installationId = uuidv7Like();
  const turnStartedAt = Date.now();

  url = url.replace(/\/v1\/chat\/completions(\?.*)?$/i, '/codex/responses$1');
  url = url.replace(/\/v1\/responses(\?.*)?$/i, '/codex/responses$1');

  ['accept-language','Accept-Language','priority','Priority','origin','Origin','referer','Referer','user-agent','User-Agent','accept','Accept'].forEach(k => delete headers[k]);

  headers['accept'] = 'text/event-stream';
  headers['content-type'] = 'application/json';
  headers['originator'] = 'codex-tui';
  headers['user-agent'] = 'codex-tui/0.141.0 (Ubuntu 24.4.0; aarch64) xterm-256color (codex-tui; 0.141.0)';
  headers['x-codex-beta-features'] = 'remote_compaction_v2';
  headers['x-client-request-id'] = sessionId;
  headers['session-id'] = sessionId;
  headers['thread-id'] = sessionId;
  headers['x-codex-window-id'] = `${sessionId}:0`;
  headers['x-codex-turn-metadata'] = JSON.stringify({
    installation_id: installationId,
    session_id: sessionId,
    thread_id: sessionId,
    turn_id: turnId,
    window_id: `${sessionId}:0`,
    request_kind: 'turn',
    sandbox: 'none',
    turn_started_at_unix_ms: turnStartedAt
  });

  let bodyObj = {};
  try { bodyObj = JSON.parse(req.body || '{}'); } catch (e) { bodyObj = {}; }
  const newBody = buildCodexBody(bodyObj, { sessionId, turnId, installationId, turnStartedAt });
  const bodyText = JSON.stringify(newBody);
  delete headers['content-length'];
  delete headers['Content-Length'];

  $done({ url, headers, body: bodyText });
})();
