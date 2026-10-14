'use strict';
// GLM client: one chat() call over the OpenAI-compatible route with SSE
// streaming (or plain JSON), retries with backoff, vision fallback, per-stage
// reasoning effort, <think> stripping and metrics. Also the tolerant parsers
// for model answers: extractJSON() and the tagged-block protocol parseBlocks().
// Everything the model returns is untrusted; callers still sanitize HTML/CSS.

const EFFORTS = ['low', 'high', 'max'];
const LIMIT = 5000000;
const BACKOFF = [1000, 3000];
const MAX_WAIT = 20000;
const MAX_CALLS = 100;
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
// After finish_reason, how long to wait for the usage chunk, [DONE] or the end
// of the body before keeping the finished answer (some proxies hold streams open).
const TUNING = { grace: 10000 };
const VISION = new Map(); // base\nmodel -> true (images accepted) | false (rejected)
const OWN = Symbol('forma.llm');
const MSG = {
  cancelled: 'Cancelled.',
  timeout: 'GLM request timed out. Increase GLM_TIMEOUT_MS or reduce the task.',
  network: 'Cannot reach GLM. Check the API URL, network route, and corporate CA configuration.',
  dropped: 'GLM closed the connection before the response finished.',
  http: (s) => `GLM returned HTTP ${s}. Check credentials, model ID, endpoint parameters, and service capacity.`,
  nonJSON: 'GLM returned a non-JSON HTTP response.',
  tooLarge: 'GLM response exceeded the pilot size limit.',
  noChoice: 'GLM returned no completion choice.',
  length: 'GLM hit the output limit. Increase GLM_MAX_TOKENS or request a smaller artifact.',
  empty: 'GLM returned an empty response.',
};
Object.freeze(MSG);
const VISION_NOTE = '[Images omitted: this model endpoint does not accept image input. Work from the text only.]';
const SIZE_NOTE = '[Images omitted: the request was too large with them. Work from the text only.]';
const SIZE_ERROR = /context.?(length|window)|maximum context|too many (input )?tokens|prompt is too long|request too large/i;
const fail = (code, message, extra) => Object.assign(new Error(message), { code, [OWN]: true }, extra);
const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// ---- configuration --------------------------------------------------------

function extendConfig(cfg, env = process.env) {
  const strict = cfg.mode === 'glm';
  const raw = (name) => (env[name] == null || String(env[name]).trim() === '' ? null : String(env[name]).trim());
  const bad = (message, def) => {
    if (strict) throw new Error(message);
    return def;
  };
  const words = (list) => (list.length === 2 ? list.join(' or ') : `${list.slice(0, -1).join(', ')}, or ${list.at(-1)}`);
  const flag = (name, def) => {
    const v = raw(name)?.toLowerCase();
    if (v == null) return def;
    if (['true', '1', 'yes', 'on'].includes(v)) return true;
    if (['false', '0', 'no', 'off'].includes(v)) return false;
    return bad(`${name} must be true or false.`, def);
  };
  const int = (name, def, min, max) => {
    const v = raw(name);
    if (v == null) return def;
    const n = /^\d{1,3}$/.test(v) ? Number(v) : NaN; // no hex, exponents or signs
    return n >= min && n <= max ? n : bad(`Invalid ${name}. Use a whole number from ${min} to ${max}.`, def);
  };
  const one = (name, def, list) => {
    const v = raw(name)?.toLowerCase();
    if (v == null) return def;
    return list.includes(v) ? v : bad(`${name} must be ${words(list)}.`, def);
  };
  const reasoning = EFFORTS.includes(cfg.reasoning) ? cfg.reasoning : 'high';
  const build = one('GLM_EFFORT_BUILD', reasoning, EFFORTS);
  return Object.assign(cfg, {
    stream: flag('GLM_STREAM', true),
    vision: one('GLM_VISION', 'auto', ['auto', 'on', 'off']),
    maxImages: int('GLM_MAX_IMAGES', 8, 0, 32),
    retries: int('GLM_RETRIES', 2, 0, 5),
    structured: flag('GLM_STRUCTURED_OUTPUT', false),
    jsonMode: typeof cfg.jsonMode === 'boolean' ? cfg.jsonMode : env.GLM_JSON_MODE === 'true',
    effort: {
      plan: one('GLM_EFFORT_PLAN', reasoning, EFFORTS),
      build,
      review: one('GLM_EFFORT_REVIEW', 'low', EFFORTS),
      edit: one('GLM_EFFORT_EDIT', reasoning, EFFORTS),
      repair: build,
      test: 'low',
    },
    parallel: int('GLM_PARALLEL', 3, 1, 8),
    pipeline: one('GLM_PIPELINE', 'staged', ['staged', 'single']),
  });
}

// ---- images ---------------------------------------------------------------

