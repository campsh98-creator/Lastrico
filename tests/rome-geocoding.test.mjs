import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server.js';
import { PILOT_AREAS, areaForCoordinate, coordinateInArea, getPilotJourneys } from '../lib/pilot-areas.ts';
import { evaluateTimedGpsReading } from '../lib/navigation-state.ts';
import { geographicDistance } from '../lib/road-intelligence-scoring.ts';
import { loadApi } from './helpers/load-api.mjs';

const { GET } = await loadApi('app/api/geocode/route.ts');
const request = (q, area='rome') => new NextRequest(`http://localhost/api/geocode?${new URLSearchParams({q, area})}`);
let now = Date.now();

test('Rome bounds and presets remain isolated from both existing pilots', () => {
  assert.equal(areaForCoordinate([12.49,41.89])?.id, 'rome');
  assert.equal(coordinateInArea([9.19,45.46], PILOT_AREAS.rome), false);
  assert.equal(coordinateInArea([16.4,38.32], PILOT_AREAS.rome), false);
  for (const journey of getPilotJourneys('rome')) {
    assert.ok(coordinateInArea(journey.start.coordinate, PILOT_AREAS.rome));
    assert.ok(coordinateInArea(journey.end.coordinate, PILOT_AREAS.rome));
  }
  assert.equal(getPilotJourneys('rome').length, 3);
});

test('Rome Nominatim search sends city/bounds and rejects same-name Milan/Roccella matches', async t => {
  now += 100_000; t.mock.method(Date,'now',()=>now);
  const calls=[];
  t.mock.method(globalThis,'fetch',async input => {
    const url = new URL(input); calls.push(url);
    return Response.json([
      {place_id:1,display_name:'Via Roma 23, Roma',lon:12.49,lat:41.9,address:{road:'Via Roma',house_number:'23',city:'Roma'}},
      {place_id:2,display_name:'Via Roma, Milano',lon:9.19,lat:45.46,address:{road:'Via Roma',city:'Milano'}},
      {place_id:3,display_name:'Via Roma, Roccella',lon:16.4,lat:38.32,address:{road:'Via Roma',town:'Roccella Ionica'}},
    ]);
  });
  const response=await GET(request('Via Roma 23'));
  assert.equal(response.status,200);
  const {results}=await response.json();
  assert.equal(results.length,1); assert.match(results[0].secondary,/Roma/);
  assert.equal(calls[0].searchParams.get('city'),'Roma');
  assert.equal(calls[0].searchParams.get('viewbox'),'12.4,41.97,12.6,41.8');
});

test('Rome Photon fallback labels missing locality as Roma, not Milano, without sequential timeout', async t => {
  now += 100_000; t.mock.method(Date,'now',()=>now);
  let photonUrl;
  t.mock.method(globalThis,'fetch',(input,init)=> {
    const url=new URL(input);
    if(url.hostname.includes('nominatim')) return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));
    photonUrl=url;
    return Promise.resolve(Response.json({features:[
      {properties:{osm_id:11,name:'Piazza Cavour'},geometry:{type:'Point',coordinates:[12.4702,41.9075]}},
      {properties:{osm_id:12,name:'Piazza Cavour',city:'Milano'},geometry:{type:'Point',coordinates:[9.19,45.46]}},
    ]}));
  });
  const before=performance.now();
  const response=await GET(request('Piazza Cavour Roma'));
  assert.equal(response.status,200);
  const {results}=await response.json();
  assert.equal(results.length,1); assert.equal(results[0].secondary,'Roma');
  assert.equal(photonUrl.searchParams.get('bbox'),'12.4,41.8,12.6,41.97');
  assert.ok(performance.now()-before<1800,'Photon must retain the Phase 4.22 parallel/hedged path');
});

test('same query cache keys remain city-specific', async t => {
  now += 100_000; t.mock.method(Date,'now',()=>now);
  const calls=[];
  t.mock.method(globalThis,'fetch', async input=>{
    const url=new URL(input); calls.push(url);
    const rome=url.searchParams.get('q')?.endsWith(', Roma');
    return Response.json([{place_id:rome?31:32,display_name:'Piazza condivisa',lon:rome?12.49:9.19,lat:rome?41.9:45.46,address:{city:rome?'Roma':'Milano'}}]);
  });
  const first=await (await GET(request('Piazza condivisa','rome'))).json();
  now+=2000;
  const second=await (await GET(request('Piazza condivisa','milan'))).json();
  assert.equal(calls.length,2); assert.equal(first.results[0].id,'31'); assert.equal(second.results[0].id,'32');
});

test('Rome GPS accepts local fixes and rejects cross-city and stale readings', () => {
  const now=10_000;
  const fix={coordinate:[12.4964,41.9028],accuracy:5,timestamp:now,now,
    previousCoordinate:null,previousAccuracy:null,previousTimestamp:null,
    bounds:PILOT_AREAS.rome.bounds,distanceMeters:geographicDistance,maximumSpeedMetersPerSecond:70};
  assert.equal(evaluateTimedGpsReading(fix).accepted,true);
  for(const coordinate of [PILOT_AREAS.milan.center,PILOT_AREAS.roccella.center])
    assert.equal(evaluateTimedGpsReading({...fix,coordinate}).accepted,false);
  assert.equal(evaluateTimedGpsReading({...fix,timestamp:now-60_000}).accepted,false);
});
