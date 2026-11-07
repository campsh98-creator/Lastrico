import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { NextRequest } from 'next/server.js';
import { loadApi, encodePolyline } from './helpers/load-api.mjs';
import { getSpatialRoadStore, spatialRoadStore, SpatialRoadIntelligenceStore } from '../lib/spatial-road-store.ts';

test('explicit smoothness survives compact hydration without inferring surface', () => {
  const meta = { version:'test',sourceDatasetSha256:'fixture',sourceGeneratedAt:'2026-11-06',totalSegments:1,
    tileGrid:{resolutionDeg:.01}, names:['Fixture'],surfaceVals:['paved'],tagSets:[{surface:'paved',smoothness:'bad'}],
    tiles:{'1249_4190':[['fixture',1,0,[12.49,41.90,12.491,41.90],4,0,0,6,0,7,'residential',83,90,0]]} };
  const road = new SpatialRoadIntelligenceStore(meta, {}, 'rome').getAllRoads()[0];
  assert.equal(road.surfaceCategory,'unknown');
  assert.equal(road.surface.confidence,0);
  assert.equal(road.smoothness.value,'bad');
  assert.equal(road.smoothness.sourceId,'osm:way:1');
  assert.equal(road.smoothness.ingestedAt,meta.sourceGeneratedAt);
});

test('authentic Rome store is isolated and real handler keeps mode, evidence and access notice', async t => {
  const store = await getSpatialRoadStore('rome');
  const manifest = JSON.parse(await readFile(new URL('../data/surfaces/rome-pilot.manifest.json', import.meta.url)));
  assert.equal(store.totalSegments,manifest.statistics.totalSegments);
  assert.equal(store.sourceSha256,manifest.checksums.datasetSha256);
  assert.notEqual(store,spatialRoadStore);
  assert.equal(store.getScopedIntelligence([[9.19,45.46]],50).roads.length,0);
  assert.equal(spatialRoadStore.getScopedIntelligence([[12.49,41.90]],50).roads.length,0);
  const roads = store.getAllRoads();
  const road = roads.find(r => r.modeAccess.car && r.modeAccess.motorcycle && r.modeAccess.bicycle
    && r.surfaceCategory==='confirmed_smooth' && r.lengthMeters>45 && r.lengthMeters<200);
  assert.ok(road);
  assert.ok(roads.some(r=>r.surfaceCategory==='confirmed_rough'));
  assert.ok(roads.some(r=>r.surfaceCategory==='unknown'));
  assert.ok(roads.filter(r=>r.rawTags?.surface==='paved').every(r=>r.surfaceCategory==='unknown'));
  const { GET } = await loadApi('app/api/routes/route.ts');
  let now=Date.now()+100000;
  t.mock.method(Date,'now',()=>now);
  const costing=[];
  t.mock.method(globalThis,'fetch',async (_url,init)=>{
    now+=2000; costing.push(JSON.parse(init.body).costing);
    return Response.json({trip:{status:0,summary:{length:road.lengthMeters/1000,time:30},legs:[{
      shape:encodePolyline(road.coordinates),maneuvers:[{type:1,instruction:'Parti',begin_shape_index:0},{type:4,instruction:'Arrivo',begin_shape_index:1}],
    }]}});
  });
  for(const mode of ['car','motorcycle','bicycle']) {
    for(const navigation of ['0','1']) {
      const params=new URLSearchParams({area:'rome',mode,navigation,start:road.coordinates[0].join(','),end:road.coordinates[1].join(','),maxExtraMinutes:'0'});
      const response=await GET(new NextRequest(`http://localhost/api/routes?${params}`));
      assert.equal(response.status,200);
      const body=await response.json();
      assert.equal(body.area,'rome'); assert.equal(body.transportMode,mode);
      assert.equal(body.calculationMode,navigation==='1'?'navigation':'planner');
      assert.ok(body.fast.smoothSurfaceMeters>0); assert.equal(body.fast.surfaceSource,'osm');
      assert.equal(body.fast.instructions.at(-1).direction,'arrive');
      assert.equal(body.hasDistinctAlternative,false);
      assert.match(body.dataNotice,mode==='bicycle'?/segnaletica/:/Tridente.*moto/);
    }
  }
  assert.deepEqual(costing,['auto','auto','motorcycle','motorcycle','bicycle','bicycle']);
});
