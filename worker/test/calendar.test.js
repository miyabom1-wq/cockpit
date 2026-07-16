import test from 'node:test';import assert from 'node:assert/strict';
import { expectedTradingDate } from '../src/data/calendar.js';
test('US expected date stays on prior session before JST evening open',()=>{assert.equal(expectedTradingDate('us',new Date('2026-07-16T04:00:00Z')),'2026-07-15');});
test('US expected date moves to current date after JST evening open',()=>{assert.equal(expectedTradingDate('us',new Date('2026-07-16T14:00:00Z')),'2026-07-16');});
test('JP substitute holiday rolls past consecutive Golden Week holidays',()=>{assert.equal(expectedTradingDate('jp',new Date('2026-05-06T03:00:00Z')),'2026-05-01');});
