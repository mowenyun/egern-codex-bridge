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
function stringifyValue(v, fallback) {
  if (typeof v === 'string') return v;
  if (v === undefined || v === null) return fallback || '';
  try { return JSON.stringify(v); } catch (e) { return String(v); }
}
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
function pushTextBlock(out, role, c) {
  const type = roleContentType(role, c && c.type);
  const text = extractText(c);
  if (!text) return;
  if (type === 'refusal') out.push({ type: 'refusal', refusal: text });
  else out.push({ type, text });
}
function normalizeToolOutput(output) {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) {
    return output.map(part => {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') return '';
      if (Array.isArray(part.content)) return normalizeToolOutput(part.content);
      return extractText(part) || stringifyValue(part, '');
    }).filter(Boolean).join('\n');
  }
  if (!output || typeof output !== 'object') return extractText(output);
  if (Array.isArray(output.content)) return normalizeToolOutput(output.content);
  return extractText(output) || stringifyValue(output, '');
}
function toMessage(role, text) {
  return { type: 'message', role, content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text: text || '' }] };
}
function normalizeRoleContent(role, content) {
  const arr = Array.isArray(content) ? content : [content];
  const out = [];
  let textBlocks = [];
  function flushText() {
    if (!textBlocks.length) return;
    out.push({ type: 'message', role, content: textBlocks });
    textBlocks = [];
  }
  for (const c of arr) {
    if (role === 'assistant' && c && typeof c === 'object' && (c.type === 'tool_use' || c.type === 'server_tool_use')) {
      flushText();
      out.push({
        type: 'function_call',
        call_id: c.id || c.tool_use_id || uuidv7Like(),
        name: c.name || c.tool_name || 'tool',
        arguments: stringifyValue(c.input !== undefined ? c.input : c.arguments, '{}')
      });
      continue;
    }
    if (role === 'user' && c && typeof c === 'object' && (c.type === 'tool_result' || c.type === 'server_tool_result')) {
      flushText();
      out.push({
        type: 'function_call_output',
        call_id: c.tool_use_id || c.call_id || c.id || uuidv7Like(),
        output: normalizeToolOutput(c.output !== undefined ? c.output : c.content)
      });
      continue;
    }
    pushTextBlock(textBlocks, role, c);
  }
  flushText();
  return out.length ? out : [toMessage(role, '')];
}
function normalizeInputItem(item) {
  if (!item || typeof item !== 'object') return [toMessage('user', extractText(item))];
  const itemType = item.type;
  const role = item.role;

  // Chat Completions history: assistant tool_calls + tool messages
  if (role === 'assistant' && Array.isArray(item.tool_calls) && item.tool_calls.length) {
    const out = [];
    const textItems = normalizeRoleContent('assistant', item.content);
    for (const x of textItems) {
      if (x && !(x.type === 'message' && (!x.content || !x.content.length || !extractText(x.content[0])))) out.push(x);
    }
    for (const tc of item.tool_calls) {
      if (!tc || typeof tc !== 'object') continue;
      const fn = tc.function && typeof tc.function === 'object' ? tc.function : tc;
      const name = fn.name || tc.name || 'tool';
      out.push({
        type: 'function_call',
        call_id: tc.id || item.call_id || uuidv7Like(),
        name,
        arguments: stringifyValue(fn.arguments !== undefined ? fn.arguments : tc.arguments, '{}')
      });
    }
    return out.length ? out : [toMessage('assistant', '')];
  }

  if (role === 'tool') {
    return [{
      type: 'function_call_output',
      call_id: item.tool_call_id || item.call_id || item.id || uuidv7Like(),
      output: normalizeToolOutput(item.output !== undefined ? item.output : item.content)
    }];
  }

  if (itemType === 'reasoning') {
    return [toMessage('assistant', flattenSummary(item.summary) || extractText(item) || '[reasoning]')];
  }

  if (itemType === 'function_call' || itemType === 'tool_call') {
    return [{
      type: 'function_call',
      call_id: item.call_id || item.id || uuidv7Like(),
      name: item.name || item.tool_name || 'tool',
      arguments: stringifyValue(item.arguments !== undefined ? item.arguments : item.input, '{}')
    }];
  }

  if (itemType === 'function_call_output' || itemType === 'tool_result') {
    return [{
      type: 'function_call_output',
      call_id: item.call_id || item.tool_call_id || item.tool_use_id || item.id || uuidv7Like(),
      output: normalizeToolOutput(item.output !== undefined ? item.output : item.content)
    }];
  }

  if (!itemType || itemType === 'message' || role || item.content) {
    const finalRole = role || 'user';
    return normalizeRoleContent(finalRole, item.content);
  }

  return [toMessage('user', extractText(item) || `[${itemType || 'unknown'}]`)];
}
function normalizeInput(messagesOrInput) {
  const out = [];
  for (const item of ensureArray(messagesOrInput)) {
    const pieces = normalizeInputItem(item);
    for (const piece of ensureArray(pieces)) if (piece) out.push(piece);
  }
  return out;
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
    out.push({ type: 'message', role: 'developer', content: [{ type: 'input_text', text: '<permissions instructions> Tool-enabled session. Use available tools when needed. When you decide to use a tool, emit structured function calls only; never print pseudo tool syntax like [function_call:tool] or raw JSON arguments as normal assistant text.' }] });
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
