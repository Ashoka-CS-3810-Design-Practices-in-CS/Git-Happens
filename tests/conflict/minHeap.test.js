"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { MinHeap } = require("../../conflict/minHeap.js");
const { rng } = require("../helpers.js");

test("empty heap", () => {
  const h = new MinHeap();
  assert.equal(h.size, 0);
  assert.equal(h.peek(), undefined);
  assert.equal(h.pop(), undefined);
});

test("pops in ascending order of the key", () => {
  const h = new MinHeap((x) => x.end);
  for (const end of [50, 10, 40, 10, 30, 20]) h.push({ end });
  assert.equal(h.peek().end, 10);
  const out = [];
  while (h.size) out.push(h.pop().end);
  assert.deepEqual(out, [10, 10, 20, 30, 40, 50]);
});

test("random pushes and pops match a sorted array", () => {
  const rand = rng(7);
  const h = new MinHeap();
  const model = [];
  for (let i = 0; i < 3000; i++) {
    if (rand() < 0.6 || model.length === 0) {
      const v = Math.floor(rand() * 1000);
      h.push(v);
      model.push(v);
      model.sort((a, b) => a - b);
    } else {
      assert.equal(h.pop(), model.shift());
    }
    assert.equal(h.size, model.length);
    assert.equal(h.peek(), model[0]);
  }
});

test("iterating visits every item", () => {
  const h = new MinHeap();
  [3, 1, 2].forEach((v) => h.push(v));
  assert.deepEqual([...h].sort(), [1, 2, 3]);
});
