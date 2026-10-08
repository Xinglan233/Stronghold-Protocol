import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { ownershipRoster } from '../../public/js/ui/ownershipModel.js';

// Missing API is an explicit assertion during the initial red run, not a module-load failure.
const M = await import('../../public/js/ui/yituliuOwnership.js').catch((e) => {
  if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
  return {};
});
const api = (name) => { assert.equal(typeof M[name], 'function', `${name} must support the new import source`); return M[name]; };
const chess = Object.values(JSON.parse(readFileSync(new URL('../../data/chess.json', import.meta.url))));
const roster = ownershipRoster(chess);
const [a, b] = roster;
const token = () => randomUUID().replaceAll('-', ''); // Synthetic, never printed or persisted.
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('stable IDs, duplicate IDs, alternate identities, ignored training fields, conservative ownership', () => {
  const parse = api('parseYituliuOperators');
  const preview = api('previewYituliuOwnership');
  const raw = { code: 200, data: [{ id: a.charId, name: b.name, level: 0, skills: [], equips: [] }, { id: a.charId }, { id: 'char_unknown_fixture' }] };
  const parsed = parse(raw);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.charIds, [a.charId, 'char_unknown_fixture']);
  const original = [a.chessId, b.chessId];
  const p = preview(parsed.charIds, chess, original);
  assert.deepEqual(p.notOwned, [b.chessId]);
  assert.deepEqual(original, [a.chessId, b.chessId]);
  assert.deepEqual([p.matched, p.skipped, p.changed], [1, 1, 1]);
  assert.deepEqual(preview([a.charId + '_alter'], chess, original).notOwned, original.slice().sort());
  const otherBase = { ...a, chessId: 'chess_same_character_fixture', baseId: 'chess_same_character_fixture' };
  const alternate = { ...b, charId: a.charId + '_alter' };
  const expanded = [a, otherBase, alternate];
  const all = expanded.map((c) => c.chessId);
  assert.deepEqual(preview([a.charId], expanded, all).notOwned, [b.chessId], 'one character maps to every supported base chess');
  assert.deepEqual(preview([alternate.charId], expanded, all).notOwned, [a.chessId, otherBase.chessId].sort(), 'alternate identity only maps to its own chess');
});

test('collaboration, PRESET, elite, DIY, hidden and unsupported records cannot extend the allowlist', () => {
  const preview = api('previewYituliuOwnership');
  const collab = ['char_456_ash', 'char_4123_ela', 'char_1029_yato2', 'char_4142_malcil', 'char_4188_confes'];
  assert.ok(collab.every((id) => !roster.some((c) => c.charId === id)), 'current supported ownership roster excludes collaborations');
  const excluded = chess.filter((c) => !roster.includes(c)).map((c) => c.charId).filter((id) => !roster.some((c) => c.charId === id));
  const original = [a.chessId, b.chessId];
  const p = preview([...collab, ...excluded], chess, original);
  assert.deepEqual(p.notOwned, original.slice().sort());
  assert.equal(p.changed, 0);
  assert.equal(p.matched, 0);
  const elite = { ...a, chessId: 'elite_fixture', baseId: a.chessId, isGolden: true };
  const p2 = preview([a.charId], [...chess, elite], original);
  assert.deepEqual(p2.ownedChessIds, [a.chessId]);
});

test('empty, malformed, business errors and excessive data cannot supply a preview', () => {
  const parse = api('parseYituliuOperators');
  for (const raw of [null, {}, { code: 200, data: [] }, { code: 200, data: null }, { code: 200, data: [{ id: a.charId }, {}] }, { code: 200, data: [{ id: '__proto__' }] }, { code: 200, data: Array(5001).fill({ id: a.charId }) }]) {
    assert.equal(parse(raw).ok, false);
  }
  assert.equal(parse({ code: 20027, msg: 'untrusted remote text', data: null }).error, 'auth');
  assert.equal(parse({ code: 500, msg: 'untrusted remote text', data: [] }).error, 'service');
});

test('fixed browser GET, raw Authorization, no cookies/referrer/cache/redirect, returns IDs only', async () => {
  const read = api('readYituliuOperators');
  const secret = token();
  let calls = 0;
  const r = await read(secret, { fetchImpl: async (url, opts) => {
    calls++;
    assert.equal(url, 'https://backend.yituliu.cn/open-api/operator/info');
    assert.equal(opts.method, 'GET');
    assert.deepEqual(opts.headers, { Authorization: secret });
    assert.deepEqual([opts.credentials, opts.cache, opts.redirect, opts.referrerPolicy], ['omit', 'no-store', 'error', 'no-referrer']);
    return response({ code: 200, data: [{ id: a.charId, name: 'unused', level: 0 }] });
  } });
  assert.equal(calls, 1);
  assert.deepEqual(r, { ok: true, charIds: [a.charId] });
  assert.equal((await read('invalid', { fetchImpl: () => { throw new Error('must not request'); } })).error, 'token');
});

test('invalid/expired permissions, rate limit, network, bad JSON, large body, cancellation and timeout', async () => {
  const read = api('readYituliuOperators');
  for (const [status, error] of [[401, 'auth'], [403, 'auth'], [429, 'rate'], [500, 'service']]) {
    assert.equal((await read(token(), { fetchImpl: async () => response({}, status) })).error, error);
  }
  assert.equal((await read(token(), { fetchImpl: async () => response({ code: 20027, data: null }) })).error, 'auth');
  assert.equal((await read(token(), { fetchImpl: async () => { throw new Error('private remote details'); } })).error, 'network');
  assert.equal((await read(token(), { fetchImpl: async () => new Response('{') })).error, 'format');
  assert.equal((await read(token(), { fetchImpl: async () => new Response('x'.repeat(1024 * 1024 + 1)) })).error, 'size');
  const controller = new AbortController();
  const cancelled = read(token(), { signal: controller.signal, fetchImpl: async () => { controller.abort(); return response({ code: 200, data: [{ id: a.charId }] }); } });
  assert.equal((await cancelled).error, 'cancelled');
  const pending = (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  assert.equal((await read(token(), { timeoutMs: 5, fetchImpl: pending })).error, 'timeout');
  const already = new AbortController(); already.abort();
  assert.equal((await read(token(), { signal: already.signal, fetchImpl: () => { throw new Error('must not request'); } })).error, 'cancelled');
});

test('confirmation recomputes against the latest settings rather than reverting intervening edits', () => {
  const preview = api('previewYituliuOwnership');
  const before = preview([a.charId], chess, [a.chessId, b.chessId]);
  const current = preview([a.charId], chess, [a.chessId]);
  assert.deepEqual(before.notOwned, [b.chessId]);
  assert.deepEqual(current.notOwned, []);
  assert.equal(current.changed, 1);
});

test('HTTP error bodies are cancelled rather than downloading after the timeout is cleared', async () => {
  const read = api('readYituliuOperators');
  for (const status of [401, 403, 429, 500]) {
    let cancelled = false;
    const stream = new ReadableStream({ cancel() { cancelled = true; } });
    await read(token(), { fetchImpl: async () => new Response(stream, { status }) });
    assert.equal(cancelled, true, `discarded HTTP ${status} body must stop`);
  }
});