const isImage = (p) => plain(p) && (p.type === 'image_url' || p.type === 'image' || p.type === 'input_image');
function countImages(messages) {
  let n = 0;
  for (const m of Array.isArray(messages) ? messages : []) if (Array.isArray(m?.content)) for (const p of m.content) if (isImage(p)) n++;
  return n;
}
// Keeps the first `keep` images (in message order) and drops the rest. Inputs
// are not mutated; a message that lost images gets `note` appended once.
function dropImages(messages, keep, note) {
  if (!Array.isArray(messages)) return messages;
  let seen = 0;
  return messages.map((m) => {
    if (!Array.isArray(m?.content) || !m.content.some(isImage)) return m;
    let removed = 0;
    const content = m.content.filter((p) => !isImage(p) || seen++ < keep || (removed++, false));
    if (!removed) return m;
    if (note) content.push({ type: 'text', text: note });
    return { ...m, content: content.length ? content : '' };
  });
}
const stripImages = (messages, note) => dropImages(messages, 0, note);
const visionKey = (cfg) => `${cfg.base}\n${cfg.model}`;
const visionSupported = (cfg) => (VISION.has(visionKey(cfg)) ? VISION.get(visionKey(cfg)) : null);

// ---- request --------------------------------------------------------------

function effortFor(cfg, stage) {
  const e = cfg.effort?.[stage];
  if (EFFORTS.includes(e)) return e;
  return stage === 'review' || stage === 'test' ? 'low' : EFFORTS.includes(cfg.reasoning) ? cfg.reasoning : 'high';
}
function requestBody(cfg, messages, opts, stage, stream) {
  const wantsJSON = !!(opts.json || opts.schema);
  let format = null;
  if (opts.schema && cfg.structured)
    format = { type: 'json_schema', json_schema: { name: String(opts.schemaName || `forma_${stage}`).replace(/[^\w-]/g, '_').slice(0, 64), schema: opts.schema, strict: false } };
  else if (wantsJSON && cfg.jsonMode) format = { type: 'json_object' };
  const extra = plain(cfg.extra) ? { ...cfg.extra } : {};
  // 0.2 sent every call as JSON; a configured response_format now applies to
  // JSON calls only so tagged-block builds are not forced into JSON.
  if (!wantsJSON) delete extra.response_format;
  const body = {
    temperature: 1,
    top_p: 0.95,
    reasoning_effort: effortFor(cfg, stage),
    max_tokens: cfg.maxTokens,
    ...(format ? { response_format: format } : {}),
    ...extra,
  };
  if (opts.temperature != null) body.temperature = opts.temperature;
  if (opts.maxTokens != null) body.max_tokens = opts.maxTokens;
  if (EFFORTS.includes(opts.effort)) body.reasoning_effort = opts.effort;
  if (stream) body.stream_options = { ...(plain(extra.stream_options) ? extra.stream_options : {}), include_usage: true };
  else delete body.stream_options;
  delete body.tools;
  delete body.tool_choice;
  return { ...body, model: cfg.model, messages, stream };
}

function retryAfter(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s) * 1000);
  const at = Date.parse(s);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}
const delayFor = (e, n) => (e.retryAfter != null ? Math.min(MAX_WAIT, Math.max(0, e.retryAfter)) : BACKOFF[n - 1] ?? BACKOFF.at(-1));
function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const done = () => (signal?.removeEventListener('abort', stop), resolve());
    const stop = () => (clearTimeout(timer), reject(signal.reason));
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', stop, { once: true });
  });
}
// Runs an injected sleep but always rejects as soon as the signal aborts.
function pause(sleep, ms, signal) {
  let stop;
  const aborted = new Promise((_, reject) => {
    stop = () => reject(signal.reason);
    if (signal.aborted) stop();
    else signal.addEventListener('abort', stop, { once: true });
  });
  return Promise.race([Promise.resolve().then(() => sleep(ms, signal)), aborted]).finally(() => signal.removeEventListener('abort', stop));
}

// HTTP-style status for an error object sent in a 200 body or mid-stream. Any
// numeric code/status field wins (a string `code` such as "model_not_found"
// must not hide a numeric `status`); otherwise the text decides.
function statusOf(err) {
  if (plain(err))
    for (const v of [err.code, err.status, err.status_code, err.statusCode]) {
      const n = typeof v === 'number' || (typeof v === 'string' && /^\d{3}$/.test(v.trim())) ? Number(v) : NaN;
      if (Number.isInteger(n) && n >= 400 && n <= 599) return n;
    }
  const s = plain(err) ? `${err.type || ''} ${err.code || ''} ${typeof err.message === 'string' ? err.message : ''}` : String(err ?? '');
  if (/rate.?limit|too.?many/i.test(s)) return 429;
  if (/overload|unavailable|capacity/i.test(s)) return 503;
  if (/unauthori[sz]ed|authentication|api.?key/i.test(s)) return 401;
  if (/forbidden|permission.?denied/i.test(s)) return 403;
  if (/not.?found|does not exist/i.test(s)) return 404;
  if (/invalid|bad.?request|validation|context.?length|not support/i.test(s)) return 400;
  return 500;
}
function errorEvent(err) {
  const status = statusOf(err);
  const m = plain(err) ? err.message : err;
  let detail = typeof m === 'string' ? m : '';
  if (!detail && m != null)
    try {
      detail = JSON.stringify(m) || '';
    } catch {}
  return fail('http', MSG.http(status), { status, retryable: RETRY_STATUS.has(status), detail: detail.slice(0, 300), midStream: true });
}
const parts = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (typeof x === 'string' ? x : typeof x?.text === 'string' ? x.text : '')).join('') : '');
// Some servers send both fields with the same text; prefer reasoning_content.
const reasoningOf = (d) => (typeof d?.reasoning_content === 'string' && d.reasoning_content ? d.reasoning_content : typeof d?.reasoning === 'string' ? d.reasoning : '');

