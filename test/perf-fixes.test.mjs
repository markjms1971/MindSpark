// Performance fixes, pinned so they cannot quietly regress:
//  - a node signature carries a short key per image, not the megabytes of the
//    data URI (it was stringified for every node on every render, and kept);
//  - cross-map search reads each map once per version, not on every query;
//  - an autosave rewrites the cloud index only when what it lists changed.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadFns } from './helpers/load-app-fns.mjs';

const APP = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

describe('node signatures do not carry image data', () => {
  const sig = () => {
    const { _nodeSignature } = loadFns(['_nodeSignature', '_imageKey', 'nodeTextPlain'], {
      _imgKeys: new Map(), _imgKeySeq: 0, hasInlineMarkup: () => false, computeNodeValue: () => 0,
    });
    const roll = { desc: {}, tdone: {}, ttot: {} };
    return (n) => _nodeSignature('a', n, false, roll, {}, 'K');
  };
  const big = c => 'data:image/png;base64,' + c.repeat(200000);
  test('a 200 KB image adds a few bytes, not 200 KB', () => {
    const s = sig()({ id: 'a', text: 'A', image: big('A') });
    assert.ok(s.length < 300, 'signature length ' + s.length);
  });
  test('different images still give different signatures, the same image the same one', () => {
    const f = sig();
    const a1 = f({ id: 'a', text: 'A', image: big('A') }), a2 = f({ id: 'a', text: 'A', image: big('A') });
    const b = f({ id: 'a', text: 'A', image: big('B') });
    assert.equal(a1, a2);
    assert.notEqual(a1, b);
  });
});

describe('cross-map search reads each map once per version', () => {
  function harness(maps) {
    const gets = [];
    const Store = { list: async () => maps.map(m => ({ id: m.id, title: m.title, updated: m.updated })),
      get: async id => { gets.push(id); return JSON.parse(JSON.stringify(maps.find(m => m.id === id))); } };
    const { searchAllMaps } = loadFns(['searchAllMaps', '_searchRows'], {
      Store, map: null, _searchCache: new Map(), nodeTextPlain: t => String(t),
    });
    return { searchAllMaps, gets };
  }
  const maps = [
    { id: 'm1', title: 'One', updated: 1, nodes: { a: { id: 'a', text: 'apple pie' } } },
    { id: 'm2', title: 'Two', updated: 1, nodes: { b: { id: 'b', text: 'banana', notes: '<p>apple note</p>' } } },
  ];
  test('the second query answers from what the first read', async () => {
    const h = harness(maps);
    const r1 = await h.searchAllMaps('apple');
    assert.equal(r1.length, 2);
    assert.equal(h.gets.length, 2);
    const r2 = await h.searchAllMaps('banana');
    assert.equal(r2.length, 1);
    assert.equal(h.gets.length, 2, 'no map was downloaded again');
  });
  test('a map whose updated stamp moved is read again', async () => {
    const h = harness(maps);
    await h.searchAllMaps('apple');
    maps[0].updated = 2;
    await h.searchAllMaps('apple');
    assert.deepEqual(h.gets, ['m1', 'm2', 'm1']);
  });
});

describe('an autosave rewrites the cloud index only when it changes', () => {
  function loadStore(fetchImpl, store = new Map()) {
    const start = APP.indexOf('const FORGES = {'), end = APP.indexOf('\nlet Store;', start);
    const localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k), key: i => [...store.keys()][i] ?? null, get length() { return store.size; } };
    return new Function('fetch', 'localStorage', 'document', 'location', `${APP.slice(start, end)}\nreturn { CloudStore };`)(
      fetchImpl, localStorage, { querySelector: () => null }, { href: 'https://app.example/', origin: 'https://app.example' });
  }
  const res = (status, body) => { const r = { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body ?? '') }; r.clone = () => res(status, body); return r; };
  function github() {
    const files = {}; let n = 0; const log = [];
    const fetchImpl = async (url, opt = {}) => {
      const m = opt.method || 'GET'; log.push(m + ' ' + url.replace('https://api.github.com/repos/ada/mindspark-maps', ''));
      if (url.endsWith('/user')) return res(200, { id: 1, login: 'ada' });
      if (/\/repos\/ada\/mindspark-maps$/.test(url)) return res(200, {});
      const path = (url.match(/\/contents\/(.+?)(\?|$)/) || [])[1]; if (!path) return res(404, {});
      if (m === 'GET') return files[path] ? res(200, { sha: files[path].sha, content: Buffer.from(files[path].text).toString('base64'), encoding: 'base64' }) : res(404, {});
      const b = JSON.parse(opt.body);
      if (files[path] && b.sha !== files[path].sha) return res(409, {});
      files[path] = { text: Buffer.from(b.content, 'base64').toString('utf8'), sha: 's' + (++n) };
      return res(200, { content: { sha: files[path].sha } });
    };
    return { files, log, fetchImpl };
  }
  test('same title, same colour: one request, one commit', async () => {
    const gh = github();
    const { CloudStore } = loadStore(gh.fetchImpl);
    await CloudStore.login('ghp_x', 'github', null);
    await CloudStore.save({ id: 'm1', title: 'T', color: '#e0613a' });
    gh.log.length = 0;
    await CloudStore.save({ id: 'm1', title: 'T', color: '#e0613a', nodes: { a: 1 } });
    assert.deepEqual(gh.log, ['PUT /contents/maps/m1.json']);
  });
  test('a rename still updates the index', async () => {
    const gh = github();
    const { CloudStore } = loadStore(gh.fetchImpl);
    await CloudStore.login('ghp_x', 'github', null);
    await CloudStore.save({ id: 'm1', title: 'T' });
    await CloudStore.save({ id: 'm1', title: 'Renamed' });
    assert.equal(JSON.parse(gh.files['_index.json'].text)[0].title, 'Renamed');
  });
});

describe('source-level', () => {
  test('layoutTree memoises extents, drawEdges resolves the style once, drags use _nodeEls', () => {
    const lt = APP.slice(APP.indexOf('function layoutTree('), APP.indexOf('const TREE_LAYOUTS'));
    assert.match(lt, /extentCache\.has\(id\)/);
    const de = APP.slice(APP.indexOf('function drawEdges('), APP.indexOf('function edgePathsHTML('));
    assert.equal((de.match(/STYLE_CONFIG_DEFAULTS\[style\]/g) || []).length, 1);
    assert.doesNotMatch(de.slice(de.indexOf('for(const id in map.nodes)')), /STYLE_CONFIG_DEFAULTS/);
    assert.match(APP, /const el = _nodeEls\.get\(id\) \|\|/);
  });
});
