"""Self-contained developer-only geometry viewer: no network requests or assets."""
import json


def write_map(path, rows, probabilities):
    data = [[r["id"], r["area"], r["label"], probabilities.get(r["id"]), r["material"], r["coordinates"]] for r in rows]
    template = r'''<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lastrico — laboratorio superfici, NON navigazione</title>
<style>body{margin:0;background:#101820;color:#eee;font:14px system-ui}header{padding:12px}h1{font-size:19px;margin:0 0 8px}p{margin:6px 0}select,button{font:inherit;margin:4px;padding:5px}label{margin:8px}canvas{display:block;touch-action:none;width:100%;height:75vh}#detail{min-height:2em;color:#ccc}</style>
<header><h1>Esperimento offline — superfici OSM e probabilità pavé</h1>
<p>NON usare per navigare. Probabilità sperimentali, non superfici verificate. Un valore basso non significa asfalto o fondo liscio. Roccella è fuori dalla distribuzione geografica di training.</p>
<select id="area"><option value="milan">Milano</option><option value="roccella">Roccella</option></select><button id="reset">Adatta vista</button>
<label><input id="known" type="checkbox" checked>Etichette esplicite: rosso pavé; azzurro non pavé (può essere sterrato)</label>
<label><input id="pred" type="checkbox" checked>Solo sconosciuti: viola p≥0,5; giallo p&lt;0,5</label>
<label><input id="other" type="checkbox">Grigio: evidenza ambigua/ausiliaria</label>
<p>Rotella per zoom, trascina per muovere. Passa vicino a un tratto per leggere l’etichetta. Nessuna mappa o dato è inviato online.</p><p id="detail">© OpenStreetMap contributors — ODbL-1.0. Geometrie archiviate; nessuna verifica sul campo.</p></header>
<canvas id="map" aria-label="Mappa sperimentale delle geometrie stradali"></canvas>
<script>
const data=__DATA__,canvas=document.getElementById('map'),ctx=canvas.getContext('2d');let scale=1,ox=0,oy=0,visible=[],drag=null;
function project(p){return [p[0]*Math.cos((document.getElementById('area').value==='milan'?45.46:38.32)*Math.PI/180),-p[1]]}
function setup(){visible=data.filter(r=>r[1]===document.getElementById('area').value).map(r=>({...r,points:r[5].map(project)}));fit()}
function fit(){let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const r of visible)for(const [x,y] of r.points){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y)}scale=Math.min(canvas.width/(x1-x0),canvas.height/(y1-y0))*.94;ox=canvas.width/2-(x0+x1)*scale/2;oy=canvas.height/2-(y0+y1)*scale/2;draw()}
function enabled(r){return r[2]!==null?document.getElementById('known').checked:r[3]!==null?document.getElementById('pred').checked:document.getElementById('other').checked}
function draw(){ctx.clearRect(0,0,canvas.width,canvas.height);ctx.lineWidth=1;for(const r of visible){if(!enabled(r))continue;ctx.strokeStyle=r[2]===1?'#ff655b':r[2]===0?'#68bccf':r[3]===null?'#555':r[3]>=.5?'#db81f9':'#d6b351';ctx.globalAlpha=r[3]===null?.7:.45+Math.abs(r[3]-.5);ctx.beginPath();r.points.forEach(([x,y],i)=>i?ctx.lineTo(x*scale+ox,y*scale+oy):ctx.moveTo(x*scale+ox,y*scale+oy));ctx.stroke()}ctx.globalAlpha=1}
function resize(){canvas.width=canvas.clientWidth;canvas.height=canvas.clientHeight;setup()}window.addEventListener('resize',resize);document.getElementById('area').onchange=setup;document.getElementById('reset').onclick=fit;for(const id of ['known','pred','other'])document.getElementById(id).onchange=draw;
canvas.onwheel=e=>{e.preventDefault();const k=e.deltaY<0?1.2:1/1.2;ox=e.offsetX-(e.offsetX-ox)*k;oy=e.offsetY-(e.offsetY-oy)*k;scale*=k;draw()};canvas.onpointerdown=e=>{drag=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId)};canvas.onpointerup=()=>drag=null;canvas.onpointercancel=()=>drag=null;
canvas.onpointermove=e=>{if(drag){ox+=e.clientX-drag[0];oy+=e.clientY-drag[1];drag=[e.clientX,e.clientY];draw();return}let best=null,d=7;for(const r of visible){if(!enabled(r))continue;for(let i=1;i<r.points.length;i++){const a=r.points[i-1].map((v,j)=>v*scale+(j?oy:ox)),b=r.points[i].map((v,j)=>v*scale+(j?oy:ox));const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((e.offsetX-a[0])*dx+(e.offsetY-a[1])*dy)/(dx*dx+dy*dy||1)));const dd=Math.hypot(e.offsetX-a[0]-t*dx,e.offsetY-a[1]-t*dy);if(dd<d){d=dd;best=r}}}if(best)document.getElementById('detail').textContent=best[0]+' — '+(best[2]!==null?'Etichetta OSM: '+best[4]:best[3]!==null?'Superficie sconosciuta; p(pavé) sperimentale='+best[3].toFixed(3):'Materiale ambiguo/ausiliario: '+(best[4]||'non specificato'))};resize();
</script></html>'''
    path.write_text(template.replace('__DATA__', json.dumps(data, separators=(',', ':')).replace('<', '\\u003c')))