// ---- SSE ------------------------------------------------------------------

// Incremental text/event-stream parser. push() takes decoded text in any
// chunking (CR, LF or CRLF, also split across chunks); onEvent({event, data})
// returns true to stop. Only new text is scanned and partial lines are kept as
// pieces, so tiny chunks of a long line stay linear. Lines and events are
// capped at `limit` characters. An event cut off by the end of the body (no
// blank line) is still delivered, flagged `partial: true`.
function sseParser(onEvent, limit = LIMIT) {
  let pending = [],
    pendingLen = 0,
    cr = false,
    data = [],
    size = 0,
    has = false,
    event = '',
    stopped = false,
    partial = false;
  const line = (l) => {
    if (!l) {
      if (has && !stopped) stopped = !!onEvent({ event: event || 'message', data: data.join('\n'), ...(partial ? { partial } : {}) });
      data = [];
      size = 0;
      has = false;
      event = '';
      return;
    }
    if (l.charCodeAt(0) === 58) return; // ':' comment / keep-alive
    const i = l.indexOf(':');
    const field = i < 0 ? l : l.slice(0, i);
    let value = i < 0 ? '' : l.slice(i + 1);
    if (value.charCodeAt(0) === 32) value = value.slice(1);
    if (field === 'data') {
      data.push(value);
      has = true;
      if ((size += value.length) > limit) throw fail('too-large', MSG.tooLarge);
    } else if (field === 'event') event = value;
  };
  const self = {
    get stopped() {
      return stopped;
    },
    push(s) {
      let start = 0;
      for (let i = 0; i < s.length && !stopped; i++) {
        const c = s.charCodeAt(i);
        if (cr) {
          cr = false;
          if (c === 10) {
            start = i + 1;
            continue; // LF completing a CRLF split across chunks
          }
        }
        if (c !== 10 && c !== 13) continue;
        pending.push(s.slice(start, i));
        const l = pending.join('');
        pending = [];
        pendingLen = 0;
        line(l);
        if (c === 13) {
          if (i + 1 === s.length) cr = true;
          else if (s.charCodeAt(i + 1) === 10) i++;
        }
        start = i + 1;
      }
      if (stopped || start >= s.length) return;
      pending.push(s.slice(start));
      if ((pendingLen += s.length - start) > limit) throw fail('too-large', MSG.tooLarge);
    },
    end() {
      if (stopped) return;
      if (pending.length) line(pending.join(''));
      pending = [];
      partial = true;
      if (!stopped) line('');
    },
  };
  return self;
}

function onEvent(acc, { event, data, partial }, progress) {
  const d = data.trim();
  if (!d) return false;
  if (d === '[DONE]') return (acc.done = true);
  let obj;
  try {
    obj = JSON.parse(d);
  } catch {
    if (event === 'error') throw errorEvent({ message: d });
    if (event !== 'message') return false;
    // The body ended in the middle of an event: a dropped connection (a proxy
    // closing cleanly mid-line), not a server that speaks something else.
    if (partial) {
      if (acc.finishReason) return true; // only the trailing usage chunk was cut off
      throw fail('network', MSG.dropped, { retryable: true });
    }
    throw fail('http', MSG.nonJSON, { status: 200 });
  }
  if (!plain(obj)) {
    if (event === 'error') throw errorEvent({ message: d });
    return false;
  }
  const err = event === 'error' ? obj.error || obj : obj.error || (obj.object === 'error' ? obj : null);
  if (err) throw errorEvent(err);
  if (plain(obj.usage)) acc.usage = obj.usage;
  for (const c of Array.isArray(obj.choices) ? obj.choices : []) {
    if (!plain(c) || Number(c.index ?? 0) !== 0) continue;
    const delta = c.delta || c.message || {};
    acc.content += parts(delta.content);
    acc.reasoning += reasoningOf(delta);
    if (c.finish_reason) acc.finishReason = c.finish_reason;
  }
  if (acc.content.length + acc.reasoning.length > LIMIT) throw fail('too-large', MSG.tooLarge);
  progress(acc);
  return false;
}
const blank = () => ({ content: '', reasoning: '', finishReason: null, usage: null, done: false, streamed: true });
function finishSSE(acc) {
  if (!acc.done && !acc.finishReason) throw fail('network', MSG.dropped, { retryable: true });
  return acc;
}
const LATE = Symbol('late');
// reader.read(), or LATE once `ms` pass without a chunk.
function readWithin(reader, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(LATE), Math.max(0, ms));
    reader.read().then(
      (v) => (clearTimeout(timer), resolve(v)),
      (e) => (clearTimeout(timer), reject(e)),
    );
  });
}
async function readStream(res, progress) {
  const acc = blank();
  if (!res.body) return finishSSE(acc);
  const parser = sseParser((ev) => onEvent(acc, ev, progress));
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let ended = false,
    deadline = 0;
  try {
    for (;;) {
      let chunk;
      if (acc.finishReason && !deadline) deadline = Date.now() + TUNING.grace;
      try {
        chunk = deadline ? await readWithin(reader, deadline - Date.now()) : await reader.read();
      } catch (e) {
        if (acc.finishReason) break; // the answer was complete; chat() still honours a user cancel
        throw fail('network', MSG.dropped, { retryable: true, cause: e });
      }
      if (chunk === LATE) break; // finished answer, but the server never closed the stream
      if (chunk.done) {
        ended = true;
        parser.push(decoder.decode());
        parser.end();
        break;
      }
      parser.push(decoder.decode(chunk.value, { stream: true }));
      if (parser.stopped) break;
    }
  } finally {
    if (!ended) reader.cancel().catch(() => {});
  }
  return finishSSE(acc);
}
async function readText(res, limit) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    let chunk;
    try {
      chunk = await reader.read();
    } catch (e) {
      throw fail('network', MSG.dropped, { retryable: true, cause: e });
    }
    if (chunk.done) return text + decoder.decode();
    text += decoder.decode(chunk.value, { stream: true });
    if (text.length > limit) {
      reader.cancel().catch(() => {});
      throw fail('too-large', MSG.tooLarge);
    }
  }
}
async function readJSON(res, progress) {
  const raw = await readText(res, LIMIT);
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    // A proxy may strip the event-stream content type; parse SSE text anyway.
    if (/^\s*(?::|data:|event:|id:|retry:)/.test(raw)) {
      const acc = blank();
      const parser = sseParser((ev) => onEvent(acc, ev, progress));
      parser.push(raw);
      parser.end();
      return finishSSE(acc);
    }
    throw fail('http', MSG.nonJSON, { status: res.status });
  }
  const err = plain(data) && (data.error || (data.object === 'error' ? data : null));
  if (err && !Array.isArray(data.choices)) throw errorEvent(err);
  const choice = plain(data) && Array.isArray(data.choices) ? data.choices[0] : null;
  if (!plain(choice)) throw fail('empty', MSG.noChoice);
  const msg = choice.message || choice.delta || {};
  const acc = { content: parts(msg.content), reasoning: reasoningOf(msg), finishReason: choice.finish_reason || null, usage: plain(data.usage) ? data.usage : null, done: true, streamed: false };
  progress(acc);
  return acc;
}
// The first `max` characters of an error body (the rest is never downloaded).
async function readCapped(res, max) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return (text + decoder.decode()).slice(0, max);
      text += decoder.decode(chunk.value, { stream: true });
      if (text.length >= max) return text.slice(0, max);
    }
  } catch {
    return text.slice(0, max);
  } finally {
    reader.cancel().catch(() => {});
  }
}

