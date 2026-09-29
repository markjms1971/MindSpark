// scheduleSave() retries a failed cloud save once, on the assumption that the
// failure was the network. A CONFLICT - the map was changed elsewhere - is not
// that: retrying would overwrite the other person's work four seconds later.
// So a conflict must be told apart, reported in its own words, and not retried.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractFunction } from './helpers/load-app-fns.mjs';

function harness({ saveImpl }) {
  const el = { savePill: { classList: { add() {}, remove() {} } }, saveText: { textContent: '' } };
  const $ = sel => ({ '#savePill': el.savePill, '#saveText': el.saveText })[sel];
  const timers = [];
  const setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  const clearTimeout = () => {};
  const toasts = [];
  const saves = [];
  const Store = { save: async m => { saves.push(m); return saveImpl(m); } };
  const map = { id: 'm1' };
  const fn = new Function('$', 'setTimeout', 'clearTimeout', 'toast', 'Store', 'MODE', 'forgeName', 'READONLY',
    `let map = arguments[8]; let saveTimer = null; let _pendingSaveMap = null; let scheduleCloudSave = () => {};
     const _saveRuns = new WeakMap(); let _savesInFlight = 0;
     ${extractFunction('_runSave')}
     ${extractFunction('scheduleSave')}
     return scheduleSave;`)($, setTimeout, clearTimeout, m => toasts.push(m), Store, 'cloud', () => 'GitLab', false, map);
  return { run: fn, timers, toasts, saves, el };
}

// Drain the fake timers: run whatever is queued, including timers queued by timers.
async function flush(timers) {
  while (timers.length) { const t = timers.shift(); await t.fn(); }
}

describe('scheduleSave and conflicts', () => {
  test('a network failure is retried once and reported as a sync hiccup', async () => {
    let n = 0;
    const h = harness({ saveImpl: async () => { if (++n === 1) throw new Error('HTTP 502'); } });
    h.run(); await flush(h.timers);
    assert.equal(h.saves.length, 2, 'one retry');
    assert.match(h.toasts[0], /saved on this device and will retry/);
    assert.equal(h.el.saveText.textContent, 'Saved');
  });

  // An edit made while a save of the same map is still on the wire used to start a
  // second, overlapping save - on GitLab it carried a stale lock and came back as a
  // false "changed elsewhere". It now waits for the first and runs once after it.
  test('an edit during a save waits for it, then saves once more', async () => {
    let release, n = 0;
    const h = harness({ saveImpl: () => { n++; if (n === 1) return new Promise(r => { release = r; }); } });
    h.run();
    const first = h.timers.shift().fn();          // save #1 starts and stays on the wire
    h.run();                                       // an edit lands meanwhile
    await h.timers.shift().fn();                   // its timer fires: it must queue, not overlap
    assert.equal(h.saves.length, 1, 'no second request while the first is in flight');
    release(); await first;
    assert.equal(h.saves.length, 2, 'the queued save runs once the first has landed');
    assert.equal(h.el.saveText.textContent, 'Saved');
  });

  test('a conflict is reported in its own words and NOT retried', async () => {
    const h = harness({ saveImpl: async () => { const e = new Error('This map was changed elsewhere - reload it to see those changes, or keep editing and your next save will overwrite them.'); e.conflict = true; throw e; } });
    h.run(); await flush(h.timers);
    assert.equal(h.saves.length, 1, 'a retry would overwrite the other person\'s save');
    assert.equal(h.toasts.length, 1);
    assert.match(h.toasts[0], /changed elsewhere/);
    assert.equal(h.el.saveText.textContent, 'Conflict');
  });
});
