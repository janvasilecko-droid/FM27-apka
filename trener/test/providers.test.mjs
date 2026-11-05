import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import util from 'node:util';
import vm from 'node:vm';
import * as nodeBuffer from 'node:buffer';

// Globální File je až od Node 20; na Node 18 stačí ten z node:buffer.
const File = globalThis.File || nodeBuffer.File;
const require = createRequire(import.meta.url);
const P = require('../src/providers.js');
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const SOURCE = readFileSync(path.join(here, '..', 'src', 'providers.js'), 'utf8');

// Falešný klíč: v testech se hlídá, že se nikdy neobjeví nikde jinde než v hlavičce požadavku.
// Falešný klíč se skládá až za běhu, aby ve zdroji nebyl řetězec, který vypadá jako skutečný klíč (hlídá to test v ai_gateway).
const KEY = ['sk', 'test', 'NEVER', 'LEAK', '1234567890abcdef'].join('-');
const TIER_LIST = ['quick', 'default', 'complex'];

// ------------------------------------------------------------------ pomůcky
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const textResponse = (text, status) => new Response(text, { status });

/** Falešný fetch: odpovědi bere z fronty (poslední se opakuje; odpověď je funkce, ať je každá čerstvá) a zachytává
    požadavky. Je to obyčejná funkce, aby šlo zachytit `this`: modul ji musí volat jako samostatnou funkci. */
function fakeFetch(...replies) {
  const calls = [];
  function impl(url, init) {
    calls.push({ url, init, self: this, headers: init.headers, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    const next = replies.length > 1 ? replies.shift() : replies[0];
    return Promise.resolve().then(() => (typeof next === 'function' ? next(url, init) : next));
  }
  impl.calls = calls;
  return impl;
}

const anthropicBody = (text = '{}', extra = {}) => ({
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-5-5',
  content: [{ type: 'text', text }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 11, output_tokens: 7, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  ...extra,
});
const anthropicError = (type, message, extra = {}) => ({ type: 'error', error: { type, message }, ...extra });
const openaiBody = (text = '{}', extra = {}) => ({
  id: 'chatcmpl-1',
  object: 'chat.completion',
  model: 'm-default',
  choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
  ...extra,
});

async function caught(promise) {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  return assert.fail('Čekalo se odmítnutí, ale volání uspělo.');
}

/** Chyba rozhraní: prostý objekt (ne Error), kód z pevného seznamu, neprázdná zpráva, žádný klíč. */
function assertProviderError(err, code) {
  assert.ok(!(err instanceof Error), 'chyba nemá být Error');
  assert.equal(typeof err, 'object');
  assert.equal(err.code, code, `čekal se kód ${code}, přišlo ${err.code}: ${err.message}`);
  assert.ok(P.ERROR_CODES.includes(err.code));
  assert.equal(typeof err.message, 'string');
  assert.ok(err.message.length > 0);
  assert.ok(Object.keys(err).every((k) => ['code', 'message', 'text'].includes(k)), `nečekané vlastnosti: ${Object.keys(err)}`);
  assert.ok(!JSON.stringify(err).includes(KEY), 'v chybě je klíč');
}

const anthropic = (f, extra = {}) => P.createAnthropicProvider({ apiKey: KEY, fetch: f, ...extra });
const PNG_BYTES = Uint8Array.from([137, 80, 78, 71]); // base64: iVBORw==
const PNG_B64 = 'iVBORw==';
const png = () => new Blob([PNG_BYTES], { type: 'image/png' });

// ------------------------------------------------------------------ konstanty a rozhraní
test('kódy chyb jsou přesně ty z kontraktu a tabulky jsou zamrzlé', () => {
  assert.deepEqual([...P.ERROR_CODES].sort(), ['cancelled', 'empty_completion', 'invalid_json', 'invalid_request', 'network_error', 'not_granted', 'prompt_too_large', 'rate_limited', 'refused', 'upstream_error']);
  assert.deepEqual(P.TIER_MODELS.anthropic, { quick: 'claude-haiku-5-5', default: 'claude-sonnet-5-5', complex: 'claude-opus-5-5' });
  assert.ok(Object.isFrozen(P.TIER_MODELS.anthropic));
  assert.ok(Object.isFrozen(P.PRICES_USD_PER_MTOK));
  assert.deepEqual([...P.TIERS], TIER_LIST);
  assert.equal(P.LEDGER_MAX_ENTRIES, 500);
});

test('adaptér má rozhraní {name, kind, limits, json, text}', () => {
  const noFetch = fakeFetch(() => jsonResponse(anthropicBody()));
  for (const provider of [anthropic(noFetch), P.createOpenAICompatibleProvider({ baseUrl: 'https://x.test/v1', models: { default: 'm' }, fetch: noFetch }), P.wrapSample(async () => ({ text: 'x', truncated: false }))]) {
    assert.equal(typeof provider.name, 'string');
    assert.equal(typeof provider.kind, 'string');
    for (const fn of ['limits', 'json', 'text']) assert.equal(typeof provider[fn], 'function');
  }
});

test('ceník v JS přesně odpovídá tabulce v ai_gateway/costs.py', (t) => {
  const file = path.join(root, 'ai_gateway', 'costs.py');
  if (!existsSync(file)) return t.skip('ai_gateway/costs.py v tomhle výřezu repozitáře není');
  const py = readFileSync(file, 'utf8');
  const keyMap = { input: 'input', output: 'output', cache_read: 'cacheRead', cache_write: 'cacheWrite', long_threshold: 'longThreshold', long_input: 'longInput', long_output: 'longOutput' };
  const parsed = {};
  for (const m of py.matchAll(/"anthropic\/([a-z0-9-]+)":\s*Price\(([^)]*)\)/g)) {
    const price = {};
    for (const kv of m[2].matchAll(/(\w+)=([\d_.]+)/g)) if (keyMap[kv[1]]) price[keyMap[kv[1]]] = Number(kv[2].replace(/_/g, ''));
    parsed[m[1]] = price;
  }
  assert.deepEqual(Object.keys(parsed).sort(), Object.keys(P.PRICES_USD_PER_MTOK).sort());
  for (const [model, price] of Object.entries(parsed)) assert.deepEqual({ ...P.PRICES_USD_PER_MTOK[model] }, price, model);
  assert.match(P.PRICES_NOTE, /ověř/i);
});

// ------------------------------------------------------------------ Anthropic: tvar požadavku
test('anthropic: URL, hlavičky, tělo a model podle úrovně', async () => {
  const f = fakeFetch(() => jsonResponse(anthropicBody('ahoj')));
  const p = anthropic(f);
  assert.equal(p.kind, 'anthropic');
  const models = { quick: 'claude-haiku-5-5', default: 'claude-sonnet-5-5', complex: 'claude-opus-5-5' };
  const maxTokens = { quick: 4096, default: 16000, complex: 16000 };
  for (const tier of TIER_LIST) {
    assert.deepEqual(await p.text('Řekni ahoj', { modelTier: tier }), { text: 'ahoj', truncated: false });
    const c = f.calls.at(-1);
    assert.equal(c.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(c.init.method, 'POST');
    assert.deepEqual(c.headers, {
      'content-type': 'application/json',
      'x-api-key': KEY,
      'anthropic-version': '2026-10-21',
      'anthropic-dangerous-direct-browser-access': 'true',
    });
    assert.deepEqual(c.body, { model: models[tier], max_tokens: maxTokens[tier], messages: [{ role: 'user', content: 'Řekni ahoj' }] });
    assert.equal(c.init.redirect, 'error'); // hlavička s klíčem nesmí putovat při přesměrování jinam
    assert.equal(c.init.signal, undefined);
  }
  // bez volby modelTier je to „default“
  await p.text('x');
  assert.equal(f.calls.at(-1).body.model, 'claude-sonnet-5-5');
});

test('anthropic: fetch se volá jako samostatná funkce (window.fetch jako metoda by v prohlížeči selhal)', async () => {
  const f = fakeFetch(() => jsonResponse(anthropicBody()));
  await anthropic(f).text('x');
  assert.equal(f.calls[0].self, undefined);
});

test('anthropic: neposílá parametry, které modely 5.x odmítají ani nic navíc', async () => {
  const f = fakeFetch(() => jsonResponse(anthropicBody()));
  await anthropic(f).json('Odpověz JSON {"a": 1}', { cache: true, maxTokens: 321 });
  const { body, headers } = f.calls[0];
  for (const key of ['temperature', 'top_p', 'top_k', 'thinking', 'tool_choice', 'output_config', 'system', 'fallbacks', 'stream', 'tools', 'cache_control']) {
    assert.ok(!(key in body), `v těle nemá být ${key}`);
  }
  assert.ok(!('anthropic-beta' in headers));
  assert.deepEqual(Object.keys(body).sort(), ['max_tokens', 'messages', 'model']);
  assert.equal(body.max_tokens, 321);
  assert.equal(body.messages.at(-1).role, 'user'); // žádná předvyplněná odpověď asistenta
});

test('anthropic: signál se předá do fetch', async () => {
  const f = fakeFetch(() => jsonResponse(anthropicBody()));
  const ctl = new AbortController();
  await anthropic(f).text('x', { signal: ctl.signal });
  assert.equal(f.calls[0].init.signal, ctl.signal);
});

test('anthropic: baseUrl, version a models jdou přepsat', async () => {
  const f = fakeFetch(() => jsonResponse(anthropicBody()));
  const p = P.createAnthropicProvider({ apiKey: `  ${KEY}\n`, fetch: f, baseUrl: 'https://proxy.example.test///', version: '2099-01-01', models: { complex: 'claude-opus-5', quick: '', default: 5 } });
  await p.text('x', { modelTier: 'complex' });
  await p.text('x', { modelTier: 'quick' });
  assert.equal(f.calls[0].url, 'https://proxy.example.test/v1/messages');
  assert.equal(f.calls[0].headers['anthropic-version'], '2099-01-01');
  assert.equal(f.calls[0].headers['x-api-key'], KEY); // okolní mezery a zalomení se ořežou
  assert.equal(f.calls[0].body.model, 'claude-opus-5');
  assert.equal(f.calls[1].body.model, 'claude-haiku-5-5'); // prázdný nebo špatný název se ignoruje
  assert.deepEqual({ ...p.models }, { quick: 'claude-haiku-5-5', default: 'claude-sonnet-5-5', complex: 'claude-opus-5' });
});

test('anthropic: zprávy z pole zůstanou, zprávy téže role za sebou se spojí', async () => {
  const f = fakeFetch(() => jsonResponse(anthropicBody()));
  await anthropic(f).text([
    { role: 'user', content: 'pravidla' },
    { role: 'user', content: 'otázka' },
    { role: 'assistant', content: 'odpověď' },
    { role: 'user', content: 'oprav' },
  ]);
  assert.deepEqual(f.calls[0].body.messages, [
    { role: 'user', content: 'pravidla\n\notázka' },
    { role: 'assistant', content: 'odpověď' },
    { role: 'user', content: 'oprav' },
  ]);
});

test('anthropic: špatný vstup nebo volby skončí invalid_request a nic se neodešle', async () => {
  const f = fakeFetch(() => jsonResponse(anthropicBody()));
  const p = anthropic(f);
  const badInputs = [
    '', '   ', [], 42, null,
    [{ role: 'system', content: 'x' }],
    [{ role: 'user', content: 'a' }, { role: 'system', content: 'b' }, { role: 'user', content: 'c' }], // cizí role uprostřed
    [{ role: 'user', content: 'a' }, { role: 'tool', content: 'b' }, { role: 'user', content: 'c' }],
    [{ role: 'assistant', content: 'a' }],
    [{ role: 'assistant', content: 'a' }, { role: 'user', content: 'b' }],
    [{ role: 'user', content: '' }],
    [{ role: 'user' }],
    ['text'],
  ];
  for (const input of badInputs) assertProviderError(await caught(p.text(input)), 'invalid_request');
  const badOpts = [{ modelTier: 'mega' }, { signal: new AbortController() }, { onText: 'ne' }, { maxTokens: 0 }, { maxTokens: 1.5 }, 'x', []];
  for (const opts of badOpts) assertProviderError(await caught(p.text('ahoj', opts)), 'invalid_request');
  assert.equal(f.calls.length, 0);
});

test('anthropic: strop zadání se počítá v bajtech UTF-8 a kontroluje před odesláním', async () => {
  const f = fakeFetch(() => jsonResponse(anthropicBody()));
  const p = anthropic(f, { maxPromptBytes: 10 });
  assertProviderError(await caught(p.text('ěěěěěě')), 'prompt_too_large'); // 6 znaků = 12 B
  assertProviderError(await caught(p.text([{ role: 'user', content: 'ěěě' }, { role: 'assistant', content: 'ěěě' }, { role: 'user', content: 'ěěě' }])), 'prompt_too_large');
  assert.equal(f.calls.length, 0);
  await p.text('ěěěěě'); // přesně 10 B
  assert.equal(f.calls.length, 1);
  // znak mimo základní rovinu (dvojice náhradních kódů) má 4 B, ne 6
  assertProviderError(await caught(anthropic(f, { maxPromptBytes: 7 }).text('😀😀')), 'prompt_too_large'); // 8 B
  await anthropic(f, { maxPromptBytes: 8 }).text('😀😀');
  assert.equal(f.calls.length, 2);
  // česká diakritika: 2 B na znak, základní ASCII 1 B, znak „€“ 3 B
  await anthropic(f, { maxPromptBytes: 7 }).text('aě€');
  assertProviderError(await caught(anthropic(f, { maxPromptBytes: 5 }).text('aě€')), 'prompt_too_large');
});

test('anthropic: limits() je Promise, hlásí strop zadání a obrázky a vrací vždy kopii', async () => {
  const p = anthropic(fakeFetch(() => jsonResponse(anthropicBody())));
  const first = p.limits();
  assert.ok(first instanceof Promise);
  const limits = await first;
  assert.deepEqual(limits, { maxPromptBytes: 262144, images: { maxCount: 4, maxInputBytes: 5 * 1024 * 1024, mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] } });
  limits.images.mediaTypes.push('image/x-evil');
  limits.maxPromptBytes = 1;
  assert.deepEqual(await p.limits(), { maxPromptBytes: 262144, images: { maxCount: 4, maxInputBytes: 5 * 1024 * 1024, mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] } });
});

// ------------------------------------------------------------------ Anthropic: obrázky
test('anthropic: obrázek jde jako base64 blok před textem poslední zprávy', async () => {
  const f = fakeFetch(() => jsonResponse(anthropicBody()));
  const p = anthropic(f);
  await p.text('Co vidíš?', { images: [png()], modelTier: 'quick' });
  assert.deepEqual(f.calls[0].body.messages, [
    { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_B64 } }, { type: 'text', text: 'Co vidíš?' }] },
  ]);
});

