import test from 'node:test';
import assert from 'node:assert/strict';
import { zoomAt } from '../lib/viewport';

test('pointer zoom keeps the pointed location fixed, including at zoom limits', () => {
  const previous = { x: 35, y: -10, scale: 2 };
  for (const factor of [1.5, 0.5, 100, 0.001]) {
    const next = zoomAt(previous, factor, 140, -75);
    assert.ok(next.scale >= 0.2 && next.scale <= 8);
    assert.ok(Math.abs((140 - previous.x) / previous.scale - (140 - next.x) / next.scale) < 1e-9);
    assert.ok(Math.abs((-75 - previous.y) / previous.scale - (-75 - next.y) / next.scale) < 1e-9);
  }
});
