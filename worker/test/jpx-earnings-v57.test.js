import test from 'node:test';
import assert from 'node:assert/strict';
import { eventCoverageSummary, jpxEventsFromDataset, validJpxDataset } from '../src/services/events.js';

test('JPX official dataset maps only tracked Japanese symbols',()=>{
  const dataset={
    schema:'vantage-jpx-earnings-v1',
    generated_at:'2026-07-24T00:00:00.000Z',
    events:[
      {symbol:'8035.T',name:'東京エレクトロン',date:'2026-07-30',time:'2026-07-30T14:59:00.000Z',period:'第1四半期'},
      {symbol:'9999.T',name:'対象外',date:'2026-07-31',time:'2026-07-31T14:59:00.000Z'}
    ]
  };
  const tracked=[
    {symbol:'8035.T',name:'東京エレクトロン',market:'jp',scope:'registered'},
    {symbol:'NVDA',name:'NVIDIA',market:'us',scope:'registered'}
  ];
  const events=jpxEventsFromDataset(dataset,tracked,new Date('2026-07-24T00:00:00.000Z').getTime());
  assert.equal(events.length,1);
  assert.equal(events[0].symbols[0],'8035.T');
  assert.equal(events[0].official_kind,'jpx');
  assert.equal(events[0].source_name,'JPX 決算発表予定日');
});

test('event coverage separates JPX official and provider sources',()=>{
  const tracked=[
    {symbol:'8035.T',name:'東京エレクトロン',market:'jp'},
    {symbol:'6857.T',name:'アドバンテスト',market:'jp'},
    {symbol:'NVDA',name:'NVIDIA',market:'us'}
  ];
  const automatic=[
    {category:'earnings',symbols:['8035.T'],source:'official',official_kind:'jpx',source_name:'JPX 決算発表予定日'},
    {category:'earnings',symbols:['NVDA'],source:'provider',source_name:'Yahoo Finance'}
  ];
  const coverage=eventCoverageSummary(tracked,automatic,new Set(['8035.T','6857.T','NVDA']),'2026-07-24T00:00:00.000Z',{jpx:{available:true,event_count:100}});
  assert.equal(coverage.earnings_found,2);
  assert.equal(coverage.jpx_found,1);
  assert.equal(coverage.provider_found,1);
  assert.equal(coverage.not_listed_total,1);
  assert.equal(coverage.by_market.jp.jpx,1);
});


test('empty JPX placeholder is never accepted as a live dataset',()=>{
  assert.equal(validJpxDataset({
    schema:'vantage-jpx-earnings-v1',
    generated_at:null,
    events:[]
  }),false);
  assert.equal(validJpxDataset({
    schema:'vantage-jpx-earnings-v1',
    generated_at:'2026-07-24T00:09:23.116527Z',
    events:[{symbol:'8035.T',date:'2026-07-30'}]
  }),true);
});