test('anthropic: více obrázků (File je Blob, i samotný Blob), obrázky jen u poslední zprávy', async () => {
  const f = fakeFetch(() => jsonResponse(anthropicBody()));
  const p = anthropic(f);
  const jpg = new File([Uint8Array.from([255, 216, 255])], 'a.jpg', { type: 'image/jpeg' });
  await p.text(
    [
      { role: 'user', content: 'první' },
      { role: 'assistant', content: 'odpověď' },
      { role: 'user', content: 'druhá' },
    ],
    { images: [png(), jpg] }
  );
  const msgs = f.calls[0].body.messages;
  assert.equal(msgs[0].content, 'první');
  assert.equal(msgs[1].content, 'odpověď');
  assert.deepEqual(msgs[2].content.map((b) => b.type), ['image', 'image', 'text']);
  assert.deepEqual(msgs[2].content.map((b) => b.source && b.source.media_type), ['image/png', 'image/jpeg', undefined]);
  assert.equal(msgs[2].content[1].source.data, '/9j/');
  await p.text('jediný', { images: png() });
  assert.equal(f.calls[1].body.messages[0].content[0].source.data, PNG_B64);
  await p.text('prázdné pole', { images: [] });
  assert.equal(f.calls[2].body.messages[0].content, 'prázdné pole');
  // FileList z <input type="file"> není pole, ale má length a indexy
  await p.text('jako FileList', { images: { 0: png(), 1: jpg, length: 2 } });
  assert.deepEqual(f.calls[3].body.messages[0].content.map((b) => b.type), ['image', 'image', 'text']);
});

test('anthropic: nepřijatelné obrázky skončí invalid_request před odesláním', async () => {
  const f = fakeFetch(() => jsonResponse(anthropicBody()));
  const p = anthropic(f);
  const bad = [
    [new Blob(['x'], { type: 'text/plain' })],
    [new Blob([PNG_BYTES])], // bez typu
    [png(), png(), png(), png(), png()], // víc než 4
    [new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: 'image/png' })],
    [new Blob([], { type: 'image/png' })],
    ['není soubor'],
    'text místo souboru',
    { žádné: 'pole' },
  ];
  for (const images of bad) assertProviderError(await caught(p.text('x', { images })), 'invalid_request');
  assert.equal(f.calls.length, 0);
  await p.text('x', { images: [new Blob([PNG_BYTES], { type: 'IMAGE/PNG' })] }); // velikost písmen typu nevadí
  assert.equal(f.calls[0].body.messages[0].content[0].source.media_type, 'image/png');
});

// ------------------------------------------------------------------ Anthropic: čtení odpovědi
test('anthropic: text se složí ze všech textových bloků, ostatní se přeskočí', async () => {
  const content = [
    { type: 'thinking', thinking: '', signature: 'x' },
    { type: 'text', text: 'Ahoj, ' },
    { type: 'tool_use', id: 't', name: 'n', input: {} },
    { type: 'text', text: 'světe' },
    { type: 'text', text: '!' },
  ];
  const p = anthropic(fakeFetch(() => jsonResponse(anthropicBody('', { content }))));
  assert.deepEqual(await p.text('x'), { text: 'Ahoj, světe!', truncated: false });
});

test('anthropic: truncated podle stop_reason, json() useknutou odpověď odmítne', async () => {
  for (const stop of ['max_tokens', 'model_context_window_exceeded']) {
    const p = anthropic(fakeFetch(() => jsonResponse(anthropicBody('{"a": [1, 2', { stop_reason: stop }))));
    assert.deepEqual(await p.text('x'), { text: '{"a": [1, 2', truncated: true });
    const err = await caught(p.json('x'));
    assertProviderError(err, 'invalid_json');
    assert.equal(err.text, '{"a": [1, 2');
    assert.match(err.message, /useknuta/);
  }
  // i kompletní hodnota u useknuté odpovědi se odmítne (jako u `sample`)
  const complete = anthropic(fakeFetch(() => jsonResponse(anthropicBody('{"a": 1}', { stop_reason: 'max_tokens' }))));
  assertProviderError(await caught(complete.json('x')), 'invalid_json');
});

test('anthropic: tokeny jdou do lastUsage a do onUsage, každé volání je začíná od nuly', async () => {
  const f = fakeFetch(
    () => jsonResponse(anthropicBody('ok', { usage: { input_tokens: 100, output_tokens: 40, cache_creation_input_tokens: 5, cache_read_input_tokens: 60 } })),
    () => jsonResponse(anthropicError('authentication_error', 'x'), 401),
    () => jsonResponse(anthropicBody('', { stop_reason: 'refusal', content: [], usage: { input_tokens: 9, output_tokens: 0 } })),
    () => jsonResponse(anthropicBody('ok', { usage: undefined })),
    () => jsonResponse(anthropicBody('jo', { model: 'claude-opus-4-8' }))
  );
  const p = anthropic(f);
  assert.equal(p.lastUsage, null);
  const seen = [];
  await p.text('x', { onUsage: (u) => seen.push(u) });
  assert.deepEqual(p.lastUsage, { inputTokens: 165, outputTokens: 40, model: 'claude-sonnet-5-5' });
  assert.deepEqual(seen, [p.lastUsage]);
  seen[0].inputTokens = 1; // kopie: zásah zvenku nemění lastUsage
  assert.equal(p.lastUsage.inputTokens, 165);

  await caught(p.text('x')); // HTTP chyba: žádné tokeny
  assert.equal(p.lastUsage, null);
  assertProviderError(await caught(p.text('x')), 'refused'); // odmítnutí tokeny spotřebovalo
  assert.deepEqual(p.lastUsage, { inputTokens: 9, outputTokens: 0, model: 'claude-sonnet-5-5' });
  await p.text('x'); // odpověď bez `usage`
  assert.equal(p.lastUsage, null);
  await p.text('x'); // model, který skutečně odpověděl, není vždy ten požadovaný
  assert.equal(p.lastUsage.model, 'claude-opus-4-8');
});

test('onText: jedno zavolání na konci s celým textem; chyba v onText nic nerozbije; při chybě se nevolá', async () => {
  const f = fakeFetch(
    () => jsonResponse(anthropicBody('Celý text')),
    () => jsonResponse(anthropicBody('Celý text')),
    () => jsonResponse(anthropicError('api_error', 'x'), 500),
    () => jsonResponse(anthropicBody('', { stop_reason: 'refusal', content: [{ type: 'text', text: 'část' }] }))
  );
  const p = anthropic(f);
  const calls = [];
  assert.deepEqual(await p.text('x', { onText: (u) => calls.push(u) }), { text: 'Celý text', truncated: false });
  assert.deepEqual(calls, [{ text: 'Celý text', delta: 'Celý text' }]);
  assert.deepEqual(await p.text('x', { onText: () => { throw new Error('chyba rozhraní'); } }), { text: 'Celý text', truncated: false });
  assertProviderError(await caught(p.text('x', { onText: (u) => calls.push(u) })), 'upstream_error');
  assertProviderError(await caught(p.text('x', { onText: (u) => calls.push(u) })), 'refused'); // odmítnutá odpověď se nezobrazuje
  assert.equal(calls.length, 1);
});

// ------------------------------------------------------------------ Anthropic: chyby
test('anthropic: HTTP chyby se mapují na kódy rozhraní', async () => {
  const long = 'prompt is too long: 250000 tokens > 200000 maximum';
  const cases = [
    [401, anthropicError('authentication_error', 'invalid x-api-key'), 'not_granted'],
    [403, anthropicError('permission_error', 'no'), 'not_granted'],
    [402, anthropicError('billing_error', 'pay up'), 'not_granted'],
    [400, anthropicError('invalid_request_error', 'Your credit balance is too low to access the Anthropic API.'), 'not_granted'],
    [429, anthropicError('rate_limit_error', 'slow down'), 'rate_limited'],
    [500, anthropicError('api_error', 'oops'), 'upstream_error'],
    [502, '<html><body>Bad gateway</body></html>', 'upstream_error'],
    [503, anthropicError('api_error', 'down'), 'upstream_error'],
    [529, anthropicError('overloaded_error', 'busy'), 'upstream_error'],
    [408, anthropicError('timeout_error', 'slow'), 'upstream_error'],
    [413, anthropicError('request_too_large', 'Request exceeds the maximum allowed number of bytes.'), 'prompt_too_large'],
    [400, anthropicError('invalid_request_error', long), 'prompt_too_large'],
    [400, anthropicError('invalid_request_error', 'max_tokens: must be greater than or equal to 1'), 'invalid_request'],
    [400, anthropicError('invalid_request_error', 'max_tokens: too large'), 'invalid_request'],
    [400, 'úplně jiné tělo bez JSON', 'invalid_request'],
    [404, anthropicError('not_found_error', 'model: claude-x'), 'invalid_request'],
    [422, anthropicError('invalid_request_error', 'bad'), 'invalid_request'],
  ];
  for (const [status, body, code] of cases) {
    const f = fakeFetch(() => (typeof body === 'string' ? textResponse(body, status) : jsonResponse(body, status)));
    const err = await caught(anthropic(f).text('x'));
    assertProviderError(err, code);
    assert.ok(!('text' in err));
    assert.ok(err.message.includes(`HTTP ${status}`) || status === 400, err.message);
  }
});

test('anthropic: do zprávy se dostane stručný text ze serveru a request_id, u 401/403 ne', async () => {
  const f = fakeFetch(
    () => jsonResponse(anthropicError('invalid_request_error', 'messages.0: roles must alternate', { request_id: 'req_011CSHoEeqs5C35K2UUqR7Fy' }), 400),
    () => jsonResponse(anthropicError('authentication_error', 'tajný text serveru', { request_id: 'req_abc' }), 401)
  );
  const p = anthropic(f);
  const bad = await caught(p.text('x'));
  assert.match(bad.message, /roles must alternate/);
  assert.match(bad.message, /\[req_011CSHoEeqs5C35K2UUqR7Fy\]/);
  const auth = await caught(p.text('x'));
  assert.ok(!auth.message.includes('tajný text serveru'));
});

