// Public broadcast timing with real snapshots and a clock that can pause during synchronous work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DELAYS } from '../../server/match/match/common.js';
import { makeMatch } from './harness.js';

function messaging(t) {
  const h = makeMatch({ mode: 'solo', seed: 62 });
  t.after(() => h.m.dispose());
  const frames = [];
  h.onBroadcast.push(msg => frames.push({ at: h.sched.now(), msg }));
  const flush = () => { h.m.markPublic(); h.m.flush(); };
  return { ...h, frames, flush };
}

for (const pause of ['before snapshot', 'during snapshot', 'during deduplication']) {
  test(`m.public waits a full interval after a pause ${pause}`, t => {
    const h = messaging(t);
    const { m, sched, frames, flush } = h;
    let pauseMs = 16;
    const publicView = m.publicView;
    t.mock.method(m, 'publicView', function () {
      if (pause === 'before snapshot') sched.t += pauseMs;
      const view = publicView.call(this);
      if (pause === 'during snapshot') sched.t += pauseMs;
      if (pause === 'during deduplication') {
        // stringify must inspect this real snapshot's players before the broadcast.
        view.players.toJSON = () => {
          sched.t += pauseMs;
          return Array.from(view.players);
        };
      }
      return view;
    });
    const start = sched.now();
    flush();
    assert.equal(frames[0].at, start + 16);
    pauseMs = 0;
    m.round++;
    sched.advance(DELAYS.PUBLIC_THROTTLE - 16);
    flush();
    assert.equal(frames.length, 1, `snapshot work must not shorten the interval (${frames.at(-1).at - frames[0].at} ms between broadcasts; ${frames.at(-1).msg.serverNow - frames[0].msg.serverNow} ms between serverNow samples)`);
    for (let i = 0; i < 20; i++) { m.round++; flush(); }
    assert.equal(sched.pending(), 1, 'repeated flushes share one pending timer');
    sched.advance(15);
    assert.equal(frames.length, 1);
    sched.advance(1);
    assert.equal(frames.length, 2);
    assert.equal(frames[1].msg.round, m.round, 'the timer sends the latest state');
    assert.equal(frames[1].at - frames[0].at, DELAYS.PUBLIC_THROTTLE);
    assert.ok(frames[1].msg.serverNow - frames[0].msg.serverNow >= DELAYS.PUBLIC_THROTTLE);
    assert.equal(sched.pending(), 0);
    assert.deepEqual(sched.errors, []);
  });
}

test('deduplicated m.public does not delay the next changed state', t => {
  const { m, sched, frames, flush } = messaging(t);
  flush();
  sched.advance(DELAYS.PUBLIC_THROTTLE);
  flush();
  assert.equal(frames.length, 1, 'serverNow alone is excluded from deduplication');
  assert.equal(sched.pending(), 0);
  m.round++;
  flush();
  assert.equal(frames.length, 2, 'a deduplicated view does not consume the send interval');
  assert.equal(frames[1].at - frames[0].at, DELAYS.PUBLIC_THROTTLE);
});

test('forced m.public bypasses throttle and deduplication while a pending timer waits from that send', t => {
  const { m, sched, frames, flush } = messaging(t);
  flush();
  sched.advance(10);
  m.round++;
  flush();
  assert.equal(sched.pending(), 1);
  const publicView = m.publicView;
  t.mock.method(m, 'publicView', function () {
    const view = publicView.call(this);
    sched.t += 16;
    return view;
  });
  m.flush(true);
  assert.equal(frames.length, 2, 'forced changed state is sent immediately');
  m.flush(true);
  assert.equal(frames.length, 3, 'forced unchanged state is also sent immediately');
  const forcedAt = frames.at(-1).at;
  t.mock.restoreAll();
  m.round++;
  flush();
  sched.advance(DELAYS.PUBLIC_THROTTLE - 1);
  assert.equal(frames.length, 3, 'the earlier pending timer rearms after forced broadcasts');
  assert.equal(sched.pending(), 1);
  sched.advance(1);
  assert.equal(frames.length, 4);
  assert.equal(frames.at(-1).at - forcedAt, DELAYS.PUBLIC_THROTTLE);
  assert.equal(sched.pending(), 0);
  assert.deepEqual(sched.errors, []);
});

test('resync unicasts m.public without consuming the broadcast interval', t => {
  const h = messaging(t);
  h.flush();
  h.sched.advance(10);
  h.m.onReconnect('p_0');
  assert.equal(h.allTo('p_0', 'm.public').length, 1);
  assert.equal(h.frames.length, 1, 'resync is only sent to the reconnecting player');
  h.m.round++;
  h.flush();
  h.sched.advance(DELAYS.PUBLIC_THROTTLE - 10);
  assert.equal(h.frames.length, 2);
  assert.equal(h.frames[1].at - h.frames[0].at, DELAYS.PUBLIC_THROTTLE);
});
