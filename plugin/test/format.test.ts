import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDurationChinese,
  formatDurationEnglish,
  splitDuration,
} from '../src/client/format.ts';

test('splitDuration breaks ms into h/m/s', () => {
  assert.deepEqual(splitDuration(0), { hours: 0, minutes: 0, seconds: 0 });
  assert.deepEqual(splitDuration(42_000), { hours: 0, minutes: 0, seconds: 42 });
  assert.deepEqual(splitDuration(158_000), { hours: 0, minutes: 2, seconds: 38 });
  assert.deepEqual(splitDuration(7_591_000), { hours: 2, minutes: 6, seconds: 31 });
  assert.deepEqual(splitDuration(-5), { hours: 0, minutes: 0, seconds: 0 });
});

test('Chinese duration formatting', () => {
  assert.equal(formatDurationChinese(42_000), '42秒');
  assert.equal(formatDurationChinese(158_000), '2分38秒');
  assert.equal(formatDurationChinese(60_000), '1分');
  assert.equal(formatDurationChinese(7_591_000), '2小时6分');
  assert.equal(formatDurationChinese(3_600_000), '1小时');
});

test('English duration formatting', () => {
  assert.equal(formatDurationEnglish(42_000), '42s');
  assert.equal(formatDurationEnglish(158_000), '2m 38s');
  assert.equal(formatDurationEnglish(7_591_000), '2h 6m');
});