test('anthropic: zrušení (už zrušený signál, zrušení za běhu, AbortError, zrušení během čtení)', async () => {
  // 1) signál je zrušený už při volání: nic se neodešle
  const f1 = fakeFetch(() => jsonResponse(anthropicBody()));
  const done = new AbortController();
  done.abort();
  assertProviderError(await caught(anthropic(f1).text('x', { signal: done.signal })), 'cancelled');
  assert.equal(f1.calls.length, 0);

  // 2) zrušení za běhu: fetch visí a odmítne s AbortError, až signál zruší volající
  let started;
  const startedPromise = new Promise((resolve) => (started = resolve));
  const hanging = function (url, init) {
    started();
    return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError'))));
  };
  const ctl = new AbortController();
  const pending = caught(anthropic(hanging).text('x', { signal: ctl.signal }));
  await startedPromise;
  ctl.abort();
  assertProviderError(await pending, 'cancelled');

  // 3) fetch vyhodí AbortError, i když signál nikdo nezrušil (třeba vlastní časový limit)
  const f3 = fakeFetch(() => {
    throw new DOMException('timeout', 'AbortError');
  });
  assertProviderError(await caught(anthropic(f3).text('x')), 'cancelled');

  // 4) signál se zruší, zatímco odpověď dorazila: výsledek se zahodí a onText se nezavolá
  const ctl4 = new AbortController();
  const texts = [];
  const f4 = fakeFetch(() => {
    ctl4.abort();
    return jsonResponse(anthropicBody('pozdě'));
  });
  assertProviderError(await caught(anthropic(f4).text('x', { signal: ctl4.signal, onText: (u) => texts.push(u) })), 'cancelled');
  assert.deepEqual(texts, []);

  // 5) zrušení má přednost i před chybou HTTP, která dorazila současně (uživatel stiskl Stop, chyba ho nezajímá)
  const ctl5 = new AbortController();
  const f5 = fakeFetch(() => {
    ctl5.abort();
    return jsonResponse(anthropicError('api_error', 'oops'), 500);
  });
  assertProviderError(await caught(anthropic(f5).text('x', { signal: ctl5.signal })), 'cancelled');
});

test('anthropic: když fetch vyhodí chybu, je to network_error (a bez klíče ve zprávě)', async () => {
  const f = fakeFetch(
    () => {
      throw new TypeError('Failed to fetch');
    },
    () => Promise.reject('řetězec místo výjimky'),
    () => {
      throw new Error(`connect ECONNREFUSED, hlavičky x-api-key: ${KEY}`);
    }
  );
  const p = anthropic(f);
  const first = await caught(p.text('x'));
  assertProviderError(first, 'network_error');
  assert.match(first.message, /Failed to fetch/);
  assertProviderError(await caught(p.text('x')), 'network_error');
  const leaky = await caught(p.text('x'));
  assertProviderError(leaky, 'network_error');
  assert.ok(!leaky.message.includes(KEY));
  assert.match(leaky.message, /klíč skryt/);
});

test('anthropic: prázdná odpověď je empty_completion, odmítnutí je refused', async () => {
  const empties = [
    anthropicBody('', { content: [] }),
    anthropicBody('   \n '),
    anthropicBody('', { content: [{ type: 'thinking', thinking: 'hm' }] }),
  ];
  for (const body of empties) assertProviderError(await caught(anthropic(fakeFetch(() => jsonResponse(body))).text('x')), 'empty_completion');
  // žádný text a konec na limitu délky (třeba všechno spolklo uvažování): zpráva to řekne
  const cut = await caught(anthropic(fakeFetch(() => jsonResponse(anthropicBody('', { content: [], stop_reason: 'max_tokens' })))).text('x'));
  assertProviderError(cut, 'empty_completion');
  assert.match(cut.message, /limitu délky/);

  const refusal = anthropicBody('', { stop_reason: 'refusal', content: [], stop_details: { type: 'refusal', category: 'cyber', explanation: 'x' } });
  for (const method of ['text', 'json']) {
    const err = await caught(anthropic(fakeFetch(() => jsonResponse(refusal)))[method]('x'));
    assertProviderError(err, 'refused');
    assert.match(err.message, /cyber/);
    assert.ok(!('text' in err)); // odmítnutá odpověď se stahuje, nemá nést žádný text
  }
  assertProviderError(await caught(anthropic(fakeFetch(() => jsonResponse(anthropicBody('', { stop_reason: 'refusal', content: [] })))).text('x')), 'refused');
});

test('anthropic: odpověď bez očekávaného tvaru je upstream_error', async () => {
  const bad = [jsonResponse({ type: 'message' }), textResponse('není to JSON', 200), jsonResponse([1, 2]), jsonResponse(anthropicBody('x', { content: 'text' }))];
  for (const response of bad) assertProviderError(await caught(anthropic(fakeFetch(() => response.clone())).text('x')), 'upstream_error');
});

test('anthropic: chybí klíč, nepovolené znaky v klíči, chybí fetch, špatná adresa', async () => {
  const f = fakeFetch(() => jsonResponse(anthropicBody()));
  for (const apiKey of [undefined, '', '   ', 'klíč s mezerou', 'sk-ěščř', 'sk-a\nb']) {
    assertProviderError(await caught(P.createAnthropicProvider({ apiKey, fetch: f }).text('x')), 'not_granted');
  }
  assertProviderError(await caught(P.createAnthropicProvider({ apiKey: KEY }).text('x')), 'invalid_request');
  for (const baseUrl of ['ftp://x.test', 'api.anthropic.com', 'https://']) {
    assertProviderError(await caught(anthropic(f, { baseUrl }).text('x')), 'invalid_request');
  }
  assert.equal(f.calls.length, 0);
});

test('anthropic: klíč se nikdy neobjeví v chybě, v těle, v URL ani v objektu poskytovatele', async () => {
  const pad = 'x'.repeat(190);
  const scenarios = [
    () => jsonResponse(anthropicError('authentication_error', `invalid key ${KEY}`), 401),
    () => jsonResponse(anthropicError('permission_error', `Key ${KEY} cannot do that`), 403),
    () => jsonResponse(anthropicError('invalid_request_error', `bad parameter, key ${KEY}`), 400),
    () => jsonResponse(anthropicError('invalid_request_error', `${pad}${KEY}`), 400), // klíč na hranici zkrácení
    () => jsonResponse(anthropicError('rate_limit_error', `limit for ${KEY}`), 429),
    () => jsonResponse(anthropicError('api_error', `oops ${KEY}`), 500),
    () => jsonResponse(anthropicError('not_found_error', `model ${KEY}`, { request_id: KEY }), 404),
    () => textResponse(`Gateway error for ${KEY}`, 502),
    () => {
      throw new TypeError(`connect failed, header x-api-key: ${KEY}`);
    },
    () => jsonResponse(anthropicBody('x', { stop_reason: 'refusal', content: [], stop_details: { category: KEY } })),
    () => jsonResponse(anthropicBody('Tohle není JSON')),
  ];
  for (const scenario of scenarios) {
    const f = fakeFetch(scenario);
    const p = anthropic(f);
    for (const method of ['text', 'json']) {
      let err;
      try {
        await p[method]('x');
        continue; // úspěšné volání (text u poslední varianty) žádnou chybu nemá
      } catch (e) {
        err = e;
      }
      assertProviderError(err, err.code);
      for (const form of [JSON.stringify(err), String(err.message), util.inspect(err, { depth: 5 })]) assert.ok(!form.includes(KEY), form);
      assert.ok(!err.message.includes(KEY.slice(0, 10)), 'zbytek klíče ve zprávě: ' + err.message);
    }
    for (const call of f.calls) {
      assert.equal(call.headers['x-api-key'], KEY); // klíč je jen v hlavičce
      assert.ok(!JSON.stringify(call.body).includes(KEY));
      assert.ok(!call.url.includes(KEY));
    }
    for (const form of [JSON.stringify(p), util.inspect(p, { depth: 6, showHidden: true }), Object.keys(p).join()]) assert.ok(!form.includes(KEY));
  }
});

// ------------------------------------------------------------------ json()
test('anthropic: json() vrací rozparsovanou hodnotu (ohrady, text kolem, pole)', async () => {
  const replies = ['{"a": 1}', 'Tady je rada:\n```json\n{"a": {"b": [1, 2]}}\n```\nHotovo.', '["x", "y"]', '```\n[1]\n```'];
  const expected = [{ a: 1 }, { a: { b: [1, 2] } }, ['x', 'y'], [1]];
  for (let i = 0; i < replies.length; i++) {
    const p = anthropic(fakeFetch(() => jsonResponse(anthropicBody(replies[i]))));
    assert.deepEqual(await p.json('x'), expected[i]);
  }
});

test('anthropic: json() nad nesmyslem hodí invalid_json s celou syrovou odpovědí; onText dostane syrový text', async () => {
  const raw = '  Tohle není JSON.\n';
  const p = anthropic(fakeFetch(() => jsonResponse(anthropicBody(raw))));
  const texts = [];
  const err = await caught(p.json('x', { onText: (u) => texts.push(u.text) }));
  assertProviderError(err, 'invalid_json');
  assert.equal(err.text, raw); // doslova, včetně okolních mezer
  assert.deepEqual(texts, [raw]);
  assert.deepEqual(p.lastUsage, { inputTokens: 11, outputTokens: 7, model: 'claude-sonnet-5-5' }); // volání se platilo
});