async function attempt(cfg, body, signal, progress) {
  let url;
  try {
    url = new URL(String(cfg.base).replace(/\/$/, '') + '/chat/completions');
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol');
  } catch (e) {
    throw fail('network', MSG.network, { cause: e }); // a bad URL never heals: no retry
  }
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        Accept: body.stream ? 'text/event-stream, application/json' : 'application/json',
        ...(cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    throw fail('network', MSG.network, { retryable: true, cause: e });
  }
  if (!res.ok) {
    const detail = (await readCapped(res, 300)).trim();
    throw fail('http', MSG.http(res.status), { status: res.status, retryable: RETRY_STATUS.has(res.status), retryAfter: retryAfter(res.headers.get('retry-after')), detail });
  }
  return /text\/event-stream/i.test(res.headers.get('content-type') || '') ? readStream(res, progress) : readJSON(res, progress);
}

function tokens(u) {
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  return {
    inputTokens: n(u?.prompt_tokens ?? u?.input_tokens),
    outputTokens: n(u?.completion_tokens ?? u?.output_tokens),
    reasoningTokens: n(u?.completion_tokens_details?.reasoning_tokens ?? u?.output_tokens_details?.reasoning_tokens ?? u?.reasoning_tokens),
  };
}
function throttle(fn, stage) {
  let last = -Infinity;
  return (acc) => {
    if (typeof fn !== 'function' || !(acc.content.length + acc.reasoning.length)) return;
    const now = Date.now();
    if (now - last < 250) return;
    last = now;
    try {
      fn({ stage, contentChars: acc.content.length, reasoningChars: acc.reasoning.length });
    } catch {}
  };
}

