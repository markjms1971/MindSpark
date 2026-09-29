// A live-session peer is as untrusted as a share link. Two holes let one
// reach past that:
//
//  1. The room relayed EVERY message type it did not handle itself, checking
//     write access only for 'op'. A read-only viewer could send a forged
//     {t:'welcome', snapshot} and every joining guest adopted it wholesale.
//     The room now passes on only op / cur / ping.
//
//  2. The client applied ops raw: map.nodes[id] = n with no field checks
//     (colours, markers and image URLs land in markup and styles - the very
//     things sanitizeMapData vets on a snapshot), and map[k] = v for ANY meta
//     key. {k:'id'} re-pointed the host's autosave at another of their maps;
//     {k:'_ephemeral'} switched saving off. applyCollabOps() closes both.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadFns, extractConst } from './helpers/load-app-fns.mjs';
import { isRelayedPeerMessage } from '../worker/collab-http.js';

const { applyCollabOps } = loadFns(
  ['applyCollabOps', 'repairTree', 'sanitizeNodeFields', 'safeColor', 'safeImageUrl'],
  {
    SAFE_COLOR_RE: extractConst('SAFE_COLOR_RE'),
    SAFE_ID_RE: extractConst('SAFE_ID_RE'),
    SAFE_IMAGE_RE: extractConst('SAFE_IMAGE_RE'),
    NODE_ALIGNS: extractConst('NODE_ALIGNS'),
    COLLAB_META_KEYS: extractConst('COLLAB_META_KEYS'),
  });

const hostMap = () => ({
  id: 'host-map', title: 'Plan', color: '#e0613a', rootId: 'r', layout: 'balanced',
  nodes: { r: { id: 'r', text: 'Root', parent: null }, a: { id: 'a', text: 'A', parent: 'r' } },
  links: [], vars: {},
});

describe('room relay allowlist', () => {
  test('ops, cursors and pings are relayed', () => {
    for (const t of ['op', 'cur', 'ping']) assert.equal(isRelayedPeerMessage({ t }), true, t);
  });
  test('room-only messages from a peer are dropped', () => {
    for (const t of ['welcome', 'join', 'leave', 'name', 'snapshot', 'anything', undefined]) {
      assert.equal(isRelayedPeerMessage({ t }), false, String(t));
    }
    assert.equal(isRelayedPeerMessage(null), false);
    assert.equal(isRelayedPeerMessage('op'), false);
  });
  test('the Durable Object consults the allowlist before relaying', () => {
    const src = readFileSync(new URL('../worker/collab-do.js', import.meta.url), 'utf8');
    const i = src.indexOf('isRelayedPeerMessage(m)'), j = src.indexOf('this._broadcast(ws, m)');
    assert.ok(i > 0 && j > i, 'the relay must be gated by isRelayedPeerMessage');
  });
});

describe('applyCollabOps - ordinary edits still sync', () => {
  test('adds, edits and deletes nodes', () => {
    const m = hostMap();
    applyCollabOps(m, [
      { t: 'node', id: 'b', n: { id: 'b', text: 'B', parent: 'r', color: '#3a6ea5', marker: '⭐', align: 'left' } },
      { t: 'node', id: 'a', n: { id: 'a', text: 'A edited', parent: 'r' } },
    ]);
    assert.equal(m.nodes.b.text, 'B');
    assert.equal(m.nodes.b.color, '#3a6ea5');
    assert.equal(m.nodes.b.marker, '⭐');
    assert.equal(m.nodes.b.align, 'left');
    assert.equal(m.nodes.a.text, 'A edited');
    applyCollabOps(m, [{ t: 'del', id: 'b' }]);
    assert.equal(m.nodes.b, undefined);
  });

  test('applies every map-level field the client diff() emits', () => {
    const m = hostMap();
    applyCollabOps(m, [
      { t: 'meta', k: 'title', v: 'New title' },
      { t: 'meta', k: 'color', v: '#2e9e6b' },
      { t: 'meta', k: 'rootId', v: 'a' },
      { t: 'meta', k: 'links', v: [{ from: 'r', to: 'a', label: 'x' }] },
      { t: 'meta', k: 'layout', v: 'tree' },
      { t: 'meta', k: 'vars', v: { n: 3 } },
      { t: 'meta', k: 'style', v: 'sketch' },
    ]);
    assert.equal(m.title, 'New title');
    assert.equal(m.color, '#2e9e6b');
    assert.equal(m.rootId, 'a');
    assert.deepEqual(m.links, [{ from: 'r', to: 'a', label: 'x' }]);
    assert.equal(m.layout, 'tree');
    assert.deepEqual(m.vars, { n: 3 });
    assert.equal(m.style, 'sketch');
  });

  test('a data: image a peer attached still arrives', () => {
    const m = hostMap();
    const img = 'data:image/png;base64,iVBORw0KGgo=';
    applyCollabOps(m, [{ t: 'node', id: 'a', n: { id: 'a', text: 'A', parent: 'r', image: img } }]);
    assert.equal(m.nodes.a.image, img);
  });

  test('the client diff() only emits meta keys the allowlist accepts', () => {
    const src = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
    const diff = src.slice(src.indexOf('  function diff(prev, cur){'), src.indexOf('return ops;', src.indexOf('  function diff(prev, cur){')));
    const allowed = extractConst('COLLAB_META_KEYS');
    const emitted = [...diff.matchAll(/k:'(\w+)'/g)].map(x => x[1]);
    assert.ok(emitted.length >= 7);
    for (const k of emitted) assert.ok(allowed.has(k), `diff() emits '${k}' but applyCollabOps would drop it`);
  });
});