// ------------------------------------------------------------------ extractJson
test('extractJson: celý text, ohrady, text před a po, vnořené závorky', () => {
  const { extractJson } = P;
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('  \n[1, 2.5e3, -4]\n'), [1, 2500, -4]);
  assert.deepEqual(extractJson('```json\n{"a": 1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('```JSON\r\n{"a": 1}\r\n```'), { a: 1 });
  assert.deepEqual(extractJson('```\n["x"]\n```'), ['x']);
  assert.deepEqual(extractJson('Tady je rada:\n```json\n{"a": {"b": [1, {"c": 2}]}}\n```\nDoufám, že to pomůže.'), { a: { b: [1, { c: 2 }] } });
  assert.deepEqual(extractJson('[[1, 2], [3, 4]]'), [[1, 2], [3, 4]]);
  assert.deepEqual(extractJson('{"a": "\\u00e9"}'), { a: 'é' }); // escape \u v JSON řetězci se přečte
  assert.deepEqual(extractJson(String.fromCharCode(0xfeff) + '{"a": 1}'), { a: 1 }); // BOM na začátku nevadí
});

test('extractJson: závorky, uvozovky a ohrady uvnitř řetězců nic nerozbijí', () => {
  const { extractJson } = P;
  const tricky = { t: 'zavírací } a ] otevírací { a [, uvozovka " a zpětné \\ lomítko', u: ']', v: 'kód ```js\nx\n``` v textu', w: '\\"' };
  assert.deepEqual(extractJson('Předtím ' + JSON.stringify(tricky) + ' potom'), tricky);
  assert.deepEqual(extractJson('```json\n' + JSON.stringify(tricky, null, 2) + '\n```'), tricky);
  assert.deepEqual(extractJson('Odpověď: ' + JSON.stringify([tricky, { x: [] }])), [tricky, { x: [] }]);
});

test('extractJson: při více kandidátech vyhraje nejdelší, který jde zpracovat', () => {
  const { extractJson } = P;
  assert.deepEqual(extractJson('Podle [1] je odpověď: {"vysledek": "ano", "duvod": "protože"}'), { vysledek: 'ano', duvod: 'protože' });
  assert.deepEqual(extractJson('Nastav {mentalita} a vrať {"a": 1}'), { a: 1 });
  assert.deepEqual(extractJson('Příklad: {"a": 1}. Skutečná odpověď: {"a": 1, "b": [2, 3], "c": "delší"}'), { a: 1, b: [2, 3], c: 'delší' });
  assert.deepEqual(extractJson('Rozbitý {"a": [1, 2 a pak platný ["ok"]'), ['ok']);
});

test('extractJson: nesmysl, prázdný vstup, holé hodnoty a useknutý JSON hodí invalid_json s celým textem', () => {
  const { extractJson } = P;
  const bad = ['Žádný JSON tady není', 'Jen {rozbitý json', '{"a": [1, 2', '', '   ', '42', '"text"', 'null', 'true', '{"a": }', undefined, null];
  for (const input of bad) {
    let err;
    try {
      extractJson(input);
    } catch (e) {
      err = e;
    }
    assert.ok(err, `mělo to selhat: ${String(input)}`);
    assertProviderError(err, 'invalid_json');
    assert.equal(err.text, input === undefined || input === null ? '' : input); // doslova celá odpověď
  }
  assert.match(String(Object.values((() => { try { extractJson('Jen {rozbitý json'); } catch (e) { return e; } })())), /podobný JSON/);
  assert.match((() => { try { extractJson('bez závorek'); } catch (e) { return e.message; } })(), /není žádný JSON/);
  assert.match((() => { try { extractJson('42'); } catch (e) { return e.message; } })(), /ne objekt ani pole/);
});

test('extractJson: text plný nespárovaných závorek nezablokuje běh', () => {
  const started = process.hrtime.bigint();
  assert.throws(() => P.extractJson('['.repeat(30000) + 'x'), (e) => e.code === 'invalid_json');
  assert.throws(() => P.extractJson('{"a": "' + '{'.repeat(30000)), (e) => e.code === 'invalid_json');
  assert.ok(Number(process.hrtime.bigint() - started) / 1e9 < 5, 'hledání trvalo příliš dlouho');
});

// ------------------------------------------------------------------ OpenAI-kompatibilní
const openai = (f, extra = {}) =>
  P.createOpenAICompatibleProvider({ apiKey: KEY, baseUrl: 'https://api.example.test/v1/', models: { quick: 'm-quick', default: 'm-default', complex: 'm-complex' }, fetch: f, ...extra });

test('openai: tvar požadavku (URL, Authorization, zprávy, model podle úrovně)', async () => {
  const f = fakeFetch(() => jsonResponse(openaiBody('ahoj')));
  const p = openai(f);
  assert.equal(p.kind, 'openai-compatible');
  assert.deepEqual(await p.text('Řekni ahoj', { modelTier: 'complex' }), { text: 'ahoj', truncated: false });
  const c = f.calls[0];
  assert.equal(c.url, 'https://api.example.test/v1/chat/completions');
  assert.equal(c.init.method, 'POST');
  assert.deepEqual(c.headers, { 'content-type': 'application/json', authorization: `Bearer ${KEY}` });
  assert.deepEqual(c.body, { model: 'm-complex', messages: [{ role: 'user', content: 'Řekni ahoj' }] }); // bez max_tokens a response_format
  assert.equal(c.self, undefined);
  await p.text([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }], { modelTier: 'quick', maxTokens: 50 });
  assert.deepEqual(f.calls[1].body, { model: 'm-quick', max_tokens: 50, messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }] });
  // úplná adresa koncového bodu se nezdvojí
  const f2 = fakeFetch(() => jsonResponse(openaiBody()));
  await openai(f2, { baseUrl: 'http://localhost:1234/v1/chat/completions' }).text('x');
  assert.equal(f2.calls[0].url, 'http://localhost:1234/v1/chat/completions');
});

test('openai: json režim posílá response_format; bez zmínky o JSON přidá systémovou zprávu', async () => {
  const f = fakeFetch(() => jsonResponse(openaiBody('{"ok": true}')));
  const p = openai(f);
  assert.deepEqual(await p.json('Vrať JSON {"ok": true}'), { ok: true });
  assert.deepEqual(f.calls[0].body.response_format, { type: 'json_object' });
  assert.deepEqual(f.calls[0].body.messages, [{ role: 'user', content: 'Vrať JSON {"ok": true}' }]);
  assert.deepEqual(await p.json('Vrať objekt s polem ok'), { ok: true });
  assert.equal(f.calls[1].body.messages[0].role, 'system');
  assert.match(f.calls[1].body.messages[0].content, /JSON/);
  assert.deepEqual(f.calls[1].body.messages[1], { role: 'user', content: 'Vrať objekt s polem ok' });
  await p.text('obyčejný text');
  assert.ok(!('response_format' in f.calls[2].body));
  assert.equal(f.calls[2].body.messages.length, 1);
  // ohrady kolem JSON (některé servery response_format ignorují) se ořežou
  const fenced = openai(fakeFetch(() => jsonResponse(openaiBody('```json\n{"a": 2}\n```'))));
  assert.deepEqual(await fenced.json('JSON prosím'), { a: 2 });
});

