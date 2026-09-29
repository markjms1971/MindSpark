// A map is a tree: one root with no parent, and no parent chain that loops.
// Every walk in the app assumes it - rollups, hidden sets, layout, drag checks,
// prompt ancestry - and a malformed map broke it: a #view= link whose root had a
// parent sent computeRollups round a loop until the tab ran out of memory
// ("Invalid array length" after a long freeze). sanitizeMapData() now repairs the
// tree on the way in, applyCollabOps() after every batch of peer ops, and the
// walks themselves stop at a node they have already seen.
//
// Separately: the runtime fields a map carries only while it is open here - the
// edit token and share room of a published map, a cloud-edit session - left in
// JSON exports, rode in on imports (a crafted _cloudEdit re-routed every save to
// someone else's room) and were copied by "Duplicate".
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadFns, extractConst } from './helpers/load-app-fns.mjs';

const SRC = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
let n = 0;
const deps = {
  uid: () => 'fresh' + (++n),
  SAFE_COLOR_RE: extractConst('SAFE_COLOR_RE'), SAFE_ID_RE: extractConst('SAFE_ID_RE'),
  SAFE_IMAGE_RE: extractConst('SAFE_IMAGE_RE'), NODE_ALIGNS: extractConst('NODE_ALIGNS'),
  UNSAFE_NODE_IDS: extractConst('UNSAFE_NODE_IDS'), COLLAB_META_KEYS: extractConst('COLLAB_META_KEYS'),
};
const { sanitizeMapData, applyCollabOps, stripRuntimeFields } = loadFns(
  ['sanitizeMapData', 'applyCollabOps', 'repairTree', 'stripRuntimeFields', 'sanitizeNodeFields', 'safeColor', 'safeImageUrl'], deps);

// Walk up from every node; a loop would revisit a node before reaching null.
const acyclic = m => Object.keys(m.nodes).every(id => {
  const seen = new Set(); let cur = id;
  while (cur != null && m.nodes[cur]) { if (seen.has(cur)) return false; seen.add(cur); cur = m.nodes[cur].parent; }
  return true;
});
const map = nodes => ({ id: 'x', rootId: 'r', nodes });

describe('sanitizeMapData keeps the map a tree', () => {
  test('a root that names a child as its parent is cut free', () => {
    const m = sanitizeMapData(map({ r: { text: 'R', parent: 'a' }, a: { text: 'A', parent: 'r' } }));
    assert.equal(m.nodes.r.parent, null);
    assert.equal(m.nodes.a.parent, 'r', 'the real edge survives');
    assert.ok(acyclic(m));
  });
  test('a root that is its own parent', () => {
    const m = sanitizeMapData(map({ r: { text: 'R', parent: 'r' } }));
    assert.equal(m.nodes.r.parent, null);
  });
  test('a loop away from the root is cut at one link, nothing is deleted', () => {
    const m = sanitizeMapData(map({ r: { text: 'R', parent: null }, a: { text: 'A', parent: 'b' }, b: { text: 'B', parent: 'c' }, c: { text: 'C', parent: 'a' } }));
    assert.ok(acyclic(m));
    assert.deepEqual(Object.keys(m.nodes).sort(), ['a', 'b', 'c', 'r']);
    assert.equal(['a', 'b', 'c'].filter(id => m.nodes[id].parent === null).length, 1, 'exactly one link is cut');
  });
  test('a missing root is re-chosen from the parent-less nodes', () => {
    const m = sanitizeMapData({ id: 'x', rootId: 'gone', nodes: { a: { text: 'A', parent: null }, b: { text: 'B', parent: 'a' } } });
    assert.equal(m.rootId, 'a');
  });
  test('a map made only of a loop still gets a root', () => {
    const m = sanitizeMapData({ id: 'x', rootId: 'nope', nodes: { a: { text: 'A', parent: 'b' }, b: { text: 'B', parent: 'a' } } });
    assert.ok(m.nodes[m.rootId]);
    assert.equal(m.nodes[m.rootId].parent, null);
    assert.ok(acyclic(m));
  });
  test('prototype-reaching ids are re-keyed', () => {
    const raw = '{"id":"x","rootId":"r","nodes":{"r":{"text":"R","parent":null},"__proto__":{"text":"P","parent":"r"},"constructor":{"text":"C","parent":"r"}}}';
    const m = sanitizeMapData(JSON.parse(raw));
    assert.ok(!Object.prototype.hasOwnProperty.call(m.nodes, '__proto__'));
    assert.ok(!Object.prototype.hasOwnProperty.call(m.nodes, 'constructor'));
    assert.equal(Object.keys(m.nodes).length, 3, 'the nodes survive under new ids');
  });
  test('an ordinary tree is untouched', () => {
    const src = map({ r: { text: 'R', parent: null }, a: { text: 'A', parent: 'r' }, b: { text: 'B', parent: 'a' } });
    const m = sanitizeMapData(JSON.parse(JSON.stringify(src)));
    assert.deepEqual(Object.fromEntries(Object.entries(m.nodes).map(([k, v]) => [k, v.parent])), { r: null, a: 'r', b: 'a' });
  });
});

