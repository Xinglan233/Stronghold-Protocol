// Isolated headless browser on the user's Mac; every external request is intercepted. No saved browser profile.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ownershipRoster } from '../../public/js/ui/ownershipModel.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test/e2e/out');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const [a, b] = ownershipRoster(Object.values(JSON.parse(readFileSync(path.join(ROOT, 'data/chess.json')))));
const sel = (name) => `[data-testid="yituliu-${name}"]`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Yituliu ownership import (mock only)', { skip: !ENABLED && 'set SP_E2E=1 and CHROME_PATH' }, () => {
  let server, browser, base;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    server = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    base = `http://127.0.0.1:${server.port}`;
    browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    mkdirSync(OUT, { recursive: true });
  });
  after(async () => { await browser?.close(); await server?.close(); });

  async function open(width = 1280) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width, height: width < 500 ? 844 : 900, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const remote = { count: 0, delay: 0, body: { code: 200, data: [{ id: a.charId }] } };
    await page.setRequestInterception(true);
    page.on('request', async (request) => {
      try {
        if (request.url() === 'https://backend.yituliu.cn/open-api/operator/info') {
          const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET', 'access-control-allow-headers': 'authorization' };
          if (request.method() === 'OPTIONS') { await request.respond({ status: 204, headers }); return; }
          remote.count++;
          assert.equal(request.method(), 'GET');
          assert.ok(request.headers().authorization);
          assert.equal(request.headers().cookie, undefined);
          const body = JSON.stringify(remote.body), delay = remote.delay;
          if (delay) await wait(delay);
          await request.respond({ status: 200, contentType: 'application/json', headers, body });
        } else if (request.url().startsWith(base) || request.url().startsWith('data:')) await request.continue();
        else await request.abort(); // Never contact any external site during this test.
      } catch (e) { if (e.code === 'ERR_ASSERTION') errors.push('unsafe request options'); }
    });
    await page.evaluateOnNewDocument((ids) => {
      localStorage.setItem('sp.name', '导入测试'); sessionStorage.setItem('sp.entered', '1');
      localStorage.setItem('sp.pref.ownership', JSON.stringify({ v: 1, notOwned: ids }));
    }, [a.chessId, b.chessId].sort());
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => globalThis.__SP__?.store.get().connection.status === 'online' && document.querySelector('.lobby-screen'));
    await page.click('.lobby-screen [data-testid="loadout-open"]');
    await page.waitForSelector('.lo-card');
    await page.click('.lo-tabs [data-tab="ownership"]');
    await page.click('[data-testid="ownership-import"]');
    assert.ok(await page.$(sel('source')), 'ownership import must offer Yituliu');
    await page.click(sel('source'));
    await page.waitForSelector(sel('token'));
    return { context, page, remote, errors };
  }
  async function read(page, twice = false) {
    await page.evaluate((inputSel, buttonSel, double) => {
      const input = document.querySelector(inputSel);
      input.value = crypto.randomUUID().replaceAll('-', ''); // Synthetic token exists only in this isolated page.
      input.dispatchEvent(new Event('input', { bubbles: true }));
      setTimeout(() => { const button = document.querySelector(buttonSel); button.click(); if (double) button.click(); }, 0);
    }, sel('token'), sel('read'), twice);
  }
  const prefs = (page) => page.evaluate(() => ({ ownership: localStorage.getItem('sp.pref.ownership'), loadout: localStorage.getItem('sp.pref.loadout'), diy: localStorage.getItem('sp.pref.diy') }));

  test('desktop/mobile: preview then confirm; only matching supported ownership changes; no credential persistence', async () => {
    for (const width of [1280, 390]) {
      const { context, page, remote, errors } = await open(width);
      const initial = await prefs(page);
      remote.body = { code: 200, data: [{ id: a.charId, level: 0 }, { id: a.charId }, { id: 'char_456_ash' }, { id: 'char_unknown_fixture' }] };
      await read(page);
      await page.waitForSelector(sel('preview'));
      assert.deepEqual(await prefs(page), initial, 'preview does not save');
      assert.equal(await page.$eval(sel('token'), (el) => el.value), '');
      assert.match(await page.$eval(sel('preview'), (el) => el.textContent), /1/);
      await page.evaluate(async () => {
        const nodes = [document.querySelector('.modal'), document.querySelector('.modal__box')];
        await Promise.all(nodes.flatMap((el) => el.getAnimations()).map((animation) => animation.finished));
      });
      await page.screenshot({ path: path.join(OUT, `yituliu-preview-${width}.png`) }); // Input already cleared.
      await page.evaluate((selector) => { const button = document.querySelector(selector); button.click(); button.click(); }, sel('apply'));
      await page.waitForFunction(() => !document.querySelector('[data-testid="yituliu-token"]'));
      const stored = await prefs(page);
      assert.deepEqual(JSON.parse(stored.ownership).notOwned, [b.chessId]);
      assert.deepEqual([stored.loadout, stored.diy], [initial.loadout, initial.diy]);
      assert.equal(remote.count, 1);
      assert.deepEqual(errors, []);
      await context.close();
    }
  });

  test('double read, close during request, late response and reopen cannot save or reuse token', async () => {
    const { context, page, remote, errors } = await open();
    const initial = await prefs(page);
    remote.delay = 600;
    await read(page, true);
    await page.waitForFunction(() => document.querySelector('[data-testid="yituliu-read"]').disabled);
    for (let i = 0; !remote.count && i < 100; i++) await wait(10);
    assert.equal(remote.count, 1);
    await page.click(sel('cancel'));
    await page.click('[data-testid="ownership-import"]'); await page.click(sel('source'));
    remote.delay = 0; remote.body = { code: 200, data: [{ id: b.charId }] };
    assert.equal(await page.$eval(sel('token'), (el) => el.value), '');
    await read(page);
    await page.waitForSelector(sel('preview')); await wait(700);
    assert.equal(remote.count, 2, 'one request per read, including the cancelled one');
    assert.deepEqual(await prefs(page), initial);
    await page.click(sel('apply'));
    await page.waitForFunction(() => !document.querySelector('[data-testid="yituliu-token"]'));
    assert.deepEqual(JSON.parse((await prefs(page)).ownership).notOwned, [a.chessId]);
    assert.deepEqual(errors, []); await context.close();
  });

  test('empty, broken, expired and unknown-only results keep all settings; cancelling a preview does too', async () => {
    const { context, page, remote, errors } = await open();
    const initial = await prefs(page);
    for (const body of [{ code: 200, data: [] }, { code: 200, data: [{}] }, { code: 20027, msg: 'DO_NOT_DISPLAY_REMOTE', data: null }, { code: 200, data: [{ id: 'char_456_ash' }] }]) {
      remote.body = body; await read(page);
      await page.waitForFunction(() => document.querySelector('[data-testid="yituliu-read"]')?.disabled === false);
      assert.equal(await page.$eval(sel('apply'), (el) => el.disabled), true);
      assert.deepEqual(await prefs(page), initial);
      assert.ok(!(await page.$eval('.modal', (el) => el.textContent)).includes('DO_NOT_DISPLAY_REMOTE'));
    }
    remote.body = { code: 200, data: [{ id: a.charId }] }; await read(page);
    await page.waitForSelector(sel('preview')); await page.keyboard.press('Escape');
    assert.deepEqual(await prefs(page), initial);
    assert.deepEqual(errors, []); await context.close();
  });

  test('original JSON ownership import, including explicit all-owned file, still works', async () => {
    const { context, page, errors } = await open();
    await page.click(sel('back'));
    await page.waitForSelector('[data-testid="loadout-io-text"]');
    await page.type('[data-testid="loadout-io-text"]', '{"kind":"stronghold.ownership","v":1,"notOwned":[]}');
    await page.click('[data-testid="loadout-io-apply"]');
    await page.waitForFunction(() => !document.querySelector('.modal'));
    assert.deepEqual(JSON.parse((await prefs(page)).ownership).notOwned, []);
    assert.deepEqual(errors, []); await context.close();
  });

  test('confirmation preserves intervening manual edits to the current application state', async () => {
    const { context, page, errors } = await open();
    await read(page); await page.waitForSelector(sel('preview'));
    await page.evaluate(async (id) => {
      const { setNotOwned } = await import('/js/ui/loadoutSync.js');
      setNotOwned([id]); // User marked b as owned after the preview was created.
    }, a.chessId);
    await page.click(sel('apply'));
    await page.waitForFunction(() => !document.querySelector('[data-testid="yituliu-token"]'));
    assert.deepEqual(JSON.parse((await prefs(page)).ownership).notOwned, [], 'the preview must not restore b to unowned');
    assert.deepEqual(errors, []); await context.close();
  });

  test('parent overlay unmount aborts a pending request and discards its token and response', async () => {
    const { context, page, remote, errors } = await open();
    const initial = await prefs(page); remote.delay = 600;
    await read(page);
    for (let i = 0; !remote.count && i < 100; i++) await wait(10);
    assert.equal(remote.count, 1);
    await page.evaluate(async () => { (await import('/js/ui/loadoutSync.js')).closeLoadout(); });
    await page.waitForFunction(() => !document.querySelector('.lo'));
    await page.click('.lobby-screen [data-testid="loadout-open"]');
    await page.waitForSelector('[data-testid="ownership-import"]');
    await page.click('[data-testid="ownership-import"]'); await page.click(sel('source'));
    await page.waitForSelector(sel('token')); await wait(700);
    assert.equal(await page.$eval(sel('token'), (el) => el.value), '');
    assert.equal(await page.$(sel('preview')), null);
    assert.deepEqual(await prefs(page), initial);
    assert.deepEqual(errors, []); await context.close();
  });
});