// chat(cfg, messages, { signal, metrics, stage, effort, json, schema, schemaName,
//   maxTokens, temperature, onDelta, stream, sleep }) ->
//   { text, reasoning, finishReason, usage: { inputTokens, outputTokens, reasoningTokens }, imagesDropped, retries }
async function chat(cfg, messages, opts = {}) {
  const started = Date.now();
  const stage = opts.stage || 'build';
  const metrics = opts.metrics;
  const user = opts.signal;
  const timer = AbortSignal.timeout(Number(cfg.timeout) > 0 ? Number(cfg.timeout) : 240000);
  const signal = user ? AbortSignal.any([user, timer]) : timer;
  const stream = opts.stream ?? cfg.stream ?? true;
  const vision = cfg.vision || 'auto';
  const key = visionKey(cfg);
  const limit = Number.isInteger(cfg.retries) ? cfg.retries : 2;
  const max = Number.isInteger(cfg.maxImages) ? cfg.maxImages : 8;
  const progress = throttle(opts.onDelta, stage);
  const classify = (e) =>
    user?.aborted ? fail('cancelled', MSG.cancelled) : timer.aborted ? fail('timeout', MSG.timeout) : e?.[OWN] ? e : fail('network', MSG.network, { cause: e });
  let msgs = messages,
    dropped = 0,
    retries = 0,
    fellBack = false,
    usage = null;
  const total = countImages(msgs);
  if (total && (vision === 'off' || (vision === 'auto' && VISION.get(key) === false))) {
    msgs = stripImages(msgs, VISION_NOTE);
    dropped = total;
  } else if (total > max) {
    msgs = dropImages(msgs, max, `[${total - max} image${total - max === 1 ? '' : 's'} omitted: at most ${max} images per request.]`);
    dropped = total - max;
  }
  const record = (error) => {
    if (!metrics) return;
    if (!Array.isArray(metrics.calls)) metrics.calls = [];
    if (metrics.calls.length >= MAX_CALLS) return;
    metrics.calls.push({ stage, ms: Date.now() - started, inputTokens: usage?.inputTokens || 0, outputTokens: usage?.outputTokens || 0, reasoningTokens: usage?.reasoningTokens || 0, retries, imagesDropped: dropped, ...(error ? { error } : {}) });
  };
  try {
    let raw;
    for (;;) {
      if (signal.aborted) throw classify();
      const images = countImages(msgs);
      try {
        raw = await attempt(cfg, requestBody(cfg, msgs, opts, stage, stream), signal, progress);
        // Remember vision support only from a completed response: a 200 status
        // can still be followed by a mid-stream "images not supported" error.
        if (images && !VISION.has(key)) VISION.set(key, true);
        if (fellBack === 'vision' && !images && VISION.get(key) !== true) VISION.set(key, false);
        break;
      } catch (e0) {
        const e = classify(e0);
        if (e.code === 'cancelled' || e.code === 'timeout') throw e;
        if (e.code === 'http' && e.status === 400 && images && vision === 'auto' && !fellBack) {
          // A context-length 400 says nothing about image support: retry
          // without images but do not disable vision for the process.
          const size = SIZE_ERROR.test(e.detail || '');
          msgs = stripImages(msgs, size ? SIZE_NOTE : VISION_NOTE);
          dropped += images;
          fellBack = size ? 'size' : 'vision';
          continue;
        }
        if (!e.retryable || retries >= limit) throw e;
        retries++;
        try {
          await pause(opts.sleep || wait, delayFor(e, retries), signal);
        } catch (s) {
          throw classify(s);
        }
      }
    }
    if (user?.aborted) throw classify();
    usage = tokens(raw.usage);
    if (metrics) {
      metrics.modelCalls = (metrics.modelCalls || 0) + 1;
      metrics.inputTokens = (metrics.inputTokens || 0) + usage.inputTokens;
      metrics.outputTokens = (metrics.outputTokens || 0) + usage.outputTokens;
      metrics.reasoningTokens = (metrics.reasoningTokens || 0) + usage.reasoningTokens;
    }
    const split = splitThinking(raw.content);
    const reasoning = [raw.reasoning, split.thinking].filter(Boolean).join('\n\n');
    const result = { text: split.text, reasoning, finishReason: raw.finishReason || null, usage, imagesDropped: dropped, retries };
    if (raw.finishReason === 'length') throw fail('length', MSG.length, { partial: split.text, reasoning });
    if (!split.text.trim()) throw fail('empty', MSG.empty, { reasoning });
    record();
    return result;
  } catch (e0) {
    // Errors raised above are already classified; a length or empty answer
    // that completed just before the timer fired must not become a timeout.
    const e = e0?.[OWN] ? e0 : classify(e0);
    if (e.code !== 'cancelled') record(e.code);
    throw e;
  }
}

// ---- thinking -------------------------------------------------------------

const THINK_OPEN = /<(?:think|thinking)(?=[\s>])[^<>]{0,200}>/gi;
const THINK_CLOSE = /<\/(?:think|thinking)\s*>/gi;
// Separates leaked reasoning from the answer: <think>…</think> pairs anywhere,
// a leading block whose opening tag was in the prompt ("…</think>answer") and
// a leading block that never closed (truncated reasoning, no answer).
function splitThinking(text) {
  if (typeof text !== 'string') return { text: '', thinking: '' };
  if (!/<\/?think/i.test(text)) return { text, thinking: '' };
  const thinking = [];
  let t = text;
  THINK_OPEN.lastIndex = THINK_CLOSE.lastIndex = 0;
  const o = THINK_OPEN.exec(t),
    c = THINK_CLOSE.exec(t);
  if (c && (!o || c.index < o.index)) {
    thinking.push(t.slice(0, c.index));
    t = t.slice(c.index + c[0].length);
  }
  let out = '',
    i = 0;
  for (;;) {
    THINK_OPEN.lastIndex = i;
    const a = THINK_OPEN.exec(t);
    if (!a) {
      out += t.slice(i);
      break;
    }
    THINK_CLOSE.lastIndex = a.index + a[0].length;
    const b = THINK_CLOSE.exec(t);
    if (!b) {
      if ((out + t.slice(i, a.index)).trim()) out += t.slice(i);
      else thinking.push(t.slice(a.index + a[0].length));
      break;
    }
    out += t.slice(i, a.index);
    thinking.push(t.slice(a.index + a[0].length, b.index));
    i = b.index + b[0].length;
  }
  return { text: out.trim(), thinking: thinking.map((s) => s.trim()).filter(Boolean).join('\n\n') };
}
const stripThinking = (text) => splitThinking(text).text;

