import test from 'node:test';
import assert from 'node:assert/strict';
import { validUsEarningsDataset, usEventsFromDataset, usEarningsFetchOptions } from '../src/services/us-earnings.js';
import { jpxEventsFromDataset } from '../src/services/events.js';

test('US calendar maps tracked symbols and timing',()=>{
  const dataset={
    schema:'vantage-us-earnings-v1',
    generated_at:'2026-07-24T00:00:00.000Z',
    events:[
      {symbol:'NVDA',name:'NVIDIA',date:'2026-08-20',time:'2026-08-20T12:00:00.000Z',timing:'after_hours'},
      {symbol:'ZZZZ',name:'Other',date:'2026-08-20',time:'2026-08-20T12:00:00.000Z',timing:'after_hours'}
    ]
  };
  const events=usEventsFromDataset(dataset,[{symbol:'NVDA',name:'エヌビディア',market:'us',scope:'registered'}],new Date('2026-07-24T00:00:00.000Z').getTime());
  assert.equal(events.length,1);
  assert.equal(events[0].time_note,'米国市場終了後');
  assert.equal(events[0].provider_kind,'nasdaq_zacks');
});

test('US placeholders and fetch options are safe',()=>{
  assert.equal(validUsEarningsDataset({schema:'vantage-us-earnings-v1',generated_at:null,events:[]}),false);
  const forced=usEarningsFetchOptions(true);
  assert.equal(forced.cache,'no-store');
  assert.equal(forced.cf,undefined);
  const cached=usEarningsFetchOptions(false);
  assert.equal(cached.cf.cacheTtl,120);
});

test('JPX raw fiscal date is not appended to company name',()=>{
  const dataset={
    schema:'vantage-jpx-earnings-v1',
    generated_at:'2026-07-24T00:00:00.000Z',
    events:[{symbol:'8035.T',name:'東京エレクトロン',date:'2026-08-01',time:'2026-08-01T12:00:00.000Z',period:'2027-03-3100:00:00'}]
  };
  const events=jpxEventsFromDataset(dataset,[{symbol:'8035.T',name:'東京エレクトロン',market:'jp',scope:'registered'}],new Date('2026-07-24T00:00:00.000Z').getTime());
  assert.equal(events[0].name,'東京エレクトロン 決算予定');
  assert.equal(events[0].name.includes('2027-03-31'),false);
});