describe('a peer cannot loop the tree either', () => {
  const host = () => ({ rootId: 'r', title: 't', color: '#e0613a', links: [], nodes: { r: { id: 'r', text: 'R', parent: null }, a: { id: 'a', text: 'A', parent: 'r' } } });
  test('re-parenting the root under a child is undone after the batch', () => {
    const m = host();
    applyCollabOps(m, [{ t: 'node', id: 'r', n: { id: 'r', text: 'R', parent: 'a' } }]);
    assert.equal(m.nodes.r.parent, null);
    assert.ok(acyclic(m));
  });
  test('a two-node loop sent by a peer is cut', () => {
    const m = host();
    applyCollabOps(m, [{ t: 'node', id: 'b', n: { text: 'B', parent: 'c' } }, { t: 'node', id: 'c', n: { text: 'C', parent: 'b' } }]);
    assert.ok(acyclic(m));
  });
});

describe('the walks stop at a node they have already seen', () => {
  const body = name => { const i = SRC.indexOf('function ' + name + '('); return SRC.slice(i, SRC.indexOf('\n}', i)); };
  for (const name of ['computeRollups', 'hiddenSet', 'isDescendant', 'assemblePrompt']) {
    test(name, () => assert.match(body(name), /seen\.has\(/));
  }
  test('computeRollups terminates on a looped map', () => {
    const looped = { rootId: 'r', nodes: { r: { id: 'r', parent: 'a' }, a: { id: 'a', parent: 'r' } } };
    const childrenOf = id => Object.values(looped.nodes).filter(x => x.parent === id).map(x => x.id);
    const { computeRollups } = loadFns(['computeRollups'], { map: looped, childrenOf });
    assert.ok(Number.isFinite(computeRollups().desc.r), 'it returns - a loop no longer runs forever');
  });
});

describe('runtime fields never travel with a map', () => {
  test('stripRuntimeFields drops every _-prefixed key and keeps content', () => {
    const m = { id: 'm', title: 'T', nodes: {}, pinned: true, layoutConfig: { a: 1 },
      _editToken: 'secret', _shareRoom: 'room', _cloudEdit: { id: 'x', token: 'y' }, _cloudBase: {}, _cloudView: 'x', _ephemeral: true };
    assert.deepEqual(stripRuntimeFields(m), { id: 'm', title: 'T', nodes: {}, pinned: true, layoutConfig: { a: 1 } });
  });
  test('JSON export, file import and Duplicate all strip them', () => {
    const exp = SRC.slice(SRC.indexOf('function exportJSON('), SRC.indexOf('function importJSON('));
    assert.match(exp, /JSON\.stringify\(stripRuntimeFields\(map\)/);
    const imp = SRC.slice(SRC.indexOf('function importFile('), SRC.indexOf('function mdInlineToHtml('));
    assert.match(imp, /sanitizeMapData\(stripRuntimeFields\(m\)\)/);
    const dup = SRC.slice(SRC.indexOf('async function duplicateMap('), SRC.indexOf('function saveAsTemplate('));
    assert.match(dup, /stripRuntimeFields\(JSON\.parse\(JSON\.stringify\(src\)\)\)/);
  });
});