// ---- JSON -----------------------------------------------------------------

const CTRL = { '\n': '\\n', '\r': '\\r', '\t': '\\t', '\b': '\\b', '\f': '\\f' };
// Repairs two common model slips: commas directly before } or ] (outside
// strings) and raw control characters such as newlines inside strings.
function dropTrailingCommas(s) {
  const out = [];
  let str = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (str) {
      if (c === '\\') out.push(c, s[++i] ?? '');
      else if (c < ' ') out.push(CTRL[c] || `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
      else {
        if (c === '"') str = false;
        out.push(c);
      }
      continue;
    }
    if (c === '"') str = true;
    else if (c === ',') {
      let j = i + 1;
      while (j < s.length && (s[j] === ' ' || s[j] === '\n' || s[j] === '\r' || s[j] === '\t')) j++;
      if (s[j] === '}' || s[j] === ']') continue;
    }
    out.push(c);
  }
  return out.join('');
}
// `s` is trimmed. An object or array that does not end with its closing
// bracket cannot parse, so skip the (exception-heavy) attempts.
function parseLoose(s) {
  const bracket = s[0] === '{' ? '}' : s[0] === '[' ? ']' : '';
  if (bracket && s.at(-1) !== bracket) return null;
  try {
    return { value: JSON.parse(s) };
  } catch {}
  if (!bracket) return null;
  try {
    return { value: JSON.parse(dropTrailingCommas(s)) };
  } catch {
    return null;
  }
}
function matchEnd(t, s, open, close) {
  let depth = 0,
    str = false;
  for (let i = s; i < t.length; i++) {
    const c = t[i];
    if (str) {
      if (c === '\\') i++;
      else if (c === '"') str = false;
    } else if (c === '"') str = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return i;
  }
  return -1;
}
// A JSON object starts with { then " or }; an array with [ then {, [, " or ].
// This skips prose such as "{curly}" or "[1]".
function startsJSON(t, s, open) {
  let j = s + 1;
  while (j < t.length && (t[j] === ' ' || t[j] === '\n' || t[j] === '\r' || t[j] === '\t')) j++;
  return open === '{' ? t[j] === '"' || t[j] === '}' : t[j] === '{' || t[j] === '[' || t[j] === '"' || t[j] === ']';
}
// -> { hit: {value} | null, tries }: tries counts plausible starts examined.
function scanFor(t, open, close) {
  let from = 0,
    tries = 0;
  while (tries < 50) {
    const s = t.indexOf(open, from);
    if (s < 0) break;
    if (!startsJSON(t, s, open)) {
      from = s + 1;
      continue;
    }
    tries++;
    const e = matchEnd(t, s, open, close);
    if (e < 0) break; // unbalanced: everything after is inside a truncated value
    const r = parseLoose(t.slice(s, e + 1));
    if (r && r.value !== null && typeof r.value === 'object') return { hit: r, tries };
    from = e + 1; // skip the whole unit so nested objects are never mistaken for the answer
  }
  return { hit: null, tries };
}
function fences(t) {
  const out = [];
  for (let i = 0; out.length < 20; ) {
    const a = t.indexOf('```', i);
    if (a < 0) break;
    const nl = t.indexOf('\n', a + 3);
    if (nl < 0) break;
    const label = t.slice(a + 3, nl).trim().toLowerCase();
    const b = t.indexOf('```', nl + 1);
    out.push({ json: label.startsWith('json'), body: t.slice(nl + 1, b < 0 ? t.length : b) });
    if (b < 0) break;
    i = b + 3;
  }
  return out.sort((x, y) => y.json - x.json);
}
// Non-throwing core of extractJSON: { value } or null. Arrays are a fallback
// only when the text has no object start at all, so the inner array of a
// truncated or invalid object is never returned as the answer.
function findJSON(text) {
  if (typeof text !== 'string') return null;
  const t = stripThinking(text).replace(/^\uFEFF/, '').trim();
  let r = parseLoose(t);
  if (r) return r;
  for (const f of fences(t)) {
    const body = f.body.trim();
    r = parseLoose(body) || scanFor(body, '{', '}').hit;
    if (r) return r;
  }
  const o = scanFor(t, '{', '}');
  if (o.hit || o.tries) return o.hit;
  return scanFor(t, '[', ']').hit;
}
function extractJSON(text) {
  if (typeof text !== 'string') throw new Error('The model returned no text content.');
  const r = findJSON(text);
  if (!r) throw new Error('The model did not return valid JSON.');
  return r.value;
}

// ---- tagged blocks --------------------------------------------------------

const KINDS = ['css', 'screen', 'remove', 'element', 'meta'];
const START = /<forma-(css|screen|remove|element|meta)(?=[\s>/])/gi;
const START_Y = /<forma-(?:css|screen|remove|element|meta)(?=[\s>/])/iy;
const CLOSE_G = Object.fromEntries(KINDS.map((k) => [k, new RegExp(`</forma-${k}\\s*>`, 'gi')]));
// Any block's closing tag: a block closed with the wrong tag (a common slip,
// "<forma-element>…</forma-screen>") still ends there instead of running on.
const ANY_CLOSE_G = /<\/forma-(css|screen|remove|element|meta)\s*>/gi;
const ANY_CLOSE_Y = /<\/forma-(css|screen|remove|element|meta)\s*>/iy;
const STRAY_CLOSE = /<\/forma-(?:css|screen|remove|element|meta)\s*>/gi;
const FENCE_LINE = /^[ \t]*```[ \t]*[\w+-]*[ \t]*$/gm;
const META_UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);
// Quoted values may hold '>' but not '<' or a newline; anything else falls
// back to the lenient form, which ends at the first '>'.
const TAG_STRICT = /((?:\s+[^\s=>/"'<]+(?:\s*=\s*(?:"[^"\n<]*"|'[^'\n<]*'|[^\s"'<>/]*))?)*)\s*(\/?)>/y;
const TAG_LENIENT = /([^<>]*?)(\/?)>/y;
const ATTR = /([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)(?:"|$)|'([^']*)(?:'|$)|([^\s"'<>]*)))?/g;
const ENTITIES = { quot: '"', apos: "'", amp: '&', lt: '<', gt: '>', '#39': "'", '#34': '"' };

function attrs(s) {
  const out = Object.create(null);
  for (const m of s.matchAll(ATTR)) {
    const k = m[1].toLowerCase();
    if (!(k in out)) out[k] = (m[2] ?? m[3] ?? m[4] ?? '').replace(/&(quot|apos|amp|lt|gt|#39|#34);/g, (_, e) => ENTITIES[e]).trim().slice(0, 200);
  }
  return out;
}
function openTag(t, at) {
  TAG_STRICT.lastIndex = at;
  let m = TAG_STRICT.exec(t);
  if (!m) {
    TAG_LENIENT.lastIndex = at;
    m = TAG_LENIENT.exec(t);
    if (!m) return null;
  }
  return { end: at + m[0].length, attrs: attrs(m[1]), self: m[2] === '/' };
}
// End of an HTML start tag beginning at i, honouring quoted attribute values.
// -1 means the markup is broken (stray '<', unclosed quote, or a quote that
// swallows a block opening), so the caller falls back to a plain search.
function tagEnd(t, i, find) {
  for (; i < t.length; i++) {
    const c = t[i];
    if (c === '>') return i;
    if (c === '<') return -1;
    if (c !== '"' && c !== "'") continue;
    let k = i - 1;
    while (k >= 0 && (t[k] === ' ' || t[k] === '\t' || t[k] === '\n')) k--;
    if (t[k] !== '=') continue;
    const e = find.index(c, i + 1);
    if (e < 0 || find.start(i + 1)?.index < e) return -1;
    i = e;
  }
  return -1;
}
// HTML-aware search for the end of a screen/element block, so a closing tag
// inside an attribute value or comment does not end the block early.
function closedAt(kind, at, m) {
  const by = m[1].toLowerCase();
  return { end: at, next: at + m[0].length, how: by === kind ? 'closed' : 'mismatch', by };
}
function htmlEnd(t, from, kind, find) {
  for (let i = from; ; ) {
    const j = t.indexOf('<', i);
    if (j < 0) return null;
    ANY_CLOSE_Y.lastIndex = j;
    const m = ANY_CLOSE_Y.exec(t);
    if (m) return closedAt(kind, j, m);
    START_Y.lastIndex = j;
    if (START_Y.test(t)) return { end: j, next: j, how: 'implicit' };
    if (t.startsWith('<!--', j)) {
      const k = find.index('-->', j + 4);
      if (k < 0 || find.start(j + 4)?.index < k) return null;
      i = k + 3;
      continue;
    }
    const c = t.charCodeAt(j + 1);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) {
      const k = tagEnd(t, j + 2, find);
      if (k < 0) return null;
      i = k + 1;
      continue;
    }
    i = j + 1;
  }
}
// Forward-only searches with memoization keep parsing linear on hostile input:
// a later search from a later position can reuse an earlier result.
function finder(t) {
  const cache = {};
  const hit = (c, from) => c && from >= c.from && (c.index < 0 || c.index >= from);
  const search = (key, re, from) => {
    if (!hit(cache[key], from)) {
      re.lastIndex = from;
      const m = re.exec(t);
      cache[key] = { from, index: m ? m.index : -1, len: m ? m[0].length : 0, m };
    }
    return cache[key].index < 0 ? null : cache[key];
  };
  const index = (str, from) => {
    const key = 'i' + str;
    if (!hit(cache[key], from)) cache[key] = { from, index: t.indexOf(str, from) };
    return cache[key].index;
  };
  return { close: (kind, from) => search(kind, CLOSE_G[kind], from), anyClose: (from) => search('*', ANY_CLOSE_G, from), start: (from) => search('', START, from), index };
}
function plainEnd(find, t, from, kind) {
  const c = find.anyClose(from),
    s = find.start(from);
  if (c && (!s || c.index < s.index)) return closedAt(kind, c.index, c.m);
  if (s) return { end: s.index, next: s.index, how: 'implicit' };
  return { end: t.length, next: t.length, how: 'eof' };
}
// A meta block whose JSON mentions a block tag inside a string ("summary":
// "uses <forma-screen> blocks") ends early at that tag. When the text up to
// its own </forma-meta> is one whole JSON object, the tag was inside a string
// (JSON allows '<' nowhere else), so the block really ends there. Meta is
// small; the size cap keeps repeated attempts on hostile input linear.
function metaEnd(find, t, from, end, body) {
  if (end.how === 'closed' || end.how === 'eof' || plain(findJSON(body)?.value)) return end;
  const c = find.close('meta', from);
  if (!c || c.index - from > 20000) return end;
  const whole = parseLoose(unfence(t.slice(from, c.index)));
  return whole && plain(whole.value) ? { end: c.index, next: c.index + c.len, how: 'closed' } : end;
}
const unfence = (s) =>
  s
    .replace(/^\s*```[ \t]*[\w+-]*[ \t]*\n?/, '')
    .replace(/\n?[ \t]*```\s*$/, '')
    .replace(FENCE_LINE, '')
    .trim();

// parseBlocks(text) -> { css, cssMode, screens: [{id, name, html, truncated?}],
//   removed, element, meta, notes, truncated }
function parseBlocks(text) {
  const out = { css: null, cssMode: 'append', screens: [], removed: [], element: null, meta: null, notes: '', truncated: false };
  if (typeof text !== 'string' || !text) return out;
  const t = stripThinking(text).replace(/\r\n?/g, '\n');
  const find = finder(t);
  const notes = [],
    problems = [],
    index = new Map(),
    removed = new Set();
  let pos = 0,
    from = 0,
    elementDone = false;
  const problem = (p) => problems.length < 10 && problems.push(p);
  for (;;) {
    START.lastIndex = pos;
    const m = START.exec(t);
    if (!m) break;
    pos = m.index + m[0].length;
    // `<forma-css>` mentioned as inline code; a fence glued to a block (```<forma-css>) is not.
    if (t[m.index - 1] === '`' && !t.startsWith('```', m.index - 3)) continue;
    const tag = openTag(t, pos);
    if (!tag) continue;
    const kind = m[1].toLowerCase();
    const a = tag.attrs;
    const label = `<forma-${kind}${a.id ? ` id="${a.id}"` : ''}>`;
    if (kind === 'remove') {
      notes.push(t.slice(from, m.index));
      pos = tag.end;
      if (a.id && !removed.has(a.id)) removed.add(a.id), out.removed.push(a.id);
      if (!tag.self) {
        const c = find.close('remove', pos),
          s = find.start(pos);
        if (c && (!s || c.index < s.index)) pos = c.index + c.len;
      }
      from = pos;
      continue;
    }
    let end = tag.self
      ? { end: tag.end, next: tag.end, how: 'closed' }
      : ((kind === 'screen' || kind === 'element') && htmlEnd(t, tag.end, kind, find)) || plainEnd(find, t, tag.end, kind);
    let body = unfence(t.slice(tag.end, end.end));
    if (kind === 'meta' && !tag.self) {
      const fixed = metaEnd(find, t, tag.end, end, body);
      if (fixed !== end) (end = fixed), (body = unfence(t.slice(tag.end, end.end)));
    }
    // An unclosed tag without attributes or markup is prose that mentions the
    // protocol ("the <forma-css> and <forma-screen> blocks"): keep it as notes.
    if (end.how !== 'closed' && !Object.keys(a).length && !/[<{]/.test(body)) continue;
    notes.push(t.slice(from, m.index));
    pos = from = end.next;
    const truncated = end.how === 'eof';
    if (truncated) {
      out.truncated = true;
      problem(`The ${label} block was not closed; the answer looks truncated.`);
    } else if (end.how === 'implicit') problem(`The ${label} block was not closed before the next block.`);
    else if (end.how === 'mismatch') problem(`The ${label} block was closed with </forma-${end.by}>.`);
    if (kind === 'css') {
      if ((a.mode || '').toLowerCase() === 'replace') (out.css = body), (out.cssMode = 'replace');
      else out.css = out.css == null ? body : out.css && body ? `${out.css}\n${body}` : out.css || body;
    } else if (kind === 'screen') {
      const screen = { id: a.id || '', name: a.name || '', html: body, ...(truncated ? { truncated: true } : {}) };
      const i = screen.id ? index.get(screen.id) : undefined;
      if (i == null) {
        if (screen.id) index.set(screen.id, out.screens.length);
        out.screens.push(screen);
      } else if (!truncated || out.screens[i].truncated) out.screens[i] = screen; // later complete copy wins
    } else if (kind === 'element') {
      if (!truncated || !elementDone) (out.element = body), (elementDone = elementDone || !truncated);
    } else {
      const value = findJSON(body)?.value;
      if (plain(value)) {
        out.meta ||= {};
        for (const [k, v] of Object.entries(value)) if (!META_UNSAFE.has(k)) out.meta[k] = v;
      } else problem('The <forma-meta> block was not a JSON object and was ignored.');
    }
  }
  notes.push(t.slice(from));
  const prose = notes
    .join('\n')
    .replace(STRAY_CLOSE, '')
    .replace(FENCE_LINE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 3000);
  out.notes = [prose, ...problems].filter(Boolean).join('\n');
  return out;
}

module.exports = {
  chat,
  stripThinking,
  extractJSON,
  parseBlocks,
  stripImages,
  countImages,
  extendConfig,
  visionSupported,
  MESSAGES: MSG,
  _internal: { sseParser, splitThinking, requestBody, dropTrailingCommas, findJSON, VISION, TUNING },
};