describe('applyCollabOps - hostile ops are neutralised', () => {
  test('a peer cannot change the map id or local-only flags', () => {
    const m = hostMap();
    applyCollabOps(m, [
      { t: 'meta', k: 'id', v: 'victim-map' },
      { t: 'meta', k: '_ephemeral', v: true },
      { t: 'meta', k: '_cloudEdit', v: { id: 'x', token: 'y' } },
      { t: 'meta', k: '__proto__', v: { polluted: true } },
    ]);
    assert.equal(m.id, 'host-map');
    assert.equal(m._ephemeral, undefined);
    assert.equal(m._cloudEdit, undefined);
    assert.equal(m.polluted, undefined);
    assert.equal({}.polluted, undefined);
  });

  test('node fields that reach markup are vetted like a loaded map', () => {
    const m = hostMap();
    applyCollabOps(m, [{ t: 'node', id: 'a', n: {
      id: 'a', text: 'A', parent: 'r',
      color: 'red;background:url(//evil)',
      marker: '<img src=x onerror=alert(1)>',
      image: 'data:image/png"onerror="alert(1)',
      fontSize: 1e9,
      align: 'justify"><script>',
    } }]);
    const n = m.nodes.a;
    assert.equal(n.text, 'A');
    for (const k of ['color', 'marker', 'image', 'fontSize', 'align']) assert.equal(k in n, false, k);
  });

  test('unusable node ids are refused and cannot touch the prototype', () => {
    const m = hostMap();
    applyCollabOps(m, [
      { t: 'node', id: '__proto__', n: { text: 'x', polluted: true } },
      { t: 'node', id: '<b>', n: { text: 'x' } },
      { t: 'node', id: 'ok', n: 'not an object' },
      { t: 'node', id: 'arr', n: [] },
      { t: 'del', id: '__proto__' },
    ]);
    assert.deepEqual(Object.keys(m.nodes).sort(), ['a', 'r']);
    assert.equal(m.nodes.polluted, undefined);
  });

  test('a node op carries its own key as id, and a bad parent is dropped', () => {
    const m = hostMap();
    applyCollabOps(m, [{ t: 'node', id: 'c', n: { id: 'someone-else', text: 'C', parent: '"><x' } }]);
    assert.equal(m.nodes.c.id, 'c');
    assert.equal(m.nodes.c.parent, null);
  });

  test('bad meta values leave the current value in place', () => {
    const m = hostMap();
    applyCollabOps(m, [
      { t: 'meta', k: 'title', v: { toString: 1 } },
      { t: 'meta', k: 'color', v: 'url(javascript:alert(1))' },
      { t: 'meta', k: 'rootId', v: '__proto__"' },
      { t: 'meta', k: 'links', v: 'nope' },
      { t: 'meta', k: 'layout', v: 42 },
    ]);
    assert.equal(m.title, 'Plan');
    assert.equal(m.color, '#e0613a');
    assert.equal(m.rootId, 'r');
    assert.deepEqual(m.links, []);
    assert.equal(m.layout, 'balanced');
  });

  test('malformed batches do not throw', () => {
    const m = hostMap();
    assert.doesNotThrow(() => applyCollabOps(m, undefined));
    assert.doesNotThrow(() => applyCollabOps(m, [null, 1, 'x', { t: 'meta' }, { t: 'node' }]));
    assert.deepEqual(Object.keys(m.nodes).sort(), ['a', 'r']);
  });
});

// The durable shared-map API applies ops the same way. A meta op naming `nodes`
// replaced the node table with whatever it carried; every later node op then
// threw, and the room answered 500 from then on.
import { handleCollabHttp } from '../worker/collab-http.js';
describe('shared-map PATCH keeps the node table a table', () => {
  test('a meta op on nodes is ignored and node ops still land', async () => {
    const mem = new Map([['snapshot', { nodes: { r: { id: 'r', text: 'R' } } }], ['editToken', 'tok']]);
    const storage = { get: async k => mem.get(k), put: async (k, v) => { mem.set(k, v); } };
    const patch = ops => handleCollabHttp(storage, {}, new Request('https://w.test/api/collab/room1', { method: 'PATCH', headers: { 'X-Edit-Token': 'tok' }, body: JSON.stringify({ ops }) }));
    const r1 = await patch([{ t: 'meta', k: 'nodes', v: 'boom' }]);
    assert.equal(r1.status, 200);
    const r2 = await patch([{ t: 'node', id: 'a', n: { id: 'a', text: 'A' } }]);
    assert.equal(r2.status, 200);
    assert.equal(typeof mem.get('snapshot').nodes, 'object');
    assert.equal(mem.get('snapshot').nodes.a.text, 'A');
  });
});
