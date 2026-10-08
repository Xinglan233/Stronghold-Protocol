// Independent read-only adapter for Yituliu's documented OpenAPI. No account login, persistence or telemetry.
import { cleanIds, ownershipRoster } from './ownershipModel.js';

const ENDPOINT = 'https://backend.yituliu.cn/open-api/operator/info';
const MAX_BYTES = 1024 * 1024;
const fail = (error) => ({ ok: false, error });

/** Validate the entire response before accepting any IDs. Training fields and remote messages are discarded. */
export function parseYituliuOperators(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('format');
  if (raw.code === 20027) return fail('auth');
  if (raw.code !== 200) return fail('service');
  if (!Array.isArray(raw.data) || raw.data.length > 5000) return fail('format');
  if (!raw.data.length) return fail('empty');
  const ids = new Set();
  for (const record of raw.data) {
    if (!record || typeof record !== 'object' || Array.isArray(record)
      || typeof record.id !== 'string' || !/^char_[A-Za-z0-9_]{1,58}$/.test(record.id)) return fail('format');
    ids.add(record.id);
  }
  return { ok: true, charIds: [...ids] };
}

/** Exact local allowlist only. Absence from an incomplete remote list never means not owned. */
export function previewYituliuOwnership(charIds, chess, currentNotOwned) {
  const ids = new Set(charIds);
  const roster = ownershipRoster(chess);
  const matched = new Set();
  const ownedChessIds = [];
  for (const c of roster) {
    if (ids.has(c.charId)) { matched.add(c.charId); ownedChessIds.push(c.chessId); }
  }
  const owned = new Set(ownedChessIds);
  const previous = cleanIds(currentNotOwned);
  const notOwned = previous.filter((id) => !owned.has(id));
  return { ownedChessIds, notOwned, matched: matched.size, skipped: ids.size - matched.size, changed: previous.length - notOwned.length };
}

/** One user-initiated request. The token is only in this call and its Authorization header; errors never echo it. */
export async function readYituliuOperators(token, { signal, timeoutMs = 12000, fetchImpl = globalThis.fetch } = {}) {
  let value = typeof token === 'string' ? token.trim() : '';
  if (!/^[a-f0-9]{32}$/i.test(value)) return fail('token');
  if (signal?.aborted) return fail('cancelled');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  let response;
  const timer = setTimeout(() => { timedOut = true; abort(); }, timeoutMs);
  try {
    const pending = fetchImpl(ENDPOINT, {
      method: 'GET', headers: { Authorization: value }, signal: controller.signal,
      credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
    });
    value = ''; token = '';
    response = await pending;
    if (controller.signal.aborted) return fail(timedOut ? 'timeout' : 'cancelled');
    if ([401, 403].includes(response.status)) return fail('auth');
    if (response.status === 429) return fail('rate');
    if (!response.ok) return fail('service');
    if (Number(response.headers.get('content-length')) > MAX_BYTES) { controller.abort(); return fail('size'); }
    const reader = response.body?.getReader();
    if (!reader) return fail('format');
    const decoder = new TextDecoder();
    let bytes = 0, text = '';
    try {
      for (;;) {
        const chunk = await reader.read();
        if (controller.signal.aborted) return fail(timedOut ? 'timeout' : 'cancelled');
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_BYTES) { controller.abort(); await reader.cancel(); return fail('size'); }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
    let raw;
    try { raw = JSON.parse(text); } catch { return fail('format'); }
    return parseYituliuOperators(raw);
  } catch {
    return fail(controller.signal.aborted ? (timedOut ? 'timeout' : 'cancelled') : 'network');
  } finally {
    controller.abort();
    if (response?.body && !response.body.locked) {
      try { await response.body.cancel(); } catch { /* A completed/aborted stream needs no further cleanup. */ }
    }
    value = ''; token = '';
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