test('openai: obrázek jde jako image_url s data URI za textem; images:false obrázky vypne', async () => {
  const f = fakeFetch(() => jsonResponse(openaiBody()));
  const p = openai(f);
  assert.ok((await p.limits()).images);
  await p.text('Co vidíš?', { images: [png()] });
  assert.deepEqual(f.calls[0].body.messages, [
    { role: 'user', content: [{ type: 'text', text: 'Co vidíš?' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG_B64}` } }] },
  ]);
  const noImages = openai(f, { images: false });
  assert.equal('images' in (await noImages.limits()), false);
  assertProviderError(await caught(noImages.text('x', { images: [png()] })), 'invalid_request');
  assert.equal(f.calls.length, 1);
  assertProviderError(await caught(p.text('x', { images: [new Blob(['x'], { type: 'text/plain' })] })), 'invalid_request');
});

test('openai: názvy modelů musí zadat uživatel, nic se nevymýšlí', async () => {
  const f = fakeFetch(() => jsonResponse(openaiBody()));
  const none = P.createOpenAICompatibleProvider({ apiKey: KEY, baseUrl: 'https://x.test/v1', fetch: f });
  for (const tier of TIER_LIST) {
    for (const method of ['text', 'json']) {
      const err = await caught(none[method]('JSON prosím', { modelTier: tier }));
      assertProviderError(err, 'invalid_request');
      assert.match(err.message, /název modelu/);
    }
  }
  assert.equal(f.calls.length, 0);
  // jen `default`: použije se i pro ostatní úrovně
  const onlyDefault = P.createOpenAICompatibleProvider({ baseUrl: 'https://x.test/v1', models: { default: 'jediny' }, fetch: f });
  await onlyDefault.text('x', { modelTier: 'quick' });
  assert.equal(f.calls[0].body.model, 'jediny');
  // jen `quick`: úroveň default model nemá
  const onlyQuick = P.createOpenAICompatibleProvider({ baseUrl: 'https://x.test/v1', models: { quick: 'q' }, fetch: f });
  assertProviderError(await caught(onlyQuick.text('x')), 'invalid_request');
  assert.deepEqual({ ...(await P.createOpenAICompatibleProvider({ baseUrl: 'https://x.test/v1', fetch: f }).models) }, {});
});

test('openai: chybí nebo je špatná adresa; klíč je nepovinný (místní servery)', async () => {
  const f = fakeFetch(() => jsonResponse(openaiBody('ok')));
  for (const baseUrl of [undefined, '', 'localhost:1234', 'ftp://x.test']) {
    assertProviderError(await caught(P.createOpenAICompatibleProvider({ baseUrl, models: { default: 'm' }, fetch: f }).text('x')), 'invalid_request');
  }
  assertProviderError(await caught(P.createOpenAICompatibleProvider({ baseUrl: 'https://x.test', models: { default: 'm' } }).text('x')), 'invalid_request'); // chybí fetch
  assertProviderError(await caught(openai(f, { apiKey: 'klíč s mezerou' }).text('x')), 'not_granted');
  assert.equal(f.calls.length, 0);
  const local = P.createOpenAICompatibleProvider({ baseUrl: 'http://localhost:11434/v1', models: { default: 'llama' }, fetch: f });
  assert.deepEqual(await local.text('x'), { text: 'ok', truncated: false });
  assert.deepEqual(f.calls[0].headers, { 'content-type': 'application/json' }); // bez klíče žádná autorizační hlavička
});

test('openai: čtení odpovědi (truncated, odmítnutí, části obsahu, tokeny, špatný tvar)', async () => {
  const run = async (body, method = 'text') => {
    const p = openai(fakeFetch(() => jsonResponse(body)));
    try {
      return { value: await p[method]('JSON prosím'), p };
    } catch (e) {
      return { error: e, p };
    }
  };
  const length = await run(openaiBody('{"a": [1', { choices: [{ index: 0, message: { role: 'assistant', content: '{"a": [1' }, finish_reason: 'length' }] }));
  assert.deepEqual(length.value, { text: '{"a": [1', truncated: true });
  assertProviderError((await run(openaiBody('{"a": 1}', { choices: [{ message: { content: '{"a": 1}' }, finish_reason: 'length' }] }), 'json')).error, 'invalid_json');

  const refusal = await run(openaiBody('', { choices: [{ message: { role: 'assistant', content: null, refusal: 'I cannot help with that.' }, finish_reason: 'stop' }] }));
  assertProviderError(refusal.error, 'refused');
  assert.match(refusal.error.message, /I cannot help/);
  assert.ok(!('text' in refusal.error));
  assertProviderError((await run(openaiBody('x', { choices: [{ message: { content: 'x' }, finish_reason: 'content_filter' }] }))).error, 'refused');

  const parts = await run(openaiBody('', { choices: [{ message: { content: [{ type: 'text', text: 'Ahoj ' }, { type: 'text', text: 'světe' }] }, finish_reason: 'stop' }] }));
  assert.deepEqual(parts.value, { text: 'Ahoj světe', truncated: false });

  for (const body of [openaiBody('   '), openaiBody('', { choices: [{ message: { content: null }, finish_reason: 'stop' }] })]) {
    assertProviderError((await run(body)).error, 'empty_completion');
  }
  for (const body of [{}, { choices: [] }, { choices: [{}] }, { choices: ['x'] }]) assertProviderError((await run(body)).error, 'upstream_error');

  const ok = await run(openaiBody('ok'));
  assert.deepEqual(ok.p.lastUsage, { inputTokens: 12, outputTokens: 5, model: 'm-default' });
  const noUsage = await run(openaiBody('ok', { usage: undefined }));
  assert.equal(noUsage.p.lastUsage, null);
});

test('openai: HTTP chyby se mapují na kódy rozhraní a klíč se z nich nikdy nedostane', async () => {
  const masked = `Incorrect API key provided: ${KEY.slice(0, 5)}****${KEY.slice(-4)}. You can find your API key at https://platform.openai.com/account/api-keys.`;
  const cases = [
    [401, { error: { message: masked, type: 'invalid_request_error', code: 'invalid_api_key' } }, 'not_granted'],
    [401, { error: { message: `Bad key ${KEY}` } }, 'not_granted'],
    [429, { error: { message: 'You exceeded your current quota', type: 'insufficient_quota', code: 'insufficient_quota' } }, 'rate_limited'],
    [400, { error: { message: "This model's maximum context length is 8192 tokens. However, your messages resulted in 9000 tokens.", code: 'context_length_exceeded' } }, 'prompt_too_large'],
    [400, { error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model.", type: 'invalid_request_error' } }, 'invalid_request'],
    [404, { error: { message: 'The model `x` does not exist' } }, 'invalid_request'],
    [500, { error: { message: `The server had an error ${KEY}` } }, 'upstream_error'],
    [503, 'Service Unavailable', 'upstream_error'],
    [413, { error: { message: 'too big' } }, 'prompt_too_large'],
  ];
  for (const [status, body, code] of cases) {
    const f = fakeFetch(() => (typeof body === 'string' ? textResponse(body, status) : jsonResponse(body, status)));
    const err = await caught(openai(f).text('x'));
    assertProviderError(err, code);
    assert.ok(!err.message.includes(KEY.slice(0, 12)));
    if (status === 401) assert.ok(!/Incorrect|Bad key/.test(err.message)); // u 401 se text ze serveru nepřebírá
    if (status === 400) assert.match(err.message, /context length|Unsupported parameter/);
  }
});

test('openai: zrušení a síťová chyba', async () => {
  const done = new AbortController();
  done.abort();
  const f = fakeFetch(() => jsonResponse(openaiBody()));
  assertProviderError(await caught(openai(f).text('x', { signal: done.signal })), 'cancelled');
  assert.equal(f.calls.length, 0);
  const down = fakeFetch(() => {
    throw new TypeError('Failed to fetch');
  });
  assertProviderError(await caught(openai(down).json('JSON prosím')), 'network_error');
  const withKey = fakeFetch(() => {
    throw new Error(`Authorization: Bearer ${KEY}`);
  });
  const err = await caught(openai(withKey).text('x'));
  assertProviderError(err, 'network_error');
  assert.ok(!err.message.includes(KEY));
});

// ------------------------------------------------------------------ wrapSample
function fakeSample(script = {}) {
  const calls = [];
  async function sample(input, opts) {
    calls.push({ method: 'sample', input, opts });
    return script.text ? script.text(input, opts) : { text: 'odpověď', truncated: false, modelTierApplied: 'default' };
  }
  if (script.json !== null) {
    sample.json = async (input, opts) => {
      calls.push({ method: 'json', input, opts });
      return script.json ? script.json(input, opts) : { ok: true };
    };
  }
  if (script.limits !== null) sample.limits = script.limits || (async () => ({ maxPromptBytes: 262144, images: { maxCount: 3, maxInputBytes: 1000, mediaTypes: ['image/png'] }, tools: { maxCount: 2 }, modelTiers: ['quick', 'default', 'complex'] }));
  return { sample, calls };
}

test('wrapSample: rozhraní a druh', () => {
  const p = P.wrapSample(fakeSample().sample);
  assert.equal(p.kind, 'claude-sample');
  assert.equal(typeof p.name, 'string');
});

test('wrapSample: text → sample, json → sample.json; modelTier, signal, onText a images se předají přímo', async () => {
  const { sample, calls } = fakeSample();
  const p = P.wrapSample(sample);
  const ctl = new AbortController();
  const onText = () => {};
  const image = png();
  const result = await p.text('vstup', { modelTier: 'quick', signal: ctl.signal, onText, images: [image], cache: false, maxTokens: 10, purpose: 'x', neznámé: 1 });
  assert.deepEqual(result, { text: 'odpověď', truncated: false }); // jen {text, truncated}
  assert.equal(calls[0].method, 'sample');
  assert.equal(calls[0].input, 'vstup');
  assert.deepEqual(Object.keys(calls[0].opts).sort(), ['cache', 'images', 'modelTier', 'onText', 'signal']);
  assert.equal(calls[0].opts.modelTier, 'quick');
  assert.equal(calls[0].opts.signal, ctl.signal);
  assert.equal(calls[0].opts.onText, onText);
  assert.equal(calls[0].opts.images[0], image);
  assert.equal(calls[0].opts.cache, false);

  const turns = [{ role: 'user', content: 'a' }];
  const value = await p.json(turns, { modelTier: 'complex' });
  assert.deepEqual(value, { ok: true });
  assert.equal(calls[1].method, 'json');
  assert.equal(calls[1].input, turns);
  assert.deepEqual(calls[1].opts, { modelTier: 'complex' });
});

test('wrapSample: cache se předá jen jako false, prázdné obrázky se vynechají, bez voleb jde prázdný objekt', async () => {
  const { sample, calls } = fakeSample();
  const p = P.wrapSample(sample);
  await p.text('x');
  await p.text('x', { cache: true, images: [] });
  await p.text('x', { cache: { gcTime: 1000 }, images: { length: 0 } });
  await p.text('x', { cache: undefined, images: undefined, modelTier: undefined, signal: null, onText: 'ne' });
  for (const c of calls) assert.deepEqual(c.opts, {});
  const single = png();
  await p.text('x', { images: single }); // jeden Blob bez pole
  assert.equal(calls.at(-1).opts.images, single);
});

test('wrapSample: chyby platformy se předají beze změny (stejný objekt, i neznámé kódy)', async () => {
  for (const original of [
    { code: 'rate_limited', message: 'limit' },
    { code: 'not_granted', message: 'ne' },
    { code: 'image_rejected', message: 'velký' },
    { code: 'session_expired', message: 'vypršelo' },
    { code: 'invalid_json', message: 'x', text: 'syrová odpověď' },
    { code: 'cancelled', message: 'zrušeno', text: 'část' },
  ]) {
    const { sample } = fakeSample({
      text: async () => {
        throw original;
      },
      json: async () => {
        throw original;
      },
    });
    const p = P.wrapSample(sample);
    assert.equal(await caught(p.text('x')), original);
    assert.equal(await caught(p.json('x')), original);
  }
});

test('wrapSample: limits() vezme schopnosti platformy, jinak vrátí bezpečný výchozí stav', async () => {
  const p = P.wrapSample(fakeSample().sample);
  assert.deepEqual(await p.limits(), { maxPromptBytes: 262144, images: { maxCount: 3, maxInputBytes: 1000, mediaTypes: ['image/png'] } });
  const noImages = P.wrapSample(fakeSample({ limits: async () => ({ maxPromptBytes: 1000 }) }).sample);
  assert.deepEqual(await noImages.limits(), { maxPromptBytes: 1000 });
  const rejecting = P.wrapSample(fakeSample({ limits: async () => { throw { code: 'not_declared', message: 'x' }; } }).sample);
  assert.deepEqual(await rejecting.limits(), { maxPromptBytes: 262144 });
  const missing = P.wrapSample(fakeSample({ limits: null }).sample);
  assert.deepEqual(await missing.limits(), { maxPromptBytes: 262144 });
});

test('wrapSample: bez sample.json se JSON vyjme z textu; bez sample je poskytovatel, který odmítá not_granted', async () => {
  const { sample } = fakeSample({ json: null, text: async () => ({ text: 'Tady: ```json\n{"a": 1}\n```', truncated: false }) });
  assert.deepEqual(await P.wrapSample(sample).json('x'), { a: 1 });
  const bad = fakeSample({ json: null, text: async () => ({ text: 'nic', truncated: false }) });
  assertProviderError(await caught(P.wrapSample(bad.sample).json('x')), 'invalid_json');
  for (const missing of [undefined, null, {}, 'sample']) {
    const p = P.wrapSample(missing);
    assert.equal(p.kind, 'claude-sample');
    assertProviderError(await caught(p.text('x')), 'not_granted');
    assertProviderError(await caught(p.json('x')), 'not_granted');
    assert.equal((await p.limits()).maxPromptBytes, 262144);
  }
});

// ------------------------------------------------------------------ odhad tokenů a ceny
test('estimateTokens = ceil(délka / 3,2)', () => {
  assert.equal(P.estimateTokens(''), 0);
  assert.equal(P.estimateTokens(undefined), 0);
  assert.equal(P.estimateTokens(null), 0);
  assert.equal(P.estimateTokens('a'), 1);
  assert.equal(P.estimateTokens('a'.repeat(32)), 10);
  assert.equal(P.estimateTokens('a'.repeat(33)), 11);
  assert.equal(P.estimateTokens('ěščřž'), 2);
  assert.equal(P.estimateTokens(12345), 2);
  for (const n of [0, 1, 7, 100, 3200, 99999]) assert.equal(P.estimateTokens('x'.repeat(n)), Math.ceil(n / 3.2));
});

test('estimateCostUsd: cena podle modelu, dlouhý kontext Haiku, neznámé je null', () => {
  const cost = (model, inputTokens, outputTokens, provider = 'anthropic') => P.estimateCostUsd({ provider, model, inputTokens, outputTokens });
  assert.equal(cost('claude-opus-5-5', 1000, 500), 0.014);
  assert.equal(cost('claude-sonnet-5-5', 5000, 1000), 0.02);
  assert.equal(cost('claude-haiku-5-5', 10000, 2000), 0.002);
  assert.equal(cost('claude-opus-5-5', 1_000_000, 0), 4);
  assert.equal(cost('claude-opus-5-5', 0, 1_000_000), 20);
  assert.equal(cost('claude-opus-5-5', 0, 0), 0);
  // Haiku nad 100 000 vstupních tokenů: vyšší sazby vstupu i výstupu
  const short = cost('claude-haiku-5-5', 100_000, 0);
  const long = cost('claude-haiku-5-5', 100_001, 0);
  assert.equal(short, 0.01);
  assert.ok(Math.abs(long - (100_001 * 0.5) / 1e6) < 1e-6);
  assert.ok(long > short * 4);
  assert.equal(cost('claude-haiku-5-5', 100_001, 1_000_000), Math.round(100_001 * 0.5 + 1_000_000 * 2.5) / 1e6);
  // neznámé je null, nikdy nula
  assert.equal(cost('claude-neznamy-9', 10, 10), null);
  assert.equal(cost('', 10, 10), null);
  assert.equal(cost('constructor', 10, 10), null);
  assert.equal(cost('__proto__', 10, 10), null);
  assert.equal(cost('claude-opus-5-5', 10, 10, 'openai-compatible'), null); // jiný poskytovatel může mít jiné ceny
  assert.equal(cost('claude-opus-5-5', 10, 10, 'claude-sample'), null); // sample účtuje limit v Claude, ne dolary
  assert.equal(P.estimateCostUsd(null), null);
  assert.equal(P.estimateCostUsd({}), null);
  assert.equal(P.estimateCostUsd({ provider: 'anthropic', model: 'claude-opus-5-5' }), 0);
});

// ------------------------------------------------------------------ ledger
function entryOf(over = {}) {
  return { at: 1000, provider: 'anthropic', tier: 'default', model: 'claude-sonnet-5-5', inputChars: 100, outputChars: 50, inputTokens: 5000, outputTokens: 1000, estimated: false, images: 0, ok: true, ms: 120, purpose: 'advice', ...over };
}

test('ledger: kumulativní součty po úrovních, odhad ceny a podíl odhadnutých záznamů', () => {
  const ledger = P.createLedger({ now: () => 1000 });
  const empty = ledger.summary();
  assert.equal(empty.calls, 0);
  assert.equal(empty.estimatedShare, 0);
  assert.equal(empty.costUsd, 0);
  assert.equal(empty.windowIncomplete, false);
  assert.deepEqual(Object.keys(empty.byTier), TIER_LIST);

  ledger.record(entryOf({ tier: 'quick', model: 'claude-haiku-5-5', inputTokens: 10000, outputTokens: 2000, images: 1, ms: 100 }));
  ledger.record(entryOf());
  ledger.record(entryOf({ tier: 'complex', model: 'claude-opus-5-5', inputTokens: 1000, outputTokens: 500, ok: false, ms: 300 }));
  ledger.record(entryOf({ provider: 'claude-sample', model: '', inputTokens: 300, outputTokens: 100, estimated: true, ms: 50 }));

  const s = ledger.summary();
  assert.equal(s.calls, 4);
  assert.equal(s.okCalls, 3);
  assert.equal(s.failedCalls, 1);
  assert.equal(s.inputTokens, 16300);
  assert.equal(s.outputTokens, 3600);
  assert.equal(s.inputChars, 400);
  assert.equal(s.outputChars, 200);
  assert.equal(s.images, 1);
  assert.equal(s.ms, 570);
  assert.equal(s.costUsd, 0.036); // 0,002 + 0,02 + 0,014; záznam bez ceny se nepočítá
  assert.equal(s.unpricedCalls, 1);
  assert.equal(s.estimatedCalls, 1);
  assert.equal(s.estimatedShare, 0.25);
  assert.equal(s.byTier.quick.calls, 1);
  assert.equal(s.byTier.quick.costUsd, 0.002);
  assert.equal(s.byTier.quick.images, 1);
  assert.equal(s.byTier.default.calls, 2);
  assert.equal(s.byTier.default.costUsd, 0.02);
  assert.equal(s.byTier.default.unpricedCalls, 1);
  assert.equal(s.byTier.default.estimatedShare, 0.5);
  assert.equal(s.byTier.complex.costUsd, 0.014);
  assert.equal(s.byTier.complex.failedCalls, 1);
  assert.match(s.pricesNote, /ověř/i);
  assert.equal(s.sinceMs, null);

  // součet desetinných čísel se v souhrnu zaokrouhlí (0,1 + 0,2 by jinak dalo 0,30000000000000004)
  const noisy = P.createLedger({ now: () => 1 });
  noisy.record(entryOf({ tier: 'complex', model: 'claude-opus-5-5', inputTokens: 25000, outputTokens: 0 }));
  noisy.record(entryOf({ tier: 'complex', model: 'claude-opus-5-5', inputTokens: 50000, outputTokens: 0 }));
  assert.equal(noisy.summary().costUsd, 0.3);
  assert.equal(noisy.summary().byTier.complex.costUsd, 0.3);
});

test('ledger: record sjednotí záznam (neznámá úroveň, zaokrouhlení, výchozí čas, popisek) a vrací kopii', () => {
  const ledger = P.createLedger({ now: () => 777 });
  const stored = ledger.record({ tier: 'zzz', inputTokens: 12.6, outputTokens: -4, provider: 'anthropic', purpose: 'p'.repeat(100) });
  assert.equal(stored.tier, 'default');
  assert.equal(stored.inputTokens, 13);
  assert.equal(stored.outputTokens, 0);
  assert.equal(stored.at, 777);
  assert.equal(stored.ok, true);
  assert.equal(stored.estimated, false);
  assert.equal(stored.purpose.length, 60);
  stored.inputTokens = 99999; // zásah do vrácené kopie nemění uložený záznam
  assert.equal(ledger.toJSON().entries[0].inputTokens, 13);
  assert.equal(ledger.record({ at: 5 }).at, 5);
  assert.equal(P.createLedger().record({}).at, 0); // bez hodin modul čas nevymýšlí
  assert.equal(typeof ledger.now, 'function');
  assert.equal(ledger.now(), 777);
  assert.equal(ledger.summary().calls, 2);
});

test('ledger: drží nejvýš 500 záznamů, nejstarší zahazuje a součty zůstávají', () => {
  let t = 0;
  const ledger = P.createLedger({ now: () => ++t });
  for (let i = 1; i <= 520; i++) ledger.record(entryOf({ at: i, purpose: `n${i}`, inputTokens: 10, outputTokens: 1, model: 'claude-haiku-5-5', tier: 'quick' }));
  const s = ledger.summary();
  assert.equal(s.calls, 520); // kumulativně, ne jen držené
  assert.equal(s.inputTokens, 5200);
  assert.equal(s.byTier.quick.calls, 520);
  assert.equal(s.retainedEntries, 500);
  assert.equal(s.droppedEntries, 20);
  const json = ledger.toJSON();
  assert.equal(json.entries.length, 500);
  assert.equal(json.entries[0].purpose, 'n21'); // nejstarších 20 je pryč
  assert.equal(json.entries.at(-1).purpose, 'n520');
  assert.equal(json.dropped, 20);

  // okno od `sinceMs` se počítá ze držených záznamů; sahá-li před nejstarší držený, je označené jako neúplné
  const recent = ledger.summary({ sinceMs: 300 });
  assert.equal(recent.calls, 221); // záznamy 300 až 520
  assert.equal(recent.windowIncomplete, false);
  assert.equal(recent.sinceMs, 300);
  const wide = ledger.summary({ sinceMs: 10 });
  assert.equal(wide.calls, 500);
  assert.equal(wide.windowIncomplete, true);
  assert.equal(ledger.summary({ sinceMs: 'ne' }).calls, 520);
  assert.equal(ledger.summary({ sinceMs: NaN }).calls, 520);
  assert.equal(ledger.summary({ sinceMs: 9999 }).calls, 0);
});

test('ledger: toJSON a load jdou tam a zpět (objekt i řetězec, i přes JSON.stringify)', () => {
  const ledger = P.createLedger({ now: () => 5 });
  for (let i = 0; i < 530; i++) ledger.record(entryOf({ at: i, purpose: `n${i}`, tier: TIER_LIST[i % 3], model: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'][i % 3] }));
  ledger.record(entryOf({ provider: 'claude-sample', model: '', estimated: true }));
  const wire = JSON.parse(JSON.stringify(ledger)); // JSON.stringify zavolá toJSON()

  for (const form of [wire, JSON.stringify(wire)]) {
    const copy = P.createLedger({ now: () => 5 });
    assert.deepEqual(copy.load(form), { ok: true, errors: [], entries: 500 });
    assert.deepEqual(copy.summary(), ledger.summary());
    assert.deepEqual(copy.toJSON(), ledger.toJSON());
    assert.equal(copy.summary().calls, 531); // zahozené záznamy v součtech zůstaly
    copy.record(entryOf()); // a ledger po načtení dál funguje
    assert.equal(copy.summary().calls, 532);
  }
  const before = ledger.summary();
  wire.entries[0].purpose = 'změněno'; // toJSON dal kopii, ledger se nezměnil
  assert.deepEqual(ledger.summary(), before);
  assert.notEqual(ledger.toJSON().entries[0].purpose, 'změněno');
});

test('ledger: load odmítne nesmysl a dosavadní stav nechá být, cizí data očistí', () => {
  const ledger = P.createLedger({ now: () => 1 });
  ledger.record(entryOf());
  const before = ledger.toJSON();
  for (const bad of [null, undefined, 'nesmysl', '{', 42, [], {}, { entries: 'x' }, { version: 2, entries: [] }]) {
    const r = ledger.load(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.ok(r.errors.length > 0);
    assert.deepEqual(ledger.toJSON(), before);
  }
  const dirty = JSON.parse('{"version":1,"entries":[{"at":"x","tier":"hax","provider":"anthropic","model":5,"inputTokens":-5,"outputTokens":1e999,"ok":"no","estimated":"ano","__proto__":{"polluted":true},"constructor":"x"},"nesmysl",null,7]}');
  assert.deepEqual(ledger.load(dirty), { ok: true, errors: [], entries: 1 });
  const [e] = ledger.toJSON().entries;
  assert.deepEqual(e, { at: 0, provider: 'anthropic', tier: 'default', model: '', inputChars: 0, outputChars: 0, inputTokens: 0, outputTokens: 0, estimated: false, images: 0, ok: true, ms: 0, purpose: '' });
  assert.equal({}.polluted, undefined);
  assert.equal(ledger.summary().calls, 1);

  // počítadla, která nesedí se záznamy, se přepočítají ze záznamů
  const lying = { version: 1, entries: [entryOf(), entryOf()], totals: { all: { calls: 1 }, tiers: {} } };
  assert.equal(ledger.load(lying).ok, true);
  assert.equal(ledger.summary().calls, 2);
  // záznamů v souboru víc než 500: drží se posledních 500, zbytek je „zahozený“
  const many = { version: 1, entries: Array.from({ length: 510 }, (_, i) => entryOf({ purpose: `n${i}` })) };
  assert.deepEqual(ledger.load(many), { ok: true, errors: [], entries: 500 });
  assert.equal(ledger.summary().droppedEntries, 10);
  assert.equal(ledger.toJSON().entries[0].purpose, 'n10');
});

test('ledger: clear vymaže všechno', () => {
  const ledger = P.createLedger({ now: () => 1 });
  for (let i = 0; i < 600; i++) ledger.record(entryOf());
  ledger.clear();
  assert.equal(ledger.summary().calls, 0);
  assert.equal(ledger.summary().droppedEntries, 0);
  assert.deepEqual(ledger.toJSON().entries, []);
});

// ------------------------------------------------------------------ withLedger
function fakeProvider(impl = {}) {
  const calls = [];
  const provider = {
    name: 'Fake',
    kind: 'anthropic',
    models: { quick: 'claude-haiku-5-5', default: 'claude-sonnet-5-5', complex: 'claude-opus-5-5' },
    lastUsage: null,
    async limits() {
      return { maxPromptBytes: 100 };
    },
    async text(input, opts) {
      calls.push({ method: 'text', input, opts });
      return impl.text ? impl.text(provider, input, opts) : { text: 'odpověď', truncated: false };
    },
    async json(input, opts) {
      calls.push({ method: 'json', input, opts });
      return impl.json ? impl.json(provider, input, opts) : { ok: true };
    },
  };
  provider.calls = calls;
  return provider;
}

test('withLedger: zapíše úspěšné volání (čas, znaky, obrázky, tokeny z lastUsage, účel)', async () => {
  let t = 100;
  const ledger = P.createLedger({ now: () => t });
  const provider = fakeProvider({
    text: async (self) => {
      t += 25;
      self.lastUsage = { inputTokens: 700, outputTokens: 90 };
      return { text: 'odpověď', truncated: false };
    },
  });
  const wrapped = P.withLedger(provider, ledger, { purpose: 'rada' });
  assert.deepEqual(await wrapped.text('abcdefghij', { modelTier: 'complex', images: [png(), png()] }), { text: 'odpověď', truncated: false });
  const [e] = ledger.toJSON().entries;
  assert.deepEqual(e, { at: 125, provider: 'anthropic', tier: 'complex', model: 'claude-opus-5-5', inputChars: 10, outputChars: 7, inputTokens: 700, outputTokens: 90, estimated: false, images: 2, ok: true, ms: 25, purpose: 'rada' });
  assert.equal(ledger.summary().costUsd, Math.round(700 * 4 + 90 * 20) / 1e6);
  assert.deepEqual(wrapped.lastUsage, provider.lastUsage); // obal ukazuje na poslední záznam poskytovatele
});

test('withLedger: znaky vstupu z pole zpráv; přesné tokeny a model z onUsage; zpětné volání uživatele zůstává', async () => {
  const ledger = P.createLedger({ now: () => 1 });
  const provider = fakeProvider({
    json: async (self, input, opts) => {
      opts.onUsage({ inputTokens: 7, outputTokens: 3, model: 'claude-haiku-5-5' });
      opts.onText({ text: '```json\n{"a":1}\n```', delta: '```json\n{"a":1}\n```' });
      return { a: 1 };
    },
  });
  const wrapped = P.withLedger(provider, ledger);
  const seenText = [];
  const seenUsage = [];
  await wrapped.json([{ role: 'user', content: 'abc' }, { role: 'assistant', content: 'de' }, { role: 'user', content: 'f' }], { modelTier: 'quick', onText: (u) => seenText.push(u.text), onUsage: (u) => seenUsage.push(u) });
  const [e] = ledger.toJSON().entries;
  assert.equal(e.inputChars, 6);
  assert.equal(e.outputChars, '```json\n{"a":1}\n```'.length); // syrová odpověď, ne přeformátovaný JSON
  assert.equal(e.inputTokens, 7);
  assert.equal(e.outputTokens, 3);
  assert.equal(e.estimated, false);
  assert.equal(e.model, 'claude-haiku-5-5');
  assert.deepEqual(seenText, ['```json\n{"a":1}\n```']);
  assert.equal(seenUsage.length, 1);
});

test('withLedger: bez hlášených tokenů je odhad ceil(znaky / 3,2) a estimated:true', async () => {
  const ledger = P.createLedger({ now: () => 1 });
  const provider = fakeProvider({ text: async () => ({ text: 'x'.repeat(64), truncated: false }), json: async () => ({ klic: 'hodnota' }) });
  const wrapped = P.withLedger(provider, ledger);
  await wrapped.text('y'.repeat(32));
  await wrapped.json('z'.repeat(33)); // poskytovatel nevolá onText: délka výstupu je z JSON.stringify(hodnota)
  const [t, j] = ledger.toJSON().entries;
  assert.deepEqual([t.inputTokens, t.outputTokens, t.estimated], [10, 20, true]);
  assert.deepEqual([j.inputTokens, j.outputTokens, j.outputChars, j.estimated], [11, Math.ceil(JSON.stringify({ klic: 'hodnota' }).length / 3.2), JSON.stringify({ klic: 'hodnota' }).length, true]);
  assert.equal(ledger.summary().estimatedShare, 1);
});

test('withLedger: záznam i při chybě; chyba se předá beze změny; co se k modelu nedostalo, nestojí tokeny', async () => {
  const ledger = P.createLedger({ now: () => 1 });
  const errors = {
    upstream: { code: 'upstream_error', message: 'x' },
    limited: { code: 'rate_limited', message: 'x' },
    big: { code: 'prompt_too_large', message: 'x' },
    bad: { code: 'invalid_request', message: 'x' },
    denied: { code: 'not_granted', message: 'x' },
    json: { code: 'invalid_json', message: 'x', text: 'syrová odpověď' },
  };
  const provider = fakeProvider({
    text: async (self, input) => {
      throw errors[input];
    },
  });
  // kódy `sample`, u nichž platforma nic neúčtuje; a omezení limitu s rozepsanou odpovědí, která už něco stála
  for (const code of ['session_expired', 'image_rejected', 'images_unavailable', 'sampling_disabled', 'not_declared', 'capability_removed', 'transform_error']) errors[code] = { code, message: 'x' };
  errors.partial = { code: 'rate_limited', message: 'x', text: 'rozepsaná odpověď' };
  const wrapped = P.withLedger(provider, ledger);
  for (const key of Object.keys(errors)) assert.equal(await caught(wrapped.text(key)), errors[key]); // tentýž objekt
  const entries = ledger.toJSON().entries;
  assert.equal(entries.length, Object.keys(errors).length);
  assert.ok(entries.every((e) => e.ok === false));
  const byInput = Object.fromEntries(Object.keys(errors).map((k, i) => [k, entries[i]]));
  assert.deepEqual([byInput.upstream.inputTokens, byInput.upstream.estimated], [Math.ceil('upstream'.length / 3.2), true]);
  for (const k of ['limited', 'big', 'bad', 'denied', 'session_expired', 'image_rejected', 'images_unavailable', 'sampling_disabled', 'not_declared', 'capability_removed', 'transform_error']) {
    assert.deepEqual([byInput[k].inputTokens, byInput[k].outputTokens, byInput[k].estimated], [0, 0, false], k);
  }
  assert.equal(byInput.json.outputChars, 'syrová odpověď'.length);
  assert.deepEqual([byInput.partial.estimated, byInput.partial.outputTokens > 0, byInput.partial.inputTokens > 0], [true, true, true]);
  assert.equal(ledger.summary().failedCalls, entries.length);
});

test('withLedger: neúspěch zápisu do ledgeru volání nerozbije; obalit dvakrát nezapočítá dvakrát', async () => {
  const broken = { record: () => { throw new Error('úložiště plné'); } };
  assert.deepEqual(await P.withLedger(fakeProvider(), broken).text('x'), { text: 'odpověď', truncated: false });

  const ledger = P.createLedger({ now: () => 1 });
  const once = P.withLedger(fakeProvider(), ledger);
  assert.equal(P.withLedger(once, ledger), once);
  await P.withLedger(once, ledger).text('x');
  assert.equal(ledger.summary().calls, 1);
  const other = P.createLedger({ now: () => 1 });
  await P.withLedger(once, other).text('x'); // jiný ledger je jiná věc: zapíše se do obou
  assert.equal(other.summary().calls, 1);
  assert.equal(ledger.summary().calls, 2);
  // bez ledgeru se poskytovatel vrací beze změny
  const bare = fakeProvider();
  assert.equal(P.withLedger(bare, null), bare);
  assert.equal(P.withLedger(bare, {}), bare);
});

test('withLedger: účel jde přepsat u volání a nepředává se dál; volby uživatele se nemění', async () => {
  const ledger = P.createLedger({ now: () => 1 });
  const provider = fakeProvider();
  const wrapped = P.withLedger(provider, ledger, { purpose: 'výchozí' });
  const mine = { modelTier: 'quick', purpose: 'plán' };
  await wrapped.text('x', mine);
  await wrapped.text('x');
  await wrapped.text('x', { purpose: '' });
  await P.withLedger(fakeProvider(), ledger).text('x');
  assert.deepEqual(ledger.toJSON().entries.map((e) => e.purpose), ['plán', 'výchozí', 'výchozí', '']);
  assert.deepEqual(mine, { modelTier: 'quick', purpose: 'plán' });
  assert.ok(!('purpose' in provider.calls[0].opts));
  assert.equal(wrapped.name, 'Fake');
  assert.equal(wrapped.kind, 'anthropic');
  assert.deepEqual(await wrapped.limits(), { maxPromptBytes: 100 });
  assert.equal(wrapped.ledger, ledger);
});

test('withLedger + skutečný adaptér Anthropic: tokeny a model z odpovědi, cena, účtuje se i neplatný JSON', async () => {
  const ledger = P.createLedger({ now: () => 50 });
  const f = fakeFetch(
    () => jsonResponse(anthropicBody('{"ok": true}', { model: 'claude-haiku-5-5', usage: { input_tokens: 11, output_tokens: 7 } })),
    () => jsonResponse(anthropicBody('Tohle není JSON', { usage: { input_tokens: 20, output_tokens: 4 } })),
    () => jsonResponse(anthropicError('rate_limit_error', 'slow'), 429)
  );
  const p = P.withLedger(anthropic(f), ledger, { purpose: 'zkouška' });
  assert.deepEqual(await p.json('JSON prosím', { modelTier: 'quick', images: [png()] }), { ok: true });
  assertProviderError(await caught(p.json('x')), 'invalid_json');
  assertProviderError(await caught(p.text('x')), 'rate_limited');
  const [a, b, c] = ledger.toJSON().entries;
  assert.deepEqual([a.provider, a.tier, a.model, a.inputTokens, a.outputTokens, a.estimated, a.images, a.ok], ['anthropic', 'quick', 'claude-haiku-5-5', 11, 7, false, 1, true]);
  assert.deepEqual([b.model, b.inputTokens, b.outputTokens, b.estimated, b.ok], ['claude-sonnet-5-5', 20, 4, false, false]);
  assert.equal(b.outputChars, 'Tohle není JSON'.length);
  assert.deepEqual([c.inputTokens, c.outputTokens, c.estimated, c.ok], [0, 0, false, false]);
  const s = ledger.summary();
  assert.equal(s.costUsd, Math.round(11 * 0.1 + 7 * 0.5 + 20 * 2 + 4 * 10) / 1e6);
  assert.equal(s.calls, 3);
  assert.equal(s.estimatedShare, 0);
});

test('withLedger: souběžná volání dostanou každé své tokeny (nejde o sdílené lastUsage)', async () => {
  const ledger = P.createLedger({ now: () => 1 });
  const slowQuick = function (url, init) {
    const body = JSON.parse(init.body);
    const quick = body.model === 'claude-haiku-5-5';
    const reply = jsonResponse(anthropicBody('ok', { model: body.model, usage: quick ? { input_tokens: 100, output_tokens: 10 } : { input_tokens: 5, output_tokens: 1 } }));
    return quick ? new Promise((resolve) => setTimeout(() => resolve(reply), 30)) : Promise.resolve(reply);
  };
  const p = P.withLedger(anthropic(slowQuick), ledger);
  await Promise.all([p.text('a', { modelTier: 'quick' }), p.text('b', { modelTier: 'complex' })]);
  const byTier = Object.fromEntries(ledger.toJSON().entries.map((e) => [e.tier, e]));
  assert.deepEqual([byTier.quick.inputTokens, byTier.quick.outputTokens], [100, 10]);
  assert.deepEqual([byTier.complex.inputTokens, byTier.complex.outputTokens], [5, 1]);
});

test('withLedger: neúspěšné volání vedle úspěšného nedostane jeho tokeny (lastUsage je sdílené)', async () => {
  const ledger = P.createLedger({ now: () => 1 });
  const mixed = function (url, init) {
    const body = JSON.parse(init.body);
    if (body.model === 'claude-haiku-5-5') return Promise.resolve(jsonResponse(anthropicBody('ok', { model: body.model, usage: { input_tokens: 100, output_tokens: 10 } })));
    // volání na Opus selže později, až když to rychlé úspěšné dávno doběhlo a nastavilo lastUsage
    return new Promise((resolve) => setTimeout(() => resolve(jsonResponse(anthropicError('rate_limit_error', 'slow'), 429)), 30));
  };
  const p = P.withLedger(anthropic(mixed), ledger);
  assert.equal(p.reportsUsage, true);
  const [failed, ok] = await Promise.allSettled([p.text('a', { modelTier: 'complex' }), p.text('b', { modelTier: 'quick' })]);
  assert.equal(failed.status, 'rejected');
  assert.equal(ok.status, 'fulfilled');
  const byTier = Object.fromEntries(ledger.toJSON().entries.map((e) => [e.tier, e]));
  assert.deepEqual([byTier.quick.inputTokens, byTier.quick.outputTokens, byTier.quick.ok], [100, 10, true]);
  assert.deepEqual([byTier.complex.inputTokens, byTier.complex.outputTokens, byTier.complex.ok, byTier.complex.estimated], [0, 0, false, false]);
  assert.equal(ledger.summary().inputTokens, 100); // nic se nezapočítalo dvakrát

  // poskytovatel bez příznaku (cizí implementace) se čte z lastUsage, jak stanoví kontrakt
  const foreign = fakeProvider({
    text: async (self) => {
      self.lastUsage = { inputTokens: 3, outputTokens: 2 };
      return { text: 'x', truncated: false };
    },
  });
  const ledger2 = P.createLedger({ now: () => 1 });
  await P.withLedger(foreign, ledger2).text('y');
  assert.deepEqual([ledger2.toJSON().entries[0].inputTokens, ledger2.toJSON().entries[0].estimated], [3, false]);
});

test('withLedger + wrapSample: bez hlášených tokenů je odhad, cena je neznámá', async () => {
  const ledger = P.createLedger({ now: () => 1 });
  const { sample } = fakeSample({ text: async () => ({ text: 'x'.repeat(16), truncated: false }) });
  const p = P.withLedger(P.wrapSample(sample), ledger, { purpose: 'plán' });
  await p.text('y'.repeat(32), { modelTier: 'quick' });
  await p.json('z', { modelTier: 'complex' });
  const [t, j] = ledger.toJSON().entries;
  assert.deepEqual([t.provider, t.tier, t.model, t.inputTokens, t.estimated, t.ok], ['claude-sample', 'quick', '', 10, true, true]);
  assert.equal(j.tier, 'complex');
  const s = ledger.summary();
  assert.equal(s.calls, 2);
  assert.equal(s.unpricedCalls, 2);
  assert.equal(s.costUsd, 0);
  assert.equal(s.estimatedShare, 1);
});

// ------------------------------------------------------------------ blobToBase64
test('blobToBase64 v Node: Buffer, i větve pro prohlížeč (btoa po blocích)', async () => {
  assert.equal(await P.blobToBase64(png()), PNG_B64);
  assert.equal(await P.blobToBase64(new Blob([])), '');
  assert.equal(await P.blobToBase64(new File([PNG_BYTES], 'a.png', { type: 'image/png' })), PNG_B64);
  const all = Uint8Array.from({ length: 256 }, (_, i) => i);
  assert.equal(await P.blobToBase64(new Blob([all])), Buffer.from(all).toString('base64'));
  // větší než jeden blok (32 KiB), aby se vyzkoušelo dělení
  const big = Uint8Array.from({ length: 100_003 }, (_, i) => (i * 31 + 7) % 256);
  const expected = Buffer.from(big).toString('base64');
  assert.equal(await P.blobToBase64(new Blob([big])), expected);
  // v prohlížeči Buffer neexistuje: tutéž funkci projdeme s Bufferem skrytým
  const saved = globalThis.Buffer;
  let viaBtoa;
  let viaBtoaSmall;
  try {
    globalThis.Buffer = undefined;
    assert.equal(typeof Buffer, 'undefined');
    viaBtoa = await P.blobToBase64(new Blob([big]));
    viaBtoaSmall = await P.blobToBase64(png());
  } finally {
    globalThis.Buffer = saved;
  }
  assert.equal(viaBtoa, expected);
  assert.equal(viaBtoaSmall, PNG_B64);
  assert.equal(typeof Buffer, 'function');
});

// ------------------------------------------------------------------ createProvider
test('createProvider: vybere adaptér podle druhu (i přezdívky a velikosti písmen)', async () => {
  const f = fakeFetch(() => jsonResponse(anthropicBody('x')));
  const { sample } = fakeSample();
  assert.equal(P.createProvider({ kind: 'anthropic', apiKey: KEY }, { fetch: f }).kind, 'anthropic');
  assert.equal(P.createProvider({ kind: 'ANTHROPIC', apiKey: KEY }, { fetch: f }).kind, 'anthropic');
  assert.equal(P.createProvider({ kind: 'openai', baseUrl: 'https://x.test/v1', models: { default: 'm' } }, { fetch: f }).kind, 'openai-compatible');
  assert.equal(P.createProvider({ kind: 'openai-compatible', baseUrl: 'https://x.test/v1', models: { default: 'm' } }, { fetch: f }).kind, 'openai-compatible');
  assert.equal(P.createProvider({ kind: 'sample' }, { sample }).kind, 'claude-sample');
  assert.equal(P.createProvider({ kind: 'claude-sample' }, { sample }).kind, 'claude-sample');

  // nastavení se předá adaptéru a fetch z deps se použije
  const a = P.createProvider({ kind: 'anthropic', apiKey: KEY, models: { quick: 'claude-haiku-5-5' }, baseUrl: 'https://proxy.test', version: '2099-01-01' }, { fetch: f });
  await a.text('x', { modelTier: 'quick' });
  assert.equal(f.calls[0].url, 'https://proxy.test/v1/messages');
  assert.equal(f.calls[0].headers['anthropic-version'], '2099-01-01');
  // sample se použije z deps, ostatní volby bez vlivu
  assert.deepEqual(await P.createProvider({ kind: 'sample' }, { sample }).text('ahoj'), { text: 'odpověď', truncated: false });
});

test('createProvider: špatná konfigurace nevyhodí výjimku, volání skončí chybou rozhraní', async () => {
  for (const config of [undefined, null, {}, { kind: 'gemini' }, { kind: 42 }, 'anthropic']) {
    const p = P.createProvider(config, undefined);
    assert.equal(typeof p.kind, 'string');
    assertProviderError(await caught(p.text('x')), 'invalid_request');
    assertProviderError(await caught(p.json('x')), 'invalid_request');
    assert.equal((await p.limits()).maxPromptBytes, 262144);
  }
  const noSample = P.createProvider({ kind: 'sample' }, {});
  assertProviderError(await caught(noSample.text('x')), 'not_granted');
  const noFetch = P.createProvider({ kind: 'anthropic', apiKey: KEY }, {});
  assertProviderError(await caught(noFetch.text('x')), 'invalid_request');
  const noKey = P.createProvider({ kind: 'anthropic' }, { fetch: fakeFetch(() => jsonResponse(anthropicBody())) });
  assertProviderError(await caught(noKey.text('x')), 'not_granted');
});

test('createProvider: s ledgerem vrací poskytovatele obaleného měřením', async () => {
  const ledger = P.createLedger({ now: () => 9 });
  const f = fakeFetch(() => jsonResponse(anthropicBody('{"a": 1}')));
  const p = P.createProvider({ kind: 'anthropic', apiKey: KEY }, { fetch: f, ledger, purpose: 'nastavení' });
  assert.equal(p.ledger, ledger);
  assert.deepEqual(await p.json('x', { modelTier: 'complex' }), { a: 1 });
  const [e] = ledger.toJSON().entries;
  assert.deepEqual([e.provider, e.tier, e.model, e.purpose, e.inputTokens, e.at], ['anthropic', 'complex', 'claude-sonnet-5-5', 'nastavení', 11, 9]);
  // špatná konfigurace se do ledgeru také zapíše jako neúspěšné volání
  const bad = P.createProvider({ kind: 'nic' }, { ledger });
  await caught(bad.text('x'));
  assert.equal(ledger.summary().failedCalls, 1);
  // sample přes createProvider s ledgerem
  const viaSample = P.createProvider({ kind: 'sample' }, { sample: fakeSample().sample, ledger });
  await viaSample.text('x');
  assert.equal(ledger.toJSON().entries.at(-1).provider, 'claude-sample');
});

// ------------------------------------------------------------------ obálka UMD a pravidla modulu
test('modul je čistý: bez Date.now/Math.random, bez DOM, bez sekvencí, které by rozbily vložení do HTML', () => {
  assert.ok(!/Date\.now\s*\(/.test(SOURCE), 'hodiny jen přes parametr now');
  assert.ok(!/Math\.random\s*\(/.test(SOURCE));
  assert.ok(!/\b(document|localStorage|sessionStorage|XMLHttpRequest)\b/.test(SOURCE.replace(/\/\*[\s\S]*?\*\//g, '')));
  assert.ok(!/<\/script/i.test(SOURCE), 'build.mjs takový zdroj odmítne');
  assert.ok(!SOURCE.includes('<!--'));
  assert.ok(!/<\/style/i.test(SOURCE));
  assert.ok(!/\brequire\s*\(/.test(SOURCE), 'žádné závislosti');
});

test('UMD: bez `module` se rozhraní zavěsí na globální TrenerProviders', () => {
  const sandbox = {};
  vm.runInNewContext(SOURCE, sandbox);
  assert.equal(typeof sandbox.TrenerProviders.extractJson, 'function');
  assert.deepEqual(Object.keys(sandbox.TrenerProviders).sort(), Object.keys(P).sort());
  // objekt z jiného kontextu (vm) má jiný Object.prototype, proto se porovnává přes JSON
  assert.equal(JSON.stringify(sandbox.TrenerProviders.extractJson('x {"a": 1} y')), '{"a":1}');
  assert.equal(sandbox.TrenerProviders.estimateTokens('abcd'), 2);
});

test('v testech se nikde nevolá skutečná síť: fetch je vždy falešný', async () => {
  const realFetch = globalThis.fetch;
  let touched = false;
  globalThis.fetch = () => {
    touched = true;
    throw new Error('skutečná síť');
  };
  try {
    // bez předaného fetch modul k síti nesáhne ani omylem
    assertProviderError(await caught(P.createAnthropicProvider({ apiKey: KEY }).text('x')), 'invalid_request');
    assertProviderError(await caught(P.createProvider({ kind: 'openai', baseUrl: 'https://x.test/v1', models: { default: 'm' } }, {}).text('x')), 'invalid_request');
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(touched, false);
});

// ------------------------------------------------------------------ hledání na webu (nástroj web_search Anthropic)
const searchBody = (extra = {}) => ({
  id: 'msg_ws',
  type: 'message',
  role: 'assistant',
  model: 'claude-haiku-5-5',
  content: [
    { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'fm27 tactics' } },
    { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [{ type: 'web_search_result', url: 'https://www.footballmanager.com/fm27/features/x', title: 'FM27', encrypted_content: 'ZZZ', page_age: 'October 20, 2026' }] },
    { type: 'text', text: 'Nalezeno.', citations: [{ type: 'web_search_result_location', url: 'https://www.footballmanager.com/fm27/features/x', title: 'FM27', encrypted_index: 'i', cited_text: 'Heat maps.' }] },
  ],
  stop_reason: 'end_turn',
  usage: { input_tokens: 900, output_tokens: 80, server_tool_use: { web_search_requests: 1 } },
  ...extra,
});

test('webSearch: jen adaptér Anthropic ho má; požadavek nese nástroj web_search_20250305 a levný model', async () => {
  const f = fakeFetch(jsonResponse(searchBody()));
  const p = P.createAnthropicProvider({ apiKey: KEY, fetch: f });
  assert.equal(typeof p.webSearch, 'function');
  const r = await p.webSearch('Najdi zdroje o FM27');
  const call = f.calls[0];
  assert.equal(call.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(call.body.model, 'claude-haiku-5-5');
  assert.deepEqual(call.body.tools, [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }]);
  assert.equal(call.body.max_tokens, 2048);
  assert.equal(call.body.messages[0].content, 'Najdi zdroje o FM27');
  assert.equal(call.headers['x-api-key'], KEY);
  assert.equal(r.text, 'Nalezeno.');
  assert.equal(r.raw.content[1].type, 'web_search_tool_result');
  const o = P.createOpenAICompatibleProvider({ baseUrl: 'https://x.example/v1', models: { default: 'm' }, fetch: f });
  assert.equal(o.webSearch, undefined);
  assert.equal(P.wrapSample(() => {}).webSearch, undefined);
});

test('webSearch: běžné json() a text() žádné nástroje neposílají', async () => {
  const f = fakeFetch(jsonResponse(anthropicBody('{}')));
  const p = P.createAnthropicProvider({ apiKey: KEY, fetch: f });
  await p.text('ahoj');
  assert.equal(f.calls[0].body.tools, undefined);
  assert.deepEqual(Object.keys(f.calls[0].body).sort(), ['max_tokens', 'messages', 'model']);
});

test('webSearch: maxUses (strop 5), domény (jen jeden seznam), úroveň modelu a signál', async () => {
  const f = fakeFetch(jsonResponse(searchBody()));
  const p = P.createAnthropicProvider({ apiKey: KEY, fetch: f });
  await p.webSearch('x', { maxUses: 99, allowedDomains: ['sortitoutsi.net', 'neplatná doména!', 'footballmanager.com/fm27'], blockedDomains: ['spam.example'], modelTier: 'default' });
  const t = f.calls[0].body.tools[0];
  assert.equal(t.max_uses, 5);
  assert.deepEqual(t.allowed_domains, ['sortitoutsi.net', 'footballmanager.com/fm27']);
  assert.equal(t.blocked_domains, undefined);
  assert.equal(f.calls[0].body.model, 'claude-sonnet-5-5');
  const f2 = fakeFetch(jsonResponse(searchBody()));
  await P.createAnthropicProvider({ apiKey: KEY, fetch: f2 }).webSearch('x', { blockedDomains: ['spam.example'] });
  assert.deepEqual(f2.calls[0].body.tools[0].blocked_domains, ['spam.example']);
  assert.equal(f2.calls[0].body.tools[0].allowed_domains, undefined);
  const f3 = fakeFetch(jsonResponse(searchBody()));
  const ctl = new AbortController();
  await P.createAnthropicProvider({ apiKey: KEY, fetch: f3 }).webSearch('x', { signal: ctl.signal });
  assert.equal(f3.calls[0].init.signal, ctl.signal);
});

test('webSearch: odpověď bez textu (pause_turn) není chyba a výsledky zůstanou v raw', async () => {
  const f = fakeFetch(jsonResponse(searchBody({ stop_reason: 'pause_turn', content: [{ type: 'server_tool_use', id: 's', name: 'web_search', input: { query: 'q' } }] })));
  const p = P.createAnthropicProvider({ apiKey: KEY, fetch: f });
  const r = await p.webSearch('x');
  assert.equal(r.text, '');
  assert.equal(r.raw.stop_reason, 'pause_turn');
});

test('webSearch: chyby HTTP, zrušení a hlášení tokenů jako u ostatních volání; klíč se neprozradí', async () => {
  const f = fakeFetch(jsonResponse(anthropicError('invalid_request_error', `Web search is not enabled for your organization ${KEY}`), 400));
  const p = P.createAnthropicProvider({ apiKey: KEY, fetch: f });
  await assert.rejects(() => p.webSearch('x'), (e) => e.code === 'invalid_request' && !JSON.stringify(e).includes(KEY));
  const f2 = fakeFetch(jsonResponse(anthropicError('rate_limit_error', 'slow down'), 429));
  await assert.rejects(() => P.createAnthropicProvider({ apiKey: KEY, fetch: f2 }).webSearch('x'), (e) => e.code === 'rate_limited');
  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(() => P.createAnthropicProvider({ apiKey: KEY, fetch: fakeFetch(jsonResponse(searchBody())) }).webSearch('x', { signal: ctl.signal }), (e) => e.code === 'cancelled');
  const used = [];
  const f3 = fakeFetch(jsonResponse(searchBody()));
  await P.createAnthropicProvider({ apiKey: KEY, fetch: f3 }).webSearch('x', { onUsage: (u) => used.push(u) });
  assert.deepEqual(used, [{ inputTokens: 900, outputTokens: 80, model: 'claude-haiku-5-5' }]);
});

test('webSearch: withLedger volání zapíše (úroveň quick, tokeny z odpovědi) a rozhraní zachová', async () => {
  const ledger = P.createLedger({ now: () => 1000 });
  const f = fakeFetch(jsonResponse(searchBody()));
  const wrapped = P.withLedger(P.createAnthropicProvider({ apiKey: KEY, fetch: f }), ledger, { purpose: 'hledání na webu' });
  assert.equal(typeof wrapped.webSearch, 'function');
  const r = await wrapped.webSearch('Najdi zdroje');
  assert.equal(r.raw.stop_reason, 'end_turn');
  const [e] = ledger.toJSON().entries;
  assert.equal(e.tier, 'quick');
  assert.equal(e.model, 'claude-haiku-5-5');
  assert.equal(e.inputTokens, 900);
  assert.equal(e.outputTokens, 80);
  assert.equal(e.estimated, false);
  assert.equal(e.ok, true);
  assert.equal(e.purpose, 'hledání na webu');
  const noSearch = P.withLedger(P.wrapSample(async () => ({ text: '' })), P.createLedger({ now: () => 0 }), {});
  assert.equal(noSearch.webSearch, undefined);
});
