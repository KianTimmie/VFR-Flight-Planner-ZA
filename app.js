// ================= VFR Planner ZA =================
// Internal base units: distance = NM, weight = kg, volume = litres.
// Conversions applied only at input/display edges.

const $ = id => document.getElementById(id);
const NM_PER_KM = 0.539957, KM_PER_NM = 1.852;
const LB_PER_KG = 2.20462, L_PER_USG = 3.78541;
const FUEL_DENSITY = { avgas:0.72, jeta:0.80, mogas:0.74 }; // kg per litre

// ---------- unit state ----------
const U = { dist:'nm', wt:'kg', vol:'L', arm:'m' };
let fuelType = 'avgas';
const density = () => FUEL_DENSITY[fuelType];
const IN_PER_M = 39.3701;

// display converters (base -> shown) and parsers (shown -> base)
const distOut = nm => U.dist==='km' ? nm*KM_PER_NM : nm;
const distUnit = () => U.dist==='km' ? 'km' : 'NM';
const wtOut = kg => U.wt==='lb' ? kg*LB_PER_KG : kg;
const wtIn  = v  => U.wt==='lb' ? v/LB_PER_KG : v;
const wtUnit = () => U.wt;
const volOut = L => U.vol==='usg' ? L/L_PER_USG : L;
const volIn  = v => U.vol==='usg' ? v*L_PER_USG : v;
const volUnit = () => U.vol==='usg' ? 'USG' : 'L';
const speedUnit = () => U.dist==='km' ? 'km/h' : 'kt';
const burnUnit  = () => volUnit()+'/hr';
const armOut = m => U.arm==='in' ? m*IN_PER_M : m;
const armIn  = v => U.arm==='in' ? v/IN_PER_M : v;
const armUnit = () => U.arm;

// ---------- geo ----------
function distance(a,b){
  const R=6371, toRad=d=>d*Math.PI/180;
  const dLat=toRad(b.lat-a.lat), dLon=toRad(b.lon-a.lon), la1=toRad(a.lat), la2=toRad(b.lat);
  const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
  const km=2*R*Math.asin(Math.min(1,Math.sqrt(h)));
  return {km, nm:km*NM_PER_KM};
}
function bearing(a,b){
  const toRad=d=>d*Math.PI/180,toDeg=r=>r*180/Math.PI;
  const dLon=toRad(b.lon-a.lon),la1=toRad(a.lat),la2=toRad(b.lat);
  const y=Math.sin(dLon)*Math.cos(la2);
  const x=Math.cos(la1)*Math.sin(la2)-Math.sin(la1)*Math.cos(la2)*Math.cos(dLon);
  return (toDeg(Math.atan2(y,x))+360)%360;
}
function compass(deg){const d=["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];return d[Math.round(deg/22.5)%16];}
function esc(s){return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
const COUNTRY_NAMES={ZA:'South Africa',BW:'Botswana',NA:'Namibia',MZ:'Mozambique',ZW:'Zimbabwe',ZM:'Zambia',LS:'Lesotho',SZ:'Eswatini'};
function countryName(c){return COUNTRY_NAMES[c]||c||'';}
function hl(t,q){if(!q)return esc(t);const i=t.toLowerCase().indexOf(q.toLowerCase());if(i<0)return esc(t);return esc(t.slice(0,i))+'<mark>'+esc(t.slice(i,i+q.length))+'</mark>'+esc(t.slice(i+q.length));}

// ---------- custom locations (user-added coordinates) ----------
const LS_CUSTOM='vfrza_custom_locations';
function loadCustom(){ try{ return JSON.parse(localStorage.getItem(LS_CUSTOM)||'[]'); }catch(e){ return []; } }
function saveCustom(arr){ try{ localStorage.setItem(LS_CUSTOM, JSON.stringify(arr)); }catch(e){} }
function mergeCustom(){
  // remove any previously merged customs, then re-add from storage
  for(let i=AIRPORTS.length-1;i>=0;i--){ if(AIRPORTS[i].custom) AIRPORTS.splice(i,1); }
  loadCustom().forEach(c=>AIRPORTS.push(Object.assign({custom:true},c)));
}
mergeCustom();

// Parse a coordinate string. Accepts:
//   -25.6, 28.2   |   25.6S 28.2E   |   25 39 13 S, 28 13 27 E (deg min sec)
function parseCoord(str){
  if(!str) return null;
  str=str.trim().replace(/[°'"]/g,' ').replace(/,/g,' ');
  // try simple decimal pair with optional hemisphere letters
  const tokens=str.split(/\s+/).filter(Boolean);
  // hemisphere-letter form
  function dms(parts){ // parts numbers
    if(!parts.length) return null;
    let d=parts[0]||0,m=parts[1]||0,s=parts[2]||0;
    return Math.abs(d)+m/60+s/3600;
  }
  // find letters
  const upper=str.toUpperCase();
  const hasNSEW=/[NSEW]/.test(upper);
  if(hasNSEW){
    // split into lat chunk (before/with N|S) and lon chunk (before/with E|W)
    const latMatch=upper.match(/([\d.\s]+)\s*([NS])/);
    const lonMatch=upper.match(/([\d.\s]+)\s*([EW])/);
    if(latMatch&&lonMatch){
      let lat=dms(latMatch[1].trim().split(/\s+/).map(Number));
      let lon=dms(lonMatch[1].trim().split(/\s+/).map(Number));
      if(latMatch[2]==='S') lat=-lat;
      if(lonMatch[2]==='W') lon=-lon;
      if(isFinite(lat)&&isFinite(lon)) return {lat:+lat.toFixed(5),lon:+lon.toFixed(5)};
    }
    return null;
  }
  // plain decimal pair
  const nums=tokens.map(Number).filter(n=>!isNaN(n));
  if(nums.length>=2){
    const lat=nums[0], lon=nums[1];
    if(Math.abs(lat)<=90 && Math.abs(lon)<=180) return {lat:+lat.toFixed(5),lon:+lon.toFixed(5)};
  }
  return null;
}

function addCustomLocation(){
  const name=prompt('Name this location (e.g. "Smit\'s Farm strip"):'); if(!name) return null;
  const raw=prompt('Coordinates — paste from a map.\nAccepts:\n  -25.65, 28.22\n  25.65S 28.22E\n  25 39 13 S, 28 13 27 E'); if(!raw) return null;
  const c=parseCoord(raw);
  if(!c){ alert('Could not read those coordinates. Try a format like:  -25.65, 28.22'); return null; }
  const loc={name:name.trim(), icao:'', iata:'', city:'Custom', province:'User location', lat:c.lat, lon:c.lon, elev:null};
  const arr=loadCustom(); arr.push(loc); saveCustom(arr); mergeCustom();
  return AIRPORTS.findIndex(a=>a.custom&&a.name===loc.name&&a.lat===loc.lat&&a.lon===loc.lon);
}

// ---------- airport picker ----------
const sel={dep:null,arr:null};
let waypoints=[]; // array of AIRPORTS indices, intermediate stops in order
let curRoute=null; // {stopIdx, depIdx, maxRangeNM} for map renderers
let lastRangeSig=null; // guards range-map re-render
function makePicker(key,inputId,listId){
  const input=$(inputId), list=$(listId); let hlIndex=-1, matches=[];
  const fullLabel=a=>(a.icao||a.iata||'----')+' · '+a.name;
  function search(q){
    q=q.trim().toLowerCase(); if(!q) return AIRPORTS.map((a,i)=>({a,i}));
    const starts=[],contains=[];
    AIRPORTS.forEach((a,i)=>{
      const hay=[a.icao,a.iata,a.name,a.city,a.province,countryName(a.country)].join(' ').toLowerCase();
      const code=(a.icao+' '+a.iata).toLowerCase();
      if(code.startsWith(q)||a.name.toLowerCase().startsWith(q)||a.city.toLowerCase().startsWith(q)) starts.push({a,i});
      else if(hay.includes(q)) contains.push({a,i});
    });
    return starts.concat(contains);
  }
  function renderList(q){
    matches=search(q); hlIndex=-1;
    const footer='<div class="ac-add" data-add="1">＋ Add a custom location (coordinates)</div>'+
                 '<div class="ac-add" data-map="1">🗺 Pick a location on the map</div>';
    if(!matches.length){list.innerHTML='<div class="ac-none">No airport matches \u201C'+esc(q)+'\u201D</div>'+footer;list.classList.add('open');return;}
    list.innerHTML=matches.slice(0,60).map((m)=>{const a=m.a,code=a.icao||a.iata||(a.custom?'PIN':'----');
      return '<div class="ac-opt'+(a.custom?' is-custom':'')+'" data-i="'+m.i+'" role="option"><span class="code">'+(a.custom?'📍':hl(code,q))+'</span>'+
      '<span class="desc"><span class="nm2">'+hl(a.name,q)+'</span><span class="ct">'+hl(a.city,q)+' · '+esc(a.province)+'</span></span></div>';
    }).join('')+footer; list.classList.add('open');
  }
  function choose(i){sel[key]=i;waypoints=[];input.value=fullLabel(AIRPORTS[i]);input.parentElement.classList.add('chosen');list.classList.remove('open');render();}
  function doAdd(){
    const idx=addCustomLocation();
    if(idx>=0){ choose(idx); }
  }
  input.addEventListener('focus',()=>{input.parentElement.classList.remove('chosen');renderList(sel[key]!=null?'':input.value);});
  input.addEventListener('input',()=>{input.parentElement.classList.remove('chosen');sel[key]=null;renderList(input.value);render();});
  input.addEventListener('keydown',e=>{
    const opts=[...list.querySelectorAll('.ac-opt')];
    if(e.key==='ArrowDown'){e.preventDefault();hlIndex=Math.min(opts.length-1,hlIndex+1);}
    else if(e.key==='ArrowUp'){e.preventDefault();hlIndex=Math.max(0,hlIndex-1);}
    else if(e.key==='Enter'){e.preventDefault();(opts[hlIndex]||opts[0])&&(opts[hlIndex]||opts[0]).click();return;}
    else if(e.key==='Escape'){list.classList.remove('open');return;} else return;
    opts.forEach(o=>o.classList.remove('hl'));
    if(opts[hlIndex]){opts[hlIndex].classList.add('hl');opts[hlIndex].scrollIntoView({block:'nearest'});}
  });
  list.addEventListener('mousedown',e=>{
    if(e.target.closest('.ac-add[data-map]')){e.preventDefault();openMapPicker(choose);return;}
    if(e.target.closest('.ac-add[data-add]')){e.preventDefault();doAdd();return;}
    const o=e.target.closest('.ac-opt');if(!o)return;e.preventDefault();choose(+o.dataset.i);
  });
  list.addEventListener('click',e=>{
    if(e.target.closest('.ac-add[data-map]')){openMapPicker(choose);return;}
    if(e.target.closest('.ac-add[data-add]')){doAdd();return;}
    const o=e.target.closest('.ac-opt');if(!o)return;choose(+o.dataset.i);
  });
  return {get:()=>sel[key],setIndex:choose,
    clear(){sel[key]=null;input.value='';input.parentElement.classList.remove('chosen');list.classList.remove('open');},
    clearList(){list.classList.remove('open');}};
}
const depPick=makePicker('dep','depSearch','depList');
const arrPick=makePicker('arr','arrSearch','arrList');
document.addEventListener('click',e=>{if(!e.target.closest('.ac-picker')){depPick.clearList();arrPick.clearList();}});
// visible "pick on map" buttons
$('depMapBtn').addEventListener('click',()=>openMapPicker(i=>depPick.setIndex(i)));
$('arrMapBtn').addEventListener('click',()=>openMapPicker(i=>arrPick.setIndex(i)));

// ---------- passengers ----------
// stored as base kg
let pax=[77, 77];
function renderPax(){
  const box=$('paxList');
  box.innerHTML=pax.map((w,i)=>(
    '<div class="pax-row"><span class="pn">'+(i===0?'Pilot':'Pax '+i)+'</span>'+
    '<input type="number" inputmode="decimal" data-pi="'+i+'" value="'+(+wtOut(w).toFixed(1))+'">'+
    '<button class="rm" data-rm="'+i+'">×</button></div>'
  )).join('');
  box.querySelectorAll('input[data-pi]').forEach(inp=>{
    inp.addEventListener('input',()=>{pax[+inp.dataset.pi]=wtIn(parseFloat(inp.value)||0);render();});
  });
  box.querySelectorAll('button[data-rm]').forEach(b=>{
    b.addEventListener('click',()=>{pax.splice(+b.dataset.rm,1);if(!pax.length)pax=[0];renderPax();render();});
  });
}
$('addPax').onclick=()=>{pax.push(77);renderPax();render();};

// ---------- load allocation block ----------
function updateAlloc(d){
  // d: {availLoad, cargoKg, chosenFuelL, chosenFuelKg, maxFuelL, maxFuelByWeightL, fuelTankLimited, remainingKg, overGross, overTank, tankL, rho}
  $('allocAvail').textContent = n0(wtOut(d.availLoad))+' '+wtUnit()+' available';

  // bar: cargo / fuel / spare as % of availLoad
  const base=d.availLoad>0?d.availLoad:1;
  const pBag=Math.max(0,Math.min(100,d.cargoKg/base*100));
  const pFuel=Math.max(0,Math.min(100-pBag,d.chosenFuelKg/base*100));
  const used=d.cargoKg+d.chosenFuelKg;
  const pSpare=Math.max(0,100-pBag-pFuel);
  const over=used>d.availLoad+0.01;
  $('allocTrack').innerHTML=
    (pBag>0?'<div class="seg bag" style="width:'+pBag+'%">'+(pBag>14?'BAG':'')+'</div>':'')+
    (pFuel>0?'<div class="seg fuel" style="width:'+pFuel+'%">'+(pFuel>14?'FUEL':'')+'</div>':'')+
    (over?'<div class="seg over" style="width:12%">OVER</div>':
      (pSpare>0?'<div class="seg spare" style="width:'+pSpare+'%">'+(pSpare>14?'SPARE':'')+'</div>':''));

  // remaining breakdown
  $('allocRemain').innerHTML=
    '<div class="r"><span class="lab">Baggage</span><span class="val">'+n0(wtOut(d.cargoKg))+' '+wtUnit()+'</span></div>'+
    '<div class="r"><span class="lab">Fuel ('+n0(volOut(d.chosenFuelL))+volUnit()+')</span><span class="val">'+n0(wtOut(d.chosenFuelKg))+' '+wtUnit()+'</span></div>'+
    '<div class="r"><span class="lab">Remaining to MTOW</span><span class="val '+(d.remainingKg<-0.01?'bad':(d.remainingKg<1?'warn':'ok'))+'">'+
      (d.remainingKg<0?'':'+')+n0(wtOut(d.remainingKg))+' '+wtUnit()+'</span></div>'+
    (d.overTank?'<div class="r"><span class="lab">⚠ Tank holds only</span><span class="val bad">'+n0(volOut(d.tankL))+volUnit()+'</span></div>':'');
}

// fill fuel to the max that fits (weight room after current baggage, capped by tank)
$('maxFuel').onclick=()=>{
  const ac=readBase();
  const paxTotal=pax.reduce((s,w)=>s+w,0);
  const room=(ac.mtow-ac.empty-paxTotal-ac.cargo)/density(); // L allowed by weight
  const maxL=Math.max(0, Math.min(ac.fuel, room));
  // round DOWN to a whole unit so we never tip over the weight/tank limit
  $('fuelload').value = Math.floor(volOut(maxL));
  render();
};
// fill baggage to the max that fits given current fuel choice
$('maxBag').onclick=()=>{
  const ac=readBase();
  const paxTotal=pax.reduce((s,w)=>s+w,0);
  const maxBagKg=Math.max(0, ac.mtow-ac.empty-paxTotal-ac.fuelload*density());
  // round DOWN so the loaded weight stays under MTOW
  $('cargo').value = Math.floor(wtOut(maxBagKg));
  render();
};

// ---------- aircraft profiles ----------
const LS='vfrza_aircraft_v2';
function loadProfiles(){try{return JSON.parse(localStorage.getItem(LS)||'{}');}catch(e){return {};}}
function saveProfiles(p){try{localStorage.setItem(LS,JSON.stringify(p));}catch(e){}}
function refreshProfiles(){
  const p=loadProfiles(),s=$('acProfile'),cur=s.value;
  s.innerHTML='<option value="">— Custom —</option>'+Object.keys(p).map(n=>'<option value="'+esc(n)+'">'+esc(n)+'</option>').join('');
  if(p[cur])s.value=cur;
}
// base-unit fields
const NUMFIELDS=['tas','burn','fuel','reserve','empty','mtow','cargo','fuelload'];
// which fields are volume vs weight vs speed for unit conversion at read time
let curGlideRatio=null; // carried from the loaded aircraft profile (optional)
function readBase(){
  // read raw input values and convert to base
  return {
    tas:   U.dist==='km' ? (parseFloat($('tas').value)||0)*NM_PER_KM : (parseFloat($('tas').value)||0), // store as kt
    burn:  volIn(parseFloat($('burn').value)||0),     // L/hr
    fuel:  volIn(parseFloat($('fuel').value)||0),     // L tank capacity
    reserve: parseFloat($('reserve').value)||0,        // min
    empty: wtIn(parseFloat($('empty').value)||0),      // kg
    mtow:  wtIn(parseFloat($('mtow').value)||0),       // kg
    cargo: wtIn(parseFloat($('cargo').value)||0),      // kg
    fuelload: volIn(parseFloat($('fuelload').value)||0), // L chosen to load
    glideRatio: curGlideRatio,                         // :1 (optional, from profile)
  };
}
function writeBase(o){
  if(o.tas!=null)   $('tas').value   = +(U.dist==='km'?o.tas*KM_PER_NM:o.tas).toFixed(1);
  if(o.burn!=null)  $('burn').value  = +volOut(o.burn).toFixed(1);
  if(o.fuel!=null)  $('fuel').value  = +volOut(o.fuel).toFixed(1);
  if(o.reserve!=null)$('reserve').value=o.reserve;
  if(o.empty!=null) $('empty').value = +wtOut(o.empty).toFixed(1);
  if(o.mtow!=null)  $('mtow').value  = +wtOut(o.mtow).toFixed(1);
  if(o.cargo!=null) $('cargo').value = +wtOut(o.cargo).toFixed(1);
  if(o.fuelload!=null) $('fuelload').value = +volOut(o.fuelload).toFixed(1);
  if(o.glideRatio!==undefined) curGlideRatio=o.glideRatio;
}
$('saveAc').onclick=()=>{
  const name=prompt('Name this aircraft (e.g. ZS-ABC C172):'); if(!name)return;
  const p=loadProfiles(); const b=readBase(); b.pax=pax.slice(); b.fuelType=fuelType;
  p[name]=b; saveProfiles(p); refreshProfiles(); $('acProfile').value=name; render();
};
$('delAc').onclick=()=>{
  const name=$('acProfile').value; if(!name)return;
  if(!confirm('Delete "'+name+'"?'))return;
  const p=loadProfiles(); delete p[name]; saveProfiles(p); refreshProfiles(); $('acProfile').value=''; render();
};
$('acProfile').onchange=()=>{
  const o=loadProfiles()[$('acProfile').value]; if(!o)return;
  writeBase(o);
  if(o.pax){pax=o.pax.slice();renderPax();}
  if(o.fuelType){fuelType=o.fuelType;$('fueltype').value=fuelType;}
  render();
};
refreshProfiles();

// ---------- unit toggles ----------
function setUnit(dim, val){
  // capture planner base values (and pax) before switching
  const base=readBase();
  const paxBase=pax.slice();
  // capture form base values if the aircraft form is visible
  const formOpen = $('acForm') && $('acForm').style.display!=='none';
  let fbase=null;
  if(formOpen){
    const tasRaw=parseFloat($('af_tas').value)||0;
    fbase={
      tas: U.dist==='km'? tasRaw*NM_PER_KM : tasRaw,
      burn: volIn(parseFloat($('af_burn').value)||0),
      fuel: volIn(parseFloat($('af_fuel').value)||0),
      empty: wtIn(parseFloat($('af_empty').value)||0),
      mtow: wtIn(parseFloat($('af_mtow').value)||0)
    };
  }
  // CG limits (arm dimension)
  let fwdBase=null, aftBase=null;
  if(dim==='arm'){ fwdBase=armIn(parseFloat($('cgFwd').value)||0); aftBase=armIn(parseFloat($('cgAft').value)||0); }

  U[dim]=val;

  // sync every toggle button for this dimension across the whole page
  document.querySelectorAll('.opts[data-unit="'+dim+'"] button').forEach(b=>{
    b.classList.toggle('on', b.dataset.v===val);
  });

  // rewrite planner fields
  writeBase(base); pax=paxBase; renderPax();
  // rewrite form fields
  if(formOpen && fbase){
    $('af_tas').value   = +(U.dist==='km'?fbase.tas*KM_PER_NM:fbase.tas).toFixed(1);
    $('af_burn').value  = +volOut(fbase.burn).toFixed(1);
    $('af_fuel').value  = +volOut(fbase.fuel).toFixed(1);
    $('af_empty').value = +wtOut(fbase.empty).toFixed(1);
    $('af_mtow').value  = +wtOut(fbase.mtow).toFixed(1);
  }
  // rewrite CG limits
  if(dim==='arm'){ $('cgFwd').value=+armOut(fwdBase).toFixed(3); $('cgAft').value=+armOut(aftBase).toFixed(3); }

  refreshUnitLabels(); render();
}

document.querySelectorAll('.opts[data-unit]').forEach(group=>{
  const dim=group.dataset.unit;
  group.querySelectorAll('button').forEach(btn=>{
    btn.addEventListener('click',()=>setUnit(dim, btn.dataset.v));
  });
});
$('fueltype').onchange=()=>{ fuelType=$('fueltype').value; render(); };

function refreshUnitLabels(){
  document.querySelectorAll('[data-u]').forEach(el=>{
    const t=el.dataset.u;
    if(t==='wt') el.textContent=wtUnit();
    else if(t==='vol') el.textContent=volUnit();
    else if(t==='speed') el.textContent=speedUnit();
    else if(t==='burn') el.textContent=burnUnit();
    else if(t==='arm') el.textContent=armUnit();
  });
}

// ---------- swap ----------
$('swapBtn').onclick=()=>{
  const d=depPick.get(),a=arrPick.get();
  if(a!=null)depPick.setIndex(a);else depPick.clear();
  if(d!=null)arrPick.setIndex(d);else arrPick.clear();
  render();
};

// ---------- format ----------
function hm(h){if(!isFinite(h)||h<0)return '--';const m=Math.round(h*60);return Math.floor(m/60)+'h '+String(m%60).padStart(2,'0')+'m';}
function n0(x){return isFinite(x)?Math.round(x).toLocaleString():'--';}
function n1(x){return isFinite(x)?(+x.toFixed(1)).toLocaleString():'--';}

function alternates(destIdx,depIdx,n){
  const dest=AIRPORTS[destIdx];
  return AIRPORTS.map((a,i)=>({a,i,d:distance(dest,a)}))
    .filter(o=>o.i!==destIdx&&o.i!==depIdx).sort((x,y)=>x.d.km-y.d.km).slice(0,n||4);
}

// Rate an airport as a fuel stop: established (paved, length, IATA) but not a mega-hub.
function stopScore(a){
  if(!a.rwy||!a.rwy.length) return -1;
  const maxLen=Math.max(...a.rwy.map(r=>r.len||0));
  const paved=a.rwy.some(r=>r.surf==='Paved');
  if(maxLen<3000) return -1;
  let s=0;
  if(paved) s+=3;
  if(a.iata) s+=2;
  if(maxLen>=4000) s+=2;
  if(maxLen>=5500) s+=1;
  if(maxLen>9000) s-=3;
  if(a.type==='large_airport') s-=3;
  if(a.type==='medium_airport') s+=2;
  return s;
}
// Suggest reachable, well-sized, roughly-on-the-way fuel stops.
function suggestStops(depIdx, arrIdx, reachNM, n){
  const dep=AIRPORTS[depIdx], arr=AIRPORTS[arrIdx];
  const total=distance(dep,arr);
  const cands=[];
  // allow a smaller proportional detour on long trips (cap the dog-leg in absolute NM too)
  const maxDetour=Math.min(total.nm*0.18, 120);
  AIRPORTS.forEach((a,i)=>{
    if(i===depIdx||i===arrIdx||a.custom) return;
    const score=stopScore(a); if(score<0) return;
    const dFromDep=distance(dep,a).nm;
    const dToArr=distance(a,arr).nm;
    if(dFromDep>reachNM*0.95) return;          // safely reachable with reserve intact
    if(dFromDep<total.nm*0.20) return;         // real progress
    const detour=(dFromDep+dToArr)-total.nm;
    if(detour>maxDetour) return;               // must be genuinely on the way
    // combined rank: detour penalty dominates, size is a tiebreaker bonus
    const rank = detour - score*8;             // lower is better
    cands.push({a,i,dFromDep,dToArr,detour,score,rank});
  });
  cands.sort((x,y)=> x.rank-y.rank);
  return cands.slice(0,n||3);
}

// length in ft -> shown in m or ft per distance unit choice (use m when km selected)
function rwyLen(ft){
  if(ft==null) return '—';
  if(U.dist==='km'){ return n0(ft*0.3048)+' m'; }
  return n0(ft)+' ft';
}
function airportInfoCard(a, title){
  const elev = a.elev!=null ? (U.dist==='km'? n0(a.elev*0.3048)+' m':n0(a.elev)+' ft') : '—';
  const rwys = a.rwy&&a.rwy.length;
  const freqs = a.freq&&a.freq.length;
  // runway section
  let rwyBody;
  if(rwys){
    rwyBody='<div class="rwy-list">'+a.rwy.map(r=>
      '<div class="rwy"><span class="rwy-id">'+esc(r.id||'—')+'</span>'+
      '<span class="rwy-len">'+rwyLen(r.len)+(r.wid?' <em>× '+rwyLen(r.wid)+'</em>':'')+'</span>'+
      '<span class="rwy-surf">'+(r.surf||'—')+(r.lit?' · lit':'')+'</span></div>'
    ).join('')+'</div>';
  } else if(a.custom){
    rwyBody='<div class="ap-note">No runway data yet. Edit this strip in “My strips” to add runways.</div>';
  } else {
    rwyBody='<div class="ap-note">No runway data on file. Verify length, surface &amp; condition before use.</div>';
  }
  // frequency section
  let freqBody;
  if(freqs){
    freqBody='<div class="freq-list">'+a.freq.map(f=>
      '<div class="freq"><span class="freq-svc">'+esc(f.svc)+'</span><span class="freq-mhz">'+esc(f.mhz)+'</span></div>'
    ).join('')+'</div>';
  } else if(a.custom){
    freqBody='<div class="ap-note">No frequencies yet. Edit this strip in “My strips” to add them.</div>';
  } else {
    freqBody='<div class="ap-note">No frequency on file — check the AIP.</div>';
  }
  return '<div class="ap-card"><div class="ap-h"><span class="ap-code">'+(a.icao||a.iata||'📍')+'</span>'+
    '<span class="ap-meta"><b>'+esc(title)+'</b> · '+esc(a.name)+'<br><span class="ap-sub">'+esc(a.city)+' · elev '+elev+'</span></span></div>'+
    '<div class="ap-sec">Runways</div>'+rwyBody+
    '<div class="ap-sec">Frequencies</div>'+freqBody+
    (a.icao?('<div class="ap-sec">Weather</div>'+wxBlockPlaceholder(a.icao)):'')+'</div>';
}

// ---------- main render ----------
function render(){
  const di=depPick.get(), ai=arrPick.get(), res=$('results');
  const ac=readBase();
  const paxTotal=pax.reduce((s,w)=>s+w,0);
  const rho=density();

  // ----- weight & loading (independent of route) -----
  const useful = ac.mtow-ac.empty;                 // kg available over empty (incl people)
  const availLoad = useful-paxTotal;               // kg available for baggage + fuel
  const cargoKg = ac.cargo;                         // kg baggage chosen
  // max fuel the weight allows after baggage:
  const fuelWeightRoomKg = availLoad-cargoKg;       // kg left for fuel
  const maxFuelByWeightL = fuelWeightRoomKg/rho;    // L
  const maxFuelL = Math.max(0, Math.min(ac.fuel, maxFuelByWeightL)); // tank or weight, whichever lower
  const fuelTankLimited = ac.fuel <= maxFuelByWeightL; // tank is the binding ceiling

  // CHOSEN fuel: what the user typed (this is the change). Used everywhere downstream.
  const chosenFuelL = ac.fuelload;
  const chosenFuelKg = chosenFuelL*rho;

  // standalone usable range (reach with reserve intact) — used by the range map
  // even before a destination is chosen, so you can see what's reachable.
  const reserveFuelL_g = (ac.reserve/60)*ac.burn;
  window._usableRangeNM = (ac.tas>0 && chosenFuelL>0) ? Math.max(0,(chosenFuelL-reserveFuelL_g)/ac.burn*ac.tas) : 0;

  const nonFuel = paxTotal+cargoKg;                 // kg
  const tow = ac.empty+nonFuel+chosenFuelKg;        // takeoff weight at CHOSEN fuel
  const overGross = tow > ac.mtow + 0.01;           // over max takeoff weight
  const overTank = chosenFuelL > ac.fuel + 0.01;    // chose more than tank holds
  const remainingKg = ac.mtow-tow;                  // spare capacity (can be negative)

  // weight bar segments (% of MTOW) — uses chosen fuel
  const M=ac.mtow||1;
  const segE=Math.max(0,Math.min(100,ac.empty/M*100));
  const segP=Math.max(0,Math.min(100-segE,paxTotal/M*100));
  const segC=Math.max(0,Math.min(100-segE-segP,cargoKg/M*100));
  const segF=Math.max(0,Math.min(100-segE-segP-segC,chosenFuelKg/M*100));
  const segFree=Math.max(0,100-segE-segP-segC-segF);

  // ----- update the allocation block UI (live) -----
  updateAlloc({availLoad, cargoKg, chosenFuelL, chosenFuelKg, maxFuelL, maxFuelByWeightL,
    fuelTankLimited, remainingKg, overGross, overTank, tankL:ac.fuel, rho});

  // ----- route-dependent (multi-leg aware) -----
  let routeBlock='';
  if(di!=null && ai!=null && di!==ai){
    const dep=AIRPORTS[di],arr=AIRPORTS[ai];
    const reserveFuelL=(ac.reserve/60)*ac.burn;
    const onBoardL=chosenFuelL;
    const maxRangeNM=ac.tas>0?(onBoardL-reserveFuelL)/ac.burn*ac.tas:0; // reach with reserve intact

    // stop list: dep, waypoints..., arr  (filter any stale waypoint indices)
    const wps=waypoints.filter(w=>w!=null && w!==di && w!==ai && AIRPORTS[w]);
    const stopIdx=[di,...wps,ai];
    // expose for the route-map renderer (called after innerHTML set)
    curRoute={stopIdx:stopIdx.slice(), depIdx:di, maxRangeNM};
    const legs=[];
    for(let k=0;k<stopIdx.length-1;k++){
      const A=AIRPORTS[stopIdx[k]], B=AIRPORTS[stopIdx[k+1]];
      const d=distance(A,B), brg=bearing(A,B);
      const ete=ac.tas>0?d.nm/ac.tas:Infinity;
      const tripFuelL=ete*ac.burn;
      const needL=tripFuelL+reserveFuelL;
      const okFuel = onBoardL>=needL;          // each leg flown on a fresh (refuelled) load
      const okRange = d.nm<=maxRangeNM;
      legs.push({A,B,d,brg,ete,tripFuelL,needL,okFuel,okRange,
        fromIdx:stopIdx[k],toIdx:stopIdx[k+1]});
    }
    const totalNM=legs.reduce((s,l)=>s+l.d.nm,0);
    const totalH=legs.reduce((s,l)=>s+(isFinite(l.ete)?l.ete:0),0);
    const allLegsOK=legs.every(l=>l.okFuel&&!overGross&&!overTank);
    const multi=legs.length>1;

    // route line with all stops
    const routeCodes=stopIdx.map(ix=>AIRPORTS[ix].icao||AIRPORTS[ix].iata||'—');
    const routeLine='<div class="route-line">'+
      routeCodes.map((c,k)=>(k?'<span class="dash"></span>':'')+'<span class="icao">'+esc(c)+'</span>').join('')+'</div>';

    // per-leg cards
    let legCards='';
    legs.forEach((l,k)=>{
      const tag=multi?('Leg '+(k+1)+' · '):'';
      const farTooFar=!l.okRange;
      legCards+='<div class="leg-card">'+
        '<div class="leg-h">'+tag+esc(l.A.icao||l.A.name)+' → '+esc(l.B.icao||l.B.name)+
          '<span class="leg-dist">'+n0(distOut(l.d.nm))+' '+distUnit()+'</span></div>'+
        '<div class="leg-row"><span>Time '+hm(l.ete)+'</span><span>Trip fuel '+n0(volOut(l.tripFuelL))+volUnit()+'</span>'+
          '<span class="'+(l.okFuel?'ok':'bad')+'">'+(l.okFuel?'fuel OK':'need '+n0(volOut(l.needL))+volUnit())+'</span></div>'+
        (farTooFar?'<div class="leg-warn">⚠ This leg ('+n0(distOut(l.d.nm))+' '+distUnit()+') exceeds your '+n0(distOut(maxRangeNM))+' '+distUnit()+' range with reserve. Add a stop to break it up.</div>':'')+
        '</div>';
      // suggest stops for any leg that's beyond range
      if(farTooFar && maxRangeNM>0){
        const stops=suggestStops(l.fromIdx,l.toIdx,maxRangeNM,3);
        if(stops.length){
          legCards+='<div class="stops-card"><div class="card-h">Suggested fuel stops for this leg</div>'+
            stops.map(s=>{
              const a=s.a;
              const len=a.rwy.length?Math.max(...a.rwy.map(r=>r.len||0)):null;
              return '<div class="stop"><div class="info">'+
                '<div class="nm">'+esc(a.name)+(a.country!=='ZA'?' <span class="ctag">'+esc(countryName(a.country))+'</span>':'')+'</div>'+
                '<div class="meta">'+(a.icao||a.iata||'----')+' · '+esc(a.city)+' · '+(len?rwyLen(len)+' '+(a.rwy.some(r=>r.surf==="Paved")?'paved':'strip'):'runway n/a')+'</div></div>'+
                '<div class="stop-d">'+n0(distOut(s.dFromDep))+'<small>'+distUnit()+' in</small></div>'+
                '<button class="stop-add" data-add-wp="'+s.i+'" data-after="'+l.fromIdx+'">＋</button></div>';
            }).join('')+
            '<div class="hint">Reachable with reserve intact. Likely to have fuel — but confirm fuel availability &amp; that the field is open before you rely on it.</div></div>';
        }
      }
      // ALWAYS offer "add any airport/strip as a stop" on this leg
      legCards+='<div class="addstop-wrap" data-after="'+l.fromIdx+'">'+
        '<button class="addstop-toggle" data-addstop-toggle>＋ Add any airport or strip as a stop on this leg</button>'+
        '<div class="addstop-picker">'+
          '<input type="text" placeholder="Type ICAO, name, city or country…" data-addstop-input>'+
          '<div class="addstop-list" data-addstop-list></div>'+
        '</div></div>';
    });

    // waypoint chips (removable)
    let wpChips='';
    if(wps.length){
      wpChips='<div class="wp-chips">'+wps.map(w=>{
        const a=AIRPORTS[w];
        return '<span class="wp-chip">'+esc(a.icao||a.name)+'<button data-rm-wp="'+w+'">×</button></span>';
      }).join('')+'</div>';
    }

    const alts=alternates(ai,di,4);

    routeBlock=
    '<div class="readout">'+
      routeLine+
      '<div class="big">'+n0(distOut(totalNM))+' <small>'+distUnit()+(multi?' total':'')+'</small></div>'+
      '<div class="hint">'+(multi?legs.length+' legs · ':'track '+n0(legs[0].brg)+'°T ('+compass(legs[0].brg)+') · ')+'total time '+hm(totalH)+'</div>'+
      wpChips+
      '<div class="stats">'+
        '<div class="stat"><div class="k">Fuel on board</div><div class="v neutral">'+n0(volOut(onBoardL))+' '+volUnit()+'</div></div>'+
        '<div class="stat"><div class="k">Reserve ('+n0(ac.reserve)+'m)</div><div class="v warn">'+n0(volOut(reserveFuelL))+' '+volUnit()+'</div></div>'+
        '<div class="stat"><div class="k">Range w/ reserve</div><div class="v neutral">'+n0(distOut(maxRangeNM))+' '+distUnit()+'</div></div>'+
        '<div class="stat"><div class="k">Takeoff weight</div><div class="v '+(overGross?'bad':'neutral')+'">'+n0(wtOut(tow))+' '+wtUnit()+'</div></div>'+
      '</div>'+
      '<div class="verdict '+(allLegsOK?'go':'nogo')+'"><span class="big-icon">'+(allLegsOK?'✓':'✕')+'</span>'+
        (allLegsOK?(multi?'GO — ALL LEGS OK (refuel at each stop)':'GO — FUEL &amp; WEIGHT OK FOR THIS LEG'):
          (overTank?'FUEL EXCEEDS TANK — reduce fuel load':(overGross?'OVER MAX WEIGHT — offload before flight':'A LEG IS OUT OF RANGE — add a fuel stop')))+'</div>'+
      (multi?'<div class="hint" style="margin-top:10px">Each leg assumes you refuel to your chosen fuel load at the previous stop. Weight &amp; CG above reflect departure with that fuel.</div>':'')+
    '</div>'+
    '<div class="card"><div class="card-h">Flight legs</div>'+legCards+'</div>'+
    '<div class="card"><div class="card-h">Route map</div>'+
      '<div class="routemap-wrap"><div id="routeMap" class="routemap"></div></div>'+
      '<div class="hint">Departure, stops &amp; destination in order. Uses the online map when connected, a plain plot when offline.</div></div>'+
    '<div class="card"><div class="card-h">Airfield information</div>'+
      airportInfoCard(dep,'Departure')+airportInfoCard(arr,'Destination')+
      '<div class="hint">Runway data from OurAirports — a planning reference, not the official AIP. Verify before use.</div></div>'+
    '<div class="card"><div class="card-h">Emergency alternates near destination</div><div class="alt-list">'+
      alts.map((o,k)=>{const a=o.a,b=bearing(arr,a);
        return '<div class="alt"><div class="rank">'+(k+1)+'</div><div class="info"><div class="nm">'+esc(a.name)+'</div>'+
        '<div class="meta">'+(a.icao||a.iata||'----')+' · '+esc(a.city)+' · '+compass(b)+'</div></div>'+
        '<div class="dist">'+n0(distOut(o.d.nm))+'<small>'+distUnit()+' from '+(arr.icao||'dest')+'</small></div></div>';
      }).join('')+
      '</div><div class="hint">Closest fields to your destination if '+(arr.icao||'destination')+' is unavailable.</div></div>';
  } else {
    curRoute=null;
    routeBlock='<div class="card"><div class="empty">SELECT DEPARTURE &amp; DESTINATION<br>to compute the flight leg</div></div>';
  }

  // ----- weight card (always shown) -----
  const pie = donutSVG([
    {label:'Empty', kg:ac.empty, color:'#5a6b7d'},
    {label:'People', kg:paxTotal, color:'#a78bfa'},
    {label:'Cargo', kg:cargoKg, color:'#3fd0ff'},
    {label:'Fuel', kg:chosenFuelKg, color:'#27d796'},
    {label:'Spare', kg:Math.max(0, remainingKg), color:'#1a2230'}
  ], ac.mtow);

  const weightBlock=
    '<div class="readout">'+
      '<div class="card-h" style="margin-bottom:14px">Loading summary · '+
        ($('fueltype').selectedOptions[0]?$('fueltype').selectedOptions[0].textContent.split(' · ')[0]:'')+' @ '+rho.toFixed(2)+' kg/L</div>'+
      '<div class="pie-wrap">'+pie+'</div>'+
      '<div class="wbar"><div class="track">'+
        (segE>0?'<div class="seg empty-w" style="width:'+segE+'%">'+(segE>14?'EMPTY':'')+'</div>':'')+
        (segP>0?'<div class="seg pax-w" style="width:'+segP+'%">'+(segP>12?'PAX':'')+'</div>':'')+
        (segC>0?'<div class="seg cargo-w" style="width:'+segC+'%">'+(segC>12?'CARGO':'')+'</div>':'')+
        (segF>0?'<div class="seg fuel-w" style="width:'+segF+'%">'+(segF>12?'FUEL':'')+'</div>':'')+
        (overGross||overTank?'<div class="seg over-w" style="width:12%">OVER</div>':'')+
      '</div><div class="legend">'+
        '<span><i class="dot" style="background:#5a6b7d"></i>Empty '+n0(wtOut(ac.empty))+wtUnit()+'</span>'+
        '<span><i class="dot" style="background:#a78bfa"></i>People '+n0(wtOut(paxTotal))+wtUnit()+' ('+pax.length+')</span>'+
        '<span><i class="dot" style="background:#3fd0ff"></i>Cargo '+n0(wtOut(cargoKg))+wtUnit()+'</span>'+
        '<span><i class="dot" style="background:#27d796"></i>Fuel '+n0(wtOut(chosenFuelKg))+wtUnit()+'</span>'+
      '</div></div>'+
      '<div class="stats">'+
        '<div class="stat"><div class="k">Available load</div><div class="v neutral">'+n0(wtOut(availLoad))+' '+wtUnit()+'</div></div>'+
        '<div class="stat"><div class="k">People + cargo</div><div class="v neutral">'+n0(wtOut(nonFuel))+' '+wtUnit()+'</div></div>'+
        '<div class="stat"><div class="k">Fuel loaded</div><div class="v '+(overGross||overTank?'bad':'ok')+'">'+n0(volOut(chosenFuelL))+' '+volUnit()+'</div></div>'+
        '<div class="stat"><div class="k">Max fuel possible</div><div class="v warn">'+n0(volOut(maxFuelL))+' '+volUnit()+'</div></div>'+
        '<div class="stat"><div class="k">Takeoff weight</div><div class="v '+(overGross?'bad':'neutral')+'">'+n0(wtOut(tow))+' '+wtUnit()+'</div></div>'+
        '<div class="stat"><div class="k">Spare to MTOW</div><div class="v '+(remainingKg<0?'bad':'neutral')+'">'+n0(wtOut(remainingKg))+' '+wtUnit()+'</div></div>'+
      '</div>'+
      '<div class="mtow-line"><span>Takeoff weight</span><span><b>'+n0(wtOut(tow))+' '+wtUnit()+'</b> / '+n0(wtOut(ac.mtow))+' '+wtUnit()+' MTOW</span></div>'+
    '</div>';

  res.innerHTML=weightBlock+routeBlock;
  renderCG(ac, paxTotal);
  // wire waypoint add/remove (delegation, re-bound each render)
  res.querySelectorAll('[data-add-wp]').forEach(b=>b.addEventListener('click',()=>{
    insertWaypoint(+b.dataset.addWp, +b.dataset.after); render();
  }));
  res.querySelectorAll('[data-rm-wp]').forEach(b=>b.addEventListener('click',()=>{
    const wp=+b.dataset.rmWp; const pos=waypoints.indexOf(wp);
    if(pos>=0) waypoints.splice(pos,1); render();
  }));
  // wire "add any airport/strip as a stop" pickers
  res.querySelectorAll('.addstop-wrap').forEach(wrap=>{
    const after=+wrap.dataset.after;
    const toggle=wrap.querySelector('[data-addstop-toggle]');
    const picker=wrap.querySelector('.addstop-picker');
    const input=wrap.querySelector('[data-addstop-input]');
    const listEl=wrap.querySelector('[data-addstop-list]');
    toggle.addEventListener('click',()=>{
      picker.classList.toggle('open');
      if(picker.classList.contains('open')){ input.focus(); renderAddStopList(''); }
    });
    function renderAddStopList(q){
      q=q.trim().toLowerCase();
      let res2;
      if(!q){ res2=AIRPORTS.map((a,i)=>({a,i})).slice(0,40); }
      else {
        const starts=[],contains=[];
        AIRPORTS.forEach((a,i)=>{
          const hay=[a.icao,a.iata,a.name,a.city,a.province,countryName(a.country)].join(' ').toLowerCase();
          const code=((a.icao||'')+' '+(a.iata||'')).toLowerCase();
          if(code.startsWith(q)||a.name.toLowerCase().startsWith(q)||(a.city||'').toLowerCase().startsWith(q)) starts.push({a,i});
          else if(hay.includes(q)) contains.push({a,i});
        });
        res2=starts.concat(contains).slice(0,40);
      }
      listEl.innerHTML=res2.map(m=>{const a=m.a,code=a.icao||a.iata||(a.custom?'📍':'----');
        return '<div class="ac-opt" data-pick="'+m.i+'"><span class="code">'+(a.custom?'📍':esc(code))+'</span>'+
          '<span class="desc"><span class="nm2">'+esc(a.name)+'</span><span class="ct">'+esc(a.city||'')+' · '+esc(a.province||countryName(a.country))+'</span></span></div>';
      }).join('') || '<div class="ac-none">No match</div>';
      listEl.querySelectorAll('[data-pick]').forEach(o=>o.addEventListener('click',()=>{
        insertWaypoint(+o.dataset.pick, after); render();
      }));
    }
    input.addEventListener('input',()=>renderAddStopList(input.value));
  });
  // route map div is rebuilt every render, so always (re)draw it when present
  if(curRoute && $('routeMap')) renderRouteMap();
  // range map element persists; only re-render when its inputs change (avoids flicker per keystroke)
  const rsig=(depPick.get())+'|'+Math.round(window._usableRangeNM||0)+'|'+U.dist;
  if(rsig!==lastRangeSig){ lastRangeSig=rsig; renderRangeMap(); }
  // load weather for any airport cards now shown (debounced so we don't spam the API per keystroke)
  clearTimeout(window._wxTimer);
  window._wxTimer=setTimeout(()=>{ if(typeof hydrateWxBlocks==='function') hydrateWxBlocks($('results')); }, 600);
}

// insert a waypoint index after a given stop index (which may be dep or another wp)
function insertWaypoint(wp, after){
  if(wp===depPick.get()||wp===arrPick.get()) return; // can't add dep/arr as a stop
  if(waypoints.includes(wp)) return;                 // already a stop
  const di=depPick.get();
  if(after===di){ waypoints.unshift(wp); }
  else {
    const pos=waypoints.indexOf(after);
    if(pos>=0) waypoints.splice(pos+1,0,wp); else waypoints.push(wp);
  }
}

// ---------- donut/pie chart (SVG) ----------
function donutSVG(parts, total){
  total = total>0?total:parts.reduce((s,p)=>s+Math.max(0,p.kg),0)||1;
  const R=54, r=33, cx=64, cy=64, C=2*Math.PI*R;
  let acc=0;
  const segs=parts.filter(p=>p.kg>0.5).map(p=>{
    const frac=Math.max(0,p.kg)/total;
    const len=frac*C;
    const seg='<circle cx="'+cx+'" cy="'+cy+'" r="'+R+'" fill="none" stroke="'+p.color+'" '+
      'stroke-width="'+(R-r)+'" stroke-dasharray="'+len+' '+(C-len)+'" '+
      'stroke-dashoffset="'+(-acc)+'" transform="rotate(-90 '+cx+' '+cy+')"/>';
    acc+=len; return seg;
  }).join('');
  const usedPct=Math.round(parts.filter(p=>p.label!=='Spare').reduce((s,p)=>s+Math.max(0,p.kg),0)/total*100);
  const legend=parts.filter(p=>p.kg>0.5).map(p=>
    '<span><i class="dot" style="background:'+p.color+'"></i>'+p.label+' '+Math.round(p.kg/total*100)+'%</span>'
  ).join('');
  return '<svg viewBox="0 0 128 128" class="donut">'+segs+
    '<text x="64" y="60" text-anchor="middle" class="donut-big">'+usedPct+'%</text>'+
    '<text x="64" y="76" text-anchor="middle" class="donut-sub">of MTOW</text></svg>'+
    '<div class="pie-legend">'+legend+'</div>';
}

// ================= CG / BALANCE (optional) =================
let cgOn=false;
// stations: fixed ones + dynamic baggage. {id,name,locked, w(kg), arm(m)}
let cgBags=[ {name:'Baggage 1', w:0, arm:2.6} ];

$('cgEnable').addEventListener('change', e=>{
  cgOn=e.target.checked;
  $('cgBody').classList.toggle('open', cgOn);
  render();
});
$('addBag').addEventListener('click', ()=>{
  cgBags.push({name:'Baggage '+(cgBags.length+1), w:0, arm:2.6});
  render();
});

// arms for the fixed stations (editable, base = m)
let cgArm={ empty:2.05, pilot:2.30, paxFront:2.30, fuel:2.20 };

function renderCG(ac, paxTotal){
  if(!cgOn){ $('cgStations').innerHTML=''; $('cgResult').innerHTML=''; return; }
  const rho=density();
  const fuelKg=ac.fuelload*rho; // use the fuel the user chose to load

  // build station list (weights in kg base, arms in m base)
  const stations=[
    {key:'empty', name:'Aircraft (empty)', w:ac.empty, arm:cgArm.empty, locked:true},
    {key:'pilot', name:'Pilot', w:pax[0]||0, arm:cgArm.pilot, locked:true},
    {key:'paxFront', name:'Front pax', w:pax[1]||0, arm:cgArm.paxFront, locked:true},
    {key:'fuel', name:'Fuel ('+Math.round(volOut(fuelKg/rho))+volUnit()+')', w:fuelKg, arm:cgArm.fuel, locked:true},
  ];
  cgBags.forEach((b,i)=> stations.push({key:'bag'+i, name:b.name, w:b.w, arm:b.arm, locked:false, bagIndex:i}));

  // render rows
  $('cgStations').innerHTML = stations.map((s)=>{
    const wv=+wtOut(s.w).toFixed(1), av=+armOut(s.arm).toFixed(3);
    return '<div class="st-row'+(s.locked?' locked':'')+'">'+
      '<span class="nm">'+esc(s.name)+'</span>'+
      '<input type="number" inputmode="decimal" data-st="'+s.key+'" data-f="w" value="'+wv+'">'+
      '<input type="number" inputmode="decimal" data-st="'+s.key+'" data-f="arm" value="'+av+'">'+
      (s.locked?'<span></span>':'<button class="rm" data-rmbag="'+s.bagIndex+'">×</button>')+
      '</div>';
  }).join('');

  // wire inputs
  $('cgStations').querySelectorAll('input').forEach(inp=>{
    inp.addEventListener('input',()=>{
      const k=inp.dataset.st, f=inp.dataset.f, val=parseFloat(inp.value)||0;
      if(k.startsWith('bag')){
        const i=+k.slice(3);
        if(f==='w') cgBags[i].w=wtIn(val); else cgBags[i].arm=armIn(val);
      } else if(f==='arm'){
        cgArm[k]=armIn(val);
      } else if(f==='w'){
        // editing a locked weight feeds back to the source field up top
        if(k==='empty'){ $('empty').value=+wtOut(wtIn(val)).toFixed(1); ac.empty=wtIn(val); }
        else if(k==='pilot'){ pax[0]=wtIn(val); renderPax(); }
        else if(k==='paxFront'){ pax[1]=wtIn(val); renderPax(); }
        // fuel weight is derived; ignore manual edit
      }
      render();
    });
  });
  $('cgStations').querySelectorAll('button[data-rmbag]').forEach(b=>{
    b.addEventListener('click',()=>{ cgBags.splice(+b.dataset.rmbag,1); if(!cgBags.length)cgBags=[{name:'Baggage 1',w:0,arm:2.6}]; render(); });
  });

  // compute CG
  const totW=stations.reduce((s,x)=>s+x.w,0);
  const totM=stations.reduce((s,x)=>s+x.w*x.arm,0);
  const cg= totW>0 ? totM/totW : 0;
  const fwd=armIn(parseFloat($('cgFwd').value)||0);
  const aft=armIn(parseFloat($('cgAft').value)||0);
  const inEnv = cg>=Math.min(fwd,aft) && cg<=Math.max(fwd,aft);

  // envelope strip geometry: pad 12% each side of the limit span
  const lo=Math.min(fwd,aft), hi=Math.max(fwd,aft), span=(hi-lo)||1;
  const padL=lo-span*0.35, padR=hi+span*0.35, full=padR-padL;
  const pct=x=>Math.max(0,Math.min(100,(x-padL)/full*100));
  const bandL=pct(lo), bandR=pct(hi), mark=pct(cg);

  $('cgResult').innerHTML=
    '<div class="cg-env">'+
      '<div class="cg-readout '+(inEnv?'':'')+'" style="color:'+(inEnv?'var(--green)':'var(--red)')+'">'+
        (+armOut(cg).toFixed(3))+' <small>'+armUnit()+' '+(inEnv?'· IN LIMITS':'· OUT OF LIMITS')+'</small></div>'+
      '<div class="hint">Loaded CG = total moment ('+totM.toFixed(0)+' kg·m) ÷ total weight ('+n0(totW)+' kg)</div>'+
      '<div class="cg-track">'+
        '<div class="cg-band" style="left:'+bandL+'%;width:'+(bandR-bandL)+'%"></div>'+
        '<div class="cg-lbl" style="left:'+bandL+'%">FWD '+(+armOut(lo).toFixed(2))+'</div>'+
        '<div class="cg-lbl" style="left:'+bandR+'%">AFT '+(+armOut(hi).toFixed(2))+'</div>'+
        '<div class="cg-marker '+(inEnv?'':'bad')+'" style="left:'+mark+'%"></div>'+
      '</div>'+
      '<div class="verdict '+(inEnv?'go':'nogo')+'" style="margin-top:18px"><span class="big-icon">'+(inEnv?'✓':'✕')+'</span>'+
        (inEnv?'CG WITHIN LIMITS':'CG OUTSIDE LIMITS — redistribute load')+'</div>'+
      '<div class="hint" style="margin-top:10px">Fixed limits, takeoff CG only. CG shifts as fuel burns — also check landing CG with reserves. Arms must come from your aircraft POH.</div>'+
    '</div>';
}

// arm unit toggle is added dynamically to the units card
// (moment-arm toggle is handled by the unified setUnit() handler above)

// recompute on input
NUMFIELDS.forEach(id=>{$(id).addEventListener('input',render);$(id).addEventListener('change',render);});
['cgFwd','cgAft'].forEach(id=>$(id).addEventListener('input',render));
renderPax();
refreshUnitLabels();
render();

// ================= MAP PICKER (Leaflet online, canvas offline) =================
// SA bounding box for offline plot
const SA_BOUNDS={minLat:-35.0,maxLat:-22.0,minLon:16.0,maxLon:33.5};
let mapState={ onChoose:null, picked:null, leaflet:null, marker:null, mode:null };

function destroyInlineMaps(){
  // Remove the range & route Leaflet instances so their panes can't bleed
  // through on top of the picker modal (Leaflet panes stack above the modal).
  if(rangeMapObj){ try{rangeMapObj.remove();}catch(e){} rangeMapObj=null;
    const el=$('rangeMap'); if(el){ el._leaflet_id=null; el.innerHTML=''; } }
  if(routeMapObj){ try{routeMapObj.remove();}catch(e){} routeMapObj=null;
    const el=$('routeMap'); if(el){ el._leaflet_id=null; el.innerHTML=''; } }
  lastRangeSig=null; // force the range map to rebuild next render
}
function openMapPicker(onChoose){
  mapState.onChoose=onChoose; mapState.picked=null;
  destroyInlineMaps();                 // clear inline maps so they don't overlay the modal
  $('mapConfirm').disabled=true;
  $('mapCoord').textContent='Tap the map to drop a pin';
  $('mapModal').classList.add('open');
  // Prefer the real map whenever Leaflet is available, regardless of the
  // sometimes-unreliable navigator.onLine flag. Give the library a brief
  // moment in case the <script> is still finishing loading.
  let waited=0;
  (function tryStart(){
    if(typeof L!=='undefined'){ initLeaflet(); return; }
    if(waited>=1500){ initOffline('Map library unavailable — using offline plot'); return; }
    waited+=150; setTimeout(tryStart,150);
  })();
}
function closeMapPicker(){
  $('mapModal').classList.remove('open');
  if(mapState.leaflet){ mapState.leaflet.remove(); mapState.leaflet=null; mapState.marker=null; }
  render(); // rebuild the inline maps now that the modal is gone
}
$('mapClose').onclick=closeMapPicker;

$('mapConfirm').onclick=()=>{
  if(!mapState.picked) return;
  const name=prompt('Name this location (e.g. "Smit\'s Farm strip"):');
  if(!name){ return; }
  const loc={name:name.trim(),icao:'',iata:'',city:'Custom',province:'User location',
    lat:+mapState.picked.lat.toFixed(5),lon:+mapState.picked.lon.toFixed(5),elev:null,rwy:[]};
  const arr=loadCustom(); arr.push(loc); saveCustom(arr); mergeCustom();
  const idx=AIRPORTS.findIndex(a=>a.custom&&a.name===loc.name&&a.lat===loc.lat&&a.lon===loc.lon);
  closeMapPicker();
  if(idx>=0 && mapState.onChoose) mapState.onChoose(idx);
};

function setPicked(lat,lon){
  mapState.picked={lat,lon};
  $('mapCoord').innerHTML='Pin at <b>'+lat.toFixed(5)+', '+lon.toFixed(5)+'</b>';
  $('mapConfirm').disabled=false;
}

// ---- Leaflet (online) ----
function initLeaflet(){
  $('mapEl').style.display='block';
  $('offmapWrap').style.display='none';
  $('mapMode').textContent='Online map · OpenStreetMap';
  if(typeof L==='undefined'){ initOffline('Map library unavailable — using offline plot'); return; }
  // build map
  if(mapState.leaflet){ mapState.leaflet.remove(); }
  const map=L.map('mapEl',{zoomControl:true}).setView([-29,25],5);
  mapState.leaflet=map; mapState.mode='leaflet';
  let tileErrors=0;
  const tiles=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    maxZoom:18, attribution:'© OpenStreetMap'
  });
  tiles.on('tileerror',()=>{ tileErrors++; if(tileErrors>4 && mapState.mode==='leaflet'){ map.remove(); mapState.leaflet=null; initOffline('Map tiles unreachable — using offline plot'); } });
  tiles.addTo(map);
  // plot airports
  AIRPORTS.forEach(a=>{
    if(a.custom) return;
    const m=L.circleMarker([a.lat,a.lon],{radius:3,color:'#ffb000',weight:1,fillColor:'#ffb000',fillOpacity:.6});
    m.bindTooltip((a.icao||a.name),{direction:'top'});
    m.on('click',()=>{ setPicked(a.lat,a.lon); placeMarker(a.lat,a.lon); });
    m.addTo(map);
  });
  map.on('click',e=>{ setPicked(e.latlng.lat,e.latlng.lng); placeMarker(e.latlng.lat,e.latlng.lng); });
  setTimeout(()=>map.invalidateSize(),200);
}
function placeMarker(lat,lon){
  const map=mapState.leaflet; if(!map) return;
  if(mapState.marker) map.removeLayer(mapState.marker);
  mapState.marker=L.marker([lat,lon]).addTo(map);
}

// ---- Offline canvas plot ----
function initOffline(note){
  $('mapEl').style.display='none';
  $('offmapWrap').style.display='flex';
  mapState.mode='offline';
  $('mapMode').textContent=note||'Offline plot · tap to place pin';
  const cv=$('offmap');
  const wrap=$('offmapWrap');
  const dpr=window.devicePixelRatio||1;
  const w=wrap.clientWidth-20, h=wrap.clientHeight-20;
  cv.width=w*dpr; cv.height=h*dpr; cv.style.width=w+'px'; cv.style.height=h+'px';
  const ctx=cv.getContext('2d'); ctx.scale(dpr,dpr);

  const B=SA_BOUNDS, pad=14;
  function toXY(lat,lon){
    const x=pad+(lon-B.minLon)/(B.maxLon-B.minLon)*(w-2*pad);
    const y=pad+(B.maxLat-lat)/(B.maxLat-B.minLat)*(h-2*pad);
    return [x,y];
  }
  function toLatLon(x,y){
    const lon=B.minLon+(x-pad)/(w-2*pad)*(B.maxLon-B.minLon);
    const lat=B.maxLat-(y-pad)/(h-2*pad)*(B.maxLat-B.minLat);
    return [lat,lon];
  }
  let pin=null;
  function draw(){
    ctx.clearRect(0,0,w,h);
    ctx.fillStyle='#0c1119'; ctx.fillRect(0,0,w,h);
    ctx.strokeStyle='#22303f'; ctx.lineWidth=1; ctx.strokeRect(.5,.5,w-1,h-1);
    // graticule
    ctx.strokeStyle='#161e29'; ctx.fillStyle='#3a4757'; ctx.font='9px monospace';
    for(let lon=18;lon<=32;lon+=2){ const [x]=toXY(0,lon); ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke(); ctx.fillText(lon+'E',x+2,h-4); }
    for(let lat=-34;lat<=-22;lat+=2){ const [,y]=toXY(lat,0); ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke(); ctx.fillText(Math.abs(lat)+'S',3,y-2); }
    // airports
    AIRPORTS.forEach(a=>{ if(a.custom)return; const [x,y]=toXY(a.lat,a.lon);
      ctx.fillStyle='rgba(255,176,0,.55)'; ctx.beginPath(); ctx.arc(x,y,2,0,7); ctx.fill(); });
    // pin
    if(pin){ const [x,y]=toXY(pin[0],pin[1]);
      ctx.strokeStyle='#27d796'; ctx.lineWidth=2; ctx.beginPath();ctx.arc(x,y,7,0,7);ctx.stroke();
      ctx.fillStyle='#27d796'; ctx.beginPath();ctx.arc(x,y,2.5,0,7);ctx.fill(); }
  }
  draw();
  function pick(ev){
    const rect=cv.getBoundingClientRect();
    const cx=(ev.touches?ev.touches[0].clientX:ev.clientX)-rect.left;
    const cy=(ev.touches?ev.touches[0].clientY:ev.clientY)-rect.top;
    const [lat,lon]=toLatLon(cx,cy);
    pin=[lat,lon]; draw(); setPicked(lat,lon);
  }
  cv.onclick=pick;
  cv.ontouchstart=e=>{e.preventDefault();pick(e);};
}

// ================= ROUTE MAP & RANGE MAP =================
let routeMapObj=null, rangeMapObj=null;

// Route map: dots for each stop, connected in order. Online Leaflet, offline canvas plot.
function renderRouteMap(){
  const el=$('routeMap'); if(!el||!curRoute) return;
  const stops=curRoute.stopIdx.map(i=>AIRPORTS[i]).filter(Boolean);
  if(stops.length<2) return;
  if(typeof L!=='undefined'){
    try{
      if(routeMapObj){ routeMapObj.remove(); routeMapObj=null; }
      const map=L.map(el,{zoomControl:true,attributionControl:false});
      routeMapObj=map;
      const tiles=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18});
      // Only treat a SUSTAINED tile failure as genuinely offline. A freshly-shown
      // map requests several tiles that can transiently fail; a high threshold
      // avoids dropping a working online map to the offline plot by mistake.
      let tileErr=0, tileOk=false;
      tiles.on('tileload',()=>{ tileOk=true; });
      tiles.on('tileerror',()=>{ if(++tileErr>40 && !tileOk && routeMapObj){ try{routeMapObj.remove();}catch(e){} routeMapObj=null; drawRoutePlot(el,stops); } });
      tiles.addTo(map);
      const pts=stops.map(s=>[s.lat,s.lon]);
      L.polyline(pts,{color:'#ffb000',weight:3,opacity:.9}).addTo(map);
      stops.forEach((s,k)=>{
        const isEnd=(k===0||k===stops.length-1);
        L.circleMarker([s.lat,s.lon],{radius:isEnd?7:6,
          color:isEnd?'#ffb000':'#3fd0ff',weight:2,
          fillColor:isEnd?'#ffb000':'#3fd0ff',fillOpacity:.85})
          .bindTooltip((k+1)+'. '+(s.icao||s.name),{direction:'top'}).addTo(map);
      });
      map.fitBounds(pts,{padding:[35,35]});
      setTimeout(()=>map.invalidateSize(),150);
      return;
    }catch(e){ /* fall through to offline */ }
  }
  // Leaflet not loaded at all: plain canvas plot of the route
  drawRoutePlot(el, stops);
}
function drawRoutePlot(container, stops){
  container.innerHTML='<canvas id="routeMapCv" style="width:100%;height:100%"></canvas>';
  const cv=container.querySelector('#routeMapCv');
  const dpr=window.devicePixelRatio||1;
  const w=container.clientWidth||320, h=container.clientHeight||300;
  cv.width=w*dpr; cv.height=h*dpr; const ctx=cv.getContext('2d'); ctx.scale(dpr,dpr);
  // bounds from the stops (with margin)
  const lats=stops.map(s=>s.lat), lons=stops.map(s=>s.lon);
  let minLat=Math.min(...lats),maxLat=Math.max(...lats),minLon=Math.min(...lons),maxLon=Math.max(...lons);
  const padL=(maxLat-minLat)*0.25+0.5, padO=(maxLon-minLon)*0.25+0.5;
  minLat-=padL;maxLat+=padL;minLon-=padO;maxLon+=padO;
  const pad=22;
  function xy(lat,lon){return [pad+(lon-minLon)/(maxLon-minLon||1)*(w-2*pad), pad+(maxLat-lat)/(maxLat-minLat||1)*(h-2*pad)];}
  ctx.fillStyle='#0c1119';ctx.fillRect(0,0,w,h);
  // faint other airports for context
  AIRPORTS.forEach(a=>{ if(a.lat<minLat||a.lat>maxLat||a.lon<minLon||a.lon>maxLon)return;
    const [x,y]=xy(a.lat,a.lon); ctx.fillStyle='rgba(90,107,125,.4)'; ctx.beginPath();ctx.arc(x,y,1.5,0,7);ctx.fill(); });
  // route line
  ctx.strokeStyle='#ffb000';ctx.lineWidth=2.5;ctx.beginPath();
  stops.forEach((s,k)=>{const [x,y]=xy(s.lat,s.lon); if(k)ctx.lineTo(x,y);else ctx.moveTo(x,y);});
  ctx.stroke();
  // dots + labels
  stops.forEach((s,k)=>{const [x,y]=xy(s.lat,s.lon);const isEnd=(k===0||k===stops.length-1);
    ctx.fillStyle=isEnd?'#ffb000':'#3fd0ff';ctx.beginPath();ctx.arc(x,y,isEnd?6:5,0,7);ctx.fill();
    ctx.fillStyle='#0a0e14';ctx.font='bold 9px monospace';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(k+1,x,y);
    ctx.fillStyle='#c9d4e0';ctx.font='10px monospace';ctx.textAlign='left';ctx.textBaseline='bottom';
    ctx.fillText(s.icao||s.name.slice(0,12), x+9, y-4);
  });
  ctx.fillStyle='#3a4757';ctx.font='9px monospace';ctx.textAlign='right';ctx.textBaseline='bottom';
  ctx.fillText('offline plot — no map tiles',w-6,h-5);
}

// Range map: circle of usable range around departure. Online only; clean message offline.
function renderRangeMap(){
  const wrap=$('rangeMapWrap'); if(!wrap) return;
  const di=depPick.get();
  // use the standalone usable range so the circle shows as soon as departure +
  // aircraft + fuel are set, even before a destination is chosen.
  const rangeNM = window._usableRangeNM || 0;
  // only show once we have a departure AND a meaningful range (aircraft+fuel entered)
  if(di==null || !(rangeNM>0)){ wrap.style.display='none'; return; }
  wrap.style.display='block';
  $('rangeMapLabel').textContent='· '+n0(distOut(rangeNM))+' '+distUnit();
  const mapEl=$('rangeMap'), offEl=$('rangeMapOffline');
  if(typeof L==='undefined'){
    offEl.textContent='Range map needs an internet connection (map library unavailable).';
    mapEl.style.display='none'; offEl.style.display='flex'; return;
  }
  mapEl.style.display='block'; offEl.style.display='none';
  const dep=AIRPORTS[di];
  try{
    if(rangeMapObj){ try{rangeMapObj.remove();}catch(e){} rangeMapObj=null; }
    if(mapEl._leaflet_id){ mapEl._leaflet_id=null; mapEl.innerHTML=''; }
    // Create with an explicit center/zoom so the map is valid even before it has
    // pixel dimensions. We do NOT call fitBounds yet — fitBounds on a zero-size
    // container throws 'layerPointToLatLng' errors. We defer all size-dependent
    // work until after the container is laid out and invalidateSize has run.
    const map=L.map(mapEl,{zoomControl:true,attributionControl:false}).setView([dep.lat,dep.lon],7);
    rangeMapObj=map;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18}).addTo(map);
    const radiusM=rangeNM*1852; // NM -> metres
    const circle=L.circle([dep.lat,dep.lon],{radius:radiusM,color:'#27d796',weight:2,fillColor:'#27d796',fillOpacity:.08}).addTo(map);
    L.circleMarker([dep.lat,dep.lon],{radius:6,color:'#ffb000',weight:2,fillColor:'#ffb000',fillOpacity:.9})
      .bindTooltip(dep.icao||dep.name,{direction:'top'}).addTo(map);
    AIRPORTS.forEach(a=>{
      const d=distance(dep,a).nm;
      if(d>0 && d<=rangeNM){
        L.circleMarker([a.lat,a.lon],{radius:a.custom?4:3,
          color:a.custom?'#ffb000':'#3fd0ff',weight:1,fillColor:a.custom?'#ffb000':'#3fd0ff',fillOpacity:.6})
          .bindTooltip((a.custom?'📍 ':'')+(a.icao||a.name)+' · '+n0(distOut(d))+distUnit(),{direction:'top'}).addTo(map);
      }
    });
    // Defer the size-dependent fit until the now-visible container is laid out.
    function fitWhenReady(tries){
      if(!rangeMapObj) return;
      try{
        map.invalidateSize();
        if(mapEl.clientWidth>20 && mapEl.clientHeight>20){
          map.fitBounds(circle.getBounds(),{padding:[20,20]});
          return; // success
        }
      }catch(e){ /* not ready yet */ }
      if(tries>0) setTimeout(()=>fitWhenReady(tries-1), 120);
    }
    requestAnimationFrame(()=>fitWhenReady(8));
  }catch(e){ offEl.textContent='Range map could not load. [reason: '+(e&&e.message?e.message:e)+']'; mapEl.style.display='none'; offEl.style.display='flex'; }
}

// ================= NAVIGATION SHELL =================
const SCREENS={
  home:{title:'✈ VFR PLANNER · ZA', sub:'South Africa · straight-line flight planning', back:false},
  plan:{title:'Plan a flight', sub:'Route · fuel · weight & balance', back:true},
  mapmode:{title:'Map mode', sub:'Live map · route · weather', back:true},
  checklists:{title:'Checklists', sub:'Customizable preflight & ops', back:true},
  trips:{title:'Saved trips', sub:'Routes you fly again', back:true},
  aircraft:{title:'My aircraft', sub:'Saved aircraft profiles', back:true},
  strips:{title:'My strips', sub:'Custom locations', back:true},
};
let curScreen='home';
// map-mode state (declared early so go()/leaveMapMode() can run at init safely)
let mmMap=null, mmActive=false;
let mmState={glide:false, nearest:false, track:false, wx:false, follow:true};
let mmDirectTo=null; // AIRPORTS index of the direct-to target (declared early for init safety)
function go(screen){
  curScreen=screen;
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  const el=$('screen-'+screen); if(el) el.classList.add('active');
  const cfg=SCREENS[screen]||SCREENS.home;
  $('tbTitle').innerHTML=cfg.title; $('tbSub').textContent=cfg.sub;
  $('backBtn').style.display=cfg.back?'flex':'none';
  // refresh dynamic content
  if(screen==='home') refreshHomeCounts();
  if(screen==='trips') renderTrips();
  if(screen==='aircraft'){ if(typeof closeAcForm==='function') closeAcForm(); renderAcManage(); }
  if(screen==='strips') renderStripManage();
  if(screen==='plan') render(); // refresh briefing so any edits (e.g. strip details) show
  if(screen==='checklists') renderChecklists();
  if(screen==='mapmode') enterMapMode(); else leaveMapMode();
  window.scrollTo(0,0);
}
$('backBtn').onclick=()=>go('home');
document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.go)));

function refreshHomeCounts(){
  const t=loadTrips(), a=loadProfiles(), s=loadCustom();
  const nt=Object.keys(t).length, na=Object.keys(a).length, ns=s.length;
  $('tripCount').textContent = nt? (nt+' saved trip'+(nt>1?'s':'')) : 'No saved trips yet';
  $('acCount').textContent   = na? (na+' saved aircraft') : 'No saved aircraft';
  $('stripCount').textContent= ns? (ns+' custom strip'+(ns>1?'s':'')) : 'No custom strips';
  const cl=loadChecklists(); const nc=cl.length;
  if($('clCount')) $('clCount').textContent = nc? (nc+' checklist categor'+(nc>1?'ies':'y')) : 'Tap to set up';
}

// ================= TRIPS =================
const LS_TRIPS='vfrza_trips';
function loadTrips(){ try{return JSON.parse(localStorage.getItem(LS_TRIPS)||'{}');}catch(e){return {};} }
function saveTrips(t){ try{localStorage.setItem(LS_TRIPS,JSON.stringify(t));}catch(e){} }

// reference an airport so it survives index shifts: icao if present, else custom name+coords
function airportRef(a){
  if(!a) return null;
  if(a.icao) return {icao:a.icao};
  return {name:a.name, lat:a.lat, lon:a.lon};
}
function resolveRef(ref){
  if(!ref) return null;
  if(ref.icao){ const i=AIRPORTS.findIndex(a=>a.icao===ref.icao); return i>=0?i:null; }
  const i=AIRPORTS.findIndex(a=>a.name===ref.name && Math.abs(a.lat-ref.lat)<1e-4 && Math.abs(a.lon-ref.lon)<1e-4);
  return i>=0?i:null;
}

$('saveTripBtn').onclick=()=>{
  const di=depPick.get(), ai=arrPick.get();
  if(di==null||ai==null){ alert('Pick a departure and destination first.'); return; }
  const dep=AIRPORTS[di], arr=AIRPORTS[ai];
  const name=prompt('Name this trip (e.g. "Lowveld safari run"):'); if(!name) return;
  const trips=loadTrips();
  trips[name]={
    dep:airportRef(dep), arr:airportRef(arr),
    depName:dep.name, depCode:dep.icao||dep.iata||'—',
    arrName:arr.name, arrCode:arr.icao||arr.iata||'—',
    aircraft:readBase(), pax:pax.slice(), fuelType:fuelType,
    savedAcName: $('acProfile').value || '', when:Date.now()
  };
  saveTrips(trips);
  alert('Trip "'+name+'" saved.');
};

function renderTrips(){
  const trips=loadTrips(); const names=Object.keys(trips);
  const box=$('tripsList');
  if(!names.length){ box.innerHTML='<div class="mempty">NO SAVED TRIPS YET<br>Plan a flight, then tap “Save as trip”.</div>'; return; }
  box.innerHTML=names.map(n=>{
    const t=trips[n];
    const di=resolveRef(t.dep), ai=resolveRef(t.arr);
    let distTxt='';
    if(di!=null&&ai!=null){ const d=distance(AIRPORTS[di],AIRPORTS[ai]); distTxt=', '+n0(distOut(d.nm))+' '+distUnit(); }
    const savedWith=t.savedAcName?('Saved with '+esc(t.savedAcName)):'Saved with custom aircraft';
    const missing=(di==null||ai==null);
    return '<div class="mcard"><div class="mtitle">'+esc(n)+'</div>'+
      '<div class="msub">'+esc(t.depCode)+' '+esc(t.depName)+' → '+esc(t.arrCode)+' '+esc(t.arrName)+distTxt+'.<br>'+savedWith+'.'+
      (missing?' <span style="color:var(--red)">⚠ An airfield in this trip is no longer available.</span>':'')+'</div>'+
      '<div class="mrow">'+
        (missing?'':'<button class="mbtn go" data-trip-load="'+esc(n)+'" data-mode="saved">Load with '+(t.savedAcName?esc(t.savedAcName):'saved load-out')+'</button>')+
      '</div>'+
      (missing?'':'<div class="mrow">'+
        '<button class="mbtn" data-trip-load="'+esc(n)+'" data-mode="pick">Load with saved aircraft</button>'+
        '<button class="mbtn" data-trip-load="'+esc(n)+'" data-mode="new">Load with new aircraft</button>'+
      '</div>')+
      '<div class="mrow"><button class="mbtn del" data-trip-del="'+esc(n)+'">Delete</button></div>'+
    '</div>';
  }).join('');
  box.querySelectorAll('[data-trip-load]').forEach(b=>b.addEventListener('click',()=>loadTrip(b.dataset.tripLoad,b.dataset.mode)));
  box.querySelectorAll('[data-trip-del]').forEach(b=>b.addEventListener('click',()=>{
    const n=b.dataset.tripDel; if(!confirm('Delete trip "'+n+'"?')) return;
    const t=loadTrips(); delete t[n]; saveTrips(t); renderTrips(); refreshHomeCounts();
  }));
}

function loadTrip(name, mode){
  const t=loadTrips()[name]; if(!t) return;
  const di=resolveRef(t.dep), ai=resolveRef(t.arr);
  if(di==null||ai==null){ alert('An airfield in this trip is no longer available.'); return; }
  // set route
  depPick.setIndex(di); arrPick.setIndex(ai);
  // aircraft handling per mode
  if(mode==='saved'){
    writeBase(t.aircraft);
    if(t.pax){ pax=t.pax.slice(); renderPax(); }
    if(t.fuelType){ fuelType=t.fuelType; $('fueltype').value=fuelType; }
    if(t.savedAcName && loadProfiles()[t.savedAcName]){ $('acProfile').value=t.savedAcName; }
  } else if(mode==='pick'){
    const names=Object.keys(loadProfiles());
    if(!names.length){ alert('No saved aircraft yet — loading the trip’s route with its saved load-out instead.'); writeBase(t.aircraft); if(t.pax){pax=t.pax.slice();renderPax();} }
    else {
      const choice=prompt('Load which aircraft?\n\n'+names.map((x,i)=>(i+1)+'. '+x).join('\n')+'\n\nType the number:');
      const idx=parseInt(choice,10)-1;
      if(idx>=0 && idx<names.length){
        const o=loadProfiles()[names[idx]];
        writeBase(o); if(o.pax){pax=o.pax.slice();renderPax();} if(o.fuelType){fuelType=o.fuelType;$('fueltype').value=fuelType;}
        $('acProfile').value=names[idx];
      } else { return; }
    }
  } else { // new — route only, leave aircraft as-is for user to fill
    $('acProfile').value='';
  }
  go('plan'); render();
}

// ================= MANAGE AIRCRAFT =================
function renderAcManage(){
  const p=loadProfiles(); const names=Object.keys(p); const box=$('acManageList');
  if(!names.length){ box.innerHTML='<div class="mempty">NO SAVED AIRCRAFT<br>Use “Save aircraft” in the planner.</div>'; return; }
  box.innerHTML=names.map(n=>{
    const a=p[n];
    return '<div class="mcard"><div class="mtitle">'+esc(n)+'</div>'+
      '<div class="msub">Cruise '+n0(a.tas)+' kt · burn '+n0(a.burn)+' L/hr · tank '+n0(a.fuel)+' L<br>'+
      'Empty '+n0(a.empty)+' kg · MTOW '+n0(a.mtow)+' kg</div>'+
      '<div class="mrow"><button class="mbtn go" data-ac-load="'+esc(n)+'">Load into planner</button>'+
      '<button class="mbtn" data-ac-edit="'+esc(n)+'">Edit</button>'+
      '<button class="mbtn del" data-ac-del="'+esc(n)+'">Delete</button></div></div>';
  }).join('');
  box.querySelectorAll('[data-ac-load]').forEach(b=>b.addEventListener('click',()=>{
    const o=loadProfiles()[b.dataset.acLoad]; writeBase(o);
    if(o.pax){pax=o.pax.slice();renderPax();} if(o.fuelType){fuelType=o.fuelType;$('fueltype').value=fuelType;}
    $('acProfile').value=b.dataset.acLoad; go('plan'); render();
  }));
  box.querySelectorAll('[data-ac-edit]').forEach(b=>b.addEventListener('click',()=>{
    openAcForm(b.dataset.acEdit);
  }));
  box.querySelectorAll('[data-ac-del]').forEach(b=>b.addEventListener('click',()=>{
    const n=b.dataset.acDel; if(!confirm('Delete aircraft "'+n+'"?')) return;
    const p=loadProfiles(); delete p[n]; saveProfiles(p); refreshProfiles(); renderAcManage(); refreshHomeCounts();
  }));
}

// ================= MANAGE STRIPS =================
function stripSummary(c){
  const r=(c.rwy&&c.rwy.length)?c.rwy.length+' runway'+(c.rwy.length>1?'s':''):'no runways';
  const f=(c.freq&&c.freq.length)?c.freq.length+' freq'+(c.freq.length>1?'s':''):'no freqs';
  const e=(c.elev!=null)?(', elev '+n0(c.elev)+' ft'):'';
  return r+' · '+f+e;
}
function renderStripManage(){
  const s=loadCustom(); const box=$('stripManageList');
  if(!s.length){ box.innerHTML='<div class="mempty">NO CUSTOM STRIPS<br>Add one above, or from the map picker.</div>'; return; }
  box.innerHTML=s.map((c,i)=>{
    return '<div class="mcard" data-strip-card="'+i+'"><div class="mtitle">📍 '+esc(c.name)+'</div>'+
      '<div class="msub">'+c.lat.toFixed(5)+', '+c.lon.toFixed(5)+'<br>'+esc(stripSummary(c))+'</div>'+
      '<div class="mrow"><button class="mbtn" data-strip-edit="'+i+'">Edit details</button>'+
      '<button class="mbtn" data-strip-ren="'+i+'">Rename</button>'+
      '<button class="mbtn del" data-strip-del="'+i+'">Delete</button></div>'+
      '<div class="strip-editor" data-editor="'+i+'" style="display:none"></div></div>';
  }).join('');
  box.querySelectorAll('[data-strip-ren]').forEach(b=>b.addEventListener('click',()=>{
    const i=+b.dataset.stripRen; const arr=loadCustom(); const nn=prompt('Rename strip:',arr[i].name);
    if(!nn) return; arr[i].name=nn.trim(); saveCustom(arr); mergeCustom(); renderStripManage();
  }));
  box.querySelectorAll('[data-strip-del]').forEach(b=>b.addEventListener('click',()=>{
    const i=+b.dataset.stripDel; const arr=loadCustom();
    if(!confirm('Delete strip "'+arr[i].name+'"?')) return;
    arr.splice(i,1); saveCustom(arr); mergeCustom(); renderStripManage(); refreshHomeCounts();
  }));
  box.querySelectorAll('[data-strip-edit]').forEach(b=>b.addEventListener('click',()=>{
    const i=+b.dataset.stripEdit; const ed=box.querySelector('[data-editor="'+i+'"]');
    if(ed.style.display==='none'){ ed.style.display='block'; renderStripEditor(i, ed); }
    else { ed.style.display='none'; }
  }));
}

// in-memory working copy while editing a strip
function renderStripEditor(i, ed){
  const arr=loadCustom(); const c=arr[i];
  c.rwy=c.rwy||[]; c.freq=c.freq||[];
  const elevVal = c.elev!=null? c.elev : '';
  ed.innerHTML=
    '<div class="se-sec">Field elevation (ft)</div>'+
    '<input class="se-input" data-elev type="number" inputmode="numeric" placeholder="e.g. 4500" value="'+elevVal+'">'+
    '<div class="se-sec">Runways</div><div class="se-rwy-list"></div>'+
    '<button class="se-add" data-add-rwy>＋ Add runway</button>'+
    '<div class="se-sec">Frequencies</div><div class="se-freq-list"></div>'+
    '<button class="se-add" data-add-freq>＋ Add frequency</button>'+
    '<div class="se-save-row"><button class="se-save" data-save>✓ Save details</button></div>';

  const rwyList=ed.querySelector('.se-rwy-list');
  const freqList=ed.querySelector('.se-freq-list');
  function drawRwy(){
    rwyList.innerHTML=c.rwy.map((r,k)=>
      '<div class="se-row" data-rwy-row="'+k+'">'+
        '<input class="se-sm" data-f="id" placeholder="09/27" value="'+esc(r.id||'')+'">'+
        '<input class="se-sm" data-f="len" type="number" inputmode="numeric" placeholder="len ft" value="'+(r.len!=null?r.len:'')+'">'+
        '<select class="se-sm" data-f="surf">'+
          ['','Paved','Gravel','Grass','Dirt','Sand'].map(o=>'<option'+(o===(r.surf||'')?' selected':'')+'>'+o+'</option>').join('')+
        '</select>'+
        '<label class="se-lit"><input type="checkbox" data-f="lit"'+(r.lit?' checked':'')+'> lit</label>'+
        '<button class="se-del" data-del-rwy="'+k+'">✕</button>'+
      '</div>').join('') || '<div class="se-empty">No runways added.</div>';
    rwyList.querySelectorAll('[data-del-rwy]').forEach(btn=>btn.addEventListener('click',()=>{
      c.rwy.splice(+btn.dataset.delRwy,1); drawRwy();
    }));
  }
  function drawFreq(){
    const svcs=['CTAF','AFIS','Tower','Approach','Ground','Apron','ATIS','Radio','Unicom','Other'];
    freqList.innerHTML=c.freq.map((f,k)=>
      '<div class="se-row" data-freq-row="'+k+'">'+
        '<select class="se-sm" data-f="svc">'+
          svcs.map(o=>'<option'+(o===(f.svc||'CTAF')?' selected':'')+'>'+o+'</option>').join('')+
        '</select>'+
        '<input class="se-sm" data-f="mhz" placeholder="122.8" value="'+esc(f.mhz||'')+'">'+
        '<button class="se-del" data-del-freq="'+k+'">✕</button>'+
      '</div>').join('') || '<div class="se-empty">No frequencies added.</div>';
    freqList.querySelectorAll('[data-del-freq]').forEach(btn=>btn.addEventListener('click',()=>{
      c.freq.splice(+btn.dataset.delFreq,1); drawFreq();
    }));
  }
  drawRwy(); drawFreq();

  ed.querySelector('[data-add-rwy]').addEventListener('click',()=>{ c.rwy.push({id:'',len:null,surf:'',lit:false}); drawRwy(); });
  ed.querySelector('[data-add-freq]').addEventListener('click',()=>{ c.freq.push({svc:'CTAF',mhz:''}); drawFreq(); });

  ed.querySelector('[data-save]').addEventListener('click',()=>{
    // read elevation
    const ev=ed.querySelector('[data-elev]').value.trim();
    c.elev = ev===''? null : Math.round(parseFloat(ev));
    // read runway rows
    c.rwy = [...rwyList.querySelectorAll('[data-rwy-row]')].map(row=>({
      id: row.querySelector('[data-f="id"]').value.trim(),
      len: row.querySelector('[data-f="len"]').value.trim()===''? null : Math.round(parseFloat(row.querySelector('[data-f="len"]').value)),
      surf: row.querySelector('[data-f="surf"]').value,
      lit: row.querySelector('[data-f="lit"]').checked
    })).filter(r=>r.id||r.len);
    // read freq rows
    c.freq = [...freqList.querySelectorAll('[data-freq-row]')].map(row=>({
      svc: row.querySelector('[data-f="svc"]').value,
      mhz: row.querySelector('[data-f="mhz"]').value.trim()
    })).filter(f=>f.mhz);
    arr[i]=c; saveCustom(arr); mergeCustom();
    renderStripManage();
  });
}
$('addStripHome').onclick=()=>{ const idx=addCustomLocation(); if(idx>=0){ renderStripManage(); refreshHomeCounts(); } };
$('addStripMap').onclick=()=>{
  openMapPicker(()=>{ renderStripManage(); refreshHomeCounts(); });
};

// start on home
if(typeof wireMapModeButtons==='function') wireMapModeButtons();
go('home');

// ================= BACKUP & RESTORE (export / import) =================
function gatherBackup(){
  return {
    app:'vfr-planner-za', version:1, exported:new Date().toISOString(),
    trips: loadTrips(),
    aircraft: loadProfiles(),
    strips: loadCustom()
  };
}
function applyBackup(data, mode){
  // mode: 'merge' (default) or 'replace'
  if(!data || data.app!=='vfr-planner-za'){ throw new Error('Not a VFR Planner backup file.'); }
  const trips = data.trips||{}, ac = data.aircraft||{}, strips = data.strips||[];
  if(mode==='replace'){
    saveTrips(trips); saveProfiles(ac); saveCustom(strips);
  } else {
    const t=loadTrips(); Object.keys(trips).forEach(k=>t[k]=trips[k]); saveTrips(t);
    const a=loadProfiles(); Object.keys(ac).forEach(k=>a[k]=ac[k]); saveProfiles(a);
    const s=loadCustom();
    strips.forEach(ns=>{ if(!s.some(x=>x.name===ns.name && Math.abs(x.lat-ns.lat)<1e-4 && Math.abs(x.lon-ns.lon)<1e-4)) s.push(ns); });
    saveCustom(s);
  }
  mergeCustom(); refreshProfiles(); refreshHomeCounts();
}
function backupStats(d){
  return (Object.keys(d.trips||{}).length)+' trips, '+
         (Object.keys(d.aircraft||{}).length)+' aircraft, '+
         ((d.strips||[]).length)+' strips';
}

// --- Export to file (download) ---
$('exportFile').onclick=()=>{
  const data=gatherBackup();
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  const stamp=new Date().toISOString().slice(0,10);
  a.href=url; a.download='vfr-planner-backup-'+stamp+'.json';
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ document.body.removeChild(a); URL.revokeObjectURL(url); },100);
};

// --- Import from file ---
$('importFile').onclick=()=>$('fileInput').click();
$('fileInput').onchange=(e)=>{
  const file=e.target.files&&e.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const data=JSON.parse(reader.result);
      doImport(data);
    }catch(err){ alert('Could not read that file: '+(err.message||'invalid format')); }
    $('fileInput').value='';
  };
  reader.readAsText(file);
};

// --- Export as copy-paste code ---
$('exportCode').onclick=async()=>{
  const code=JSON.stringify(gatherBackup());
  try{
    await navigator.clipboard.writeText(code);
    alert('Backup code copied to clipboard ('+backupStats(gatherBackup())+').\nPaste it somewhere safe, or into "Paste code" on another device.');
  }catch(e){
    // fallback: show in a prompt for manual copy
    prompt('Copy this backup code:', code);
  }
};

// --- Import from pasted code ---
$('importCode').onclick=()=>{
  const code=prompt('Paste your backup code here:');
  if(!code) return;
  try{ doImport(JSON.parse(code.trim())); }
  catch(err){ alert('That code could not be read: '+(err.message||'invalid format')); }
};

function doImport(data){
  if(!data || data.app!=='vfr-planner-za'){ alert('That doesn’t look like a VFR Planner backup.'); return; }
  const stats=backupStats(data);
  const choice=confirm('Import '+stats+'.\n\nOK = MERGE with what’s already here.\nCancel = stop (nothing changed).');
  if(!choice) return;
  try{ applyBackup(data,'merge'); alert('Imported: '+stats+'.'); }
  catch(err){ alert('Import failed: '+(err.message||err)); }
}

// ================= ADD / EDIT AIRCRAFT FROM "MY AIRCRAFT" =================
let acFormEditing=null; // name being edited, or null for new
const AF=['name','tas','burn','fuel','reserve','empty','mtow'];

function openAcForm(editName){
  acFormEditing=editName||null;
  $('acFormTitle').textContent = editName? ('Edit '+editName) : 'New aircraft';
  // populate
  if(editName){
    const o=loadProfiles()[editName]||{};
    $('af_name').value=editName;
    $('af_tas').value   = o.tas!=null? +(U.dist==='km'?o.tas*KM_PER_NM:o.tas).toFixed(1):'';
    $('af_burn').value  = o.burn!=null? +volOut(o.burn).toFixed(1):'';
    $('af_fuel').value  = o.fuel!=null? +volOut(o.fuel).toFixed(1):'';
    $('af_reserve').value = o.reserve!=null? o.reserve:'';
    $('af_empty').value = o.empty!=null? +wtOut(o.empty).toFixed(1):'';
    $('af_mtow').value  = o.mtow!=null? +wtOut(o.mtow).toFixed(1):'';
    $('af_glide').value = o.glideRatio!=null? o.glideRatio:'';
  } else {
    $('af_name').value='';
    ['af_tas','af_burn','af_fuel','af_reserve','af_empty','af_mtow','af_glide'].forEach(id=>$(id).value='');
  }
  $('acForm').style.display='block';
  $('addAcBtn').style.display='none';
  // sync the form's unit toggle buttons to the current global units
  ['dist','wt','vol'].forEach(dim=>{
    document.querySelectorAll('#acForm .opts[data-unit="'+dim+'"] button').forEach(b=>{
      b.classList.toggle('on', b.dataset.v===U[dim]);
    });
  });
  $('acForm').scrollIntoView({behavior:'smooth',block:'start'});
}
function closeAcForm(){
  $('acForm').style.display='none';
  $('addAcBtn').style.display='';
}
$('addAcBtn').onclick=()=>openAcForm(null);
$('af_cancel').onclick=closeAcForm;
$('af_save').onclick=()=>{
  const name=$('af_name').value.trim();
  if(!name){ alert('Give the aircraft a name or registration.'); return; }
  // read fields, convert to base units
  const tasRaw=parseFloat($('af_tas').value)||0;
  const o={
    tas: U.dist==='km'? tasRaw*NM_PER_KM : tasRaw,
    burn: volIn(parseFloat($('af_burn').value)||0),
    fuel: volIn(parseFloat($('af_fuel').value)||0),
    reserve: parseFloat($('af_reserve').value)||0,
    empty: wtIn(parseFloat($('af_empty').value)||0),
    mtow: wtIn(parseFloat($('af_mtow').value)||0),
    glideRatio: parseFloat($('af_glide').value)||null,
    cargo: 0, fuelload: 0,
    pax:[77,77], fuelType:fuelType
  };
  const p=loadProfiles();
  // if renaming an edited entry, remove the old key
  if(acFormEditing && acFormEditing!==name){ delete p[acFormEditing]; }
  p[name]=o; saveProfiles(p); refreshProfiles();
  closeAcForm(); renderAcManage(); refreshHomeCounts();
  alert('Aircraft "'+name+'" saved.');
};

// ================= GPS MANAGER =================
// Single source of truth for device location. Everything (glide ring, nearest,
// breadcrumb, map-mode own-ship) reads from here. All of it is opt-in and
// fully toggleable to save battery — nothing runs until the user enables GPS.
const GPS={
  on:false, watchId:null, pos:null, // {lat,lon,alt,acc,heading,speed,ts}
  features:{glide:false, nearest:false, breadcrumb:false},
  breadcrumbs:[],         // [{lat,lon,ts}]
  listeners:[],
  load(){
    try{ const s=JSON.parse(localStorage.getItem('vfrza_gps')||'{}');
      this.features=Object.assign(this.features, s.features||{});
    }catch(e){}
  },
  save(){ try{ localStorage.setItem('vfrza_gps', JSON.stringify({features:this.features})); }catch(e){} },
  onChange(fn){ this.listeners.push(fn); },
  emit(){ this.listeners.forEach(fn=>{ try{fn(this.pos);}catch(e){} }); },
  start(){
    if(this.on) return;
    if(!('geolocation' in navigator)){ alert('This device/browser has no GPS access.'); return; }
    this.on=true;
    this.watchId=navigator.geolocation.watchPosition(
      p=>{
        this.pos={lat:p.coords.latitude, lon:p.coords.longitude,
          alt:p.coords.altitude, acc:p.coords.accuracy,
          heading:p.coords.heading, speed:p.coords.speed, ts:p.timestamp};
        if(this.features.breadcrumb) this.pushBreadcrumb();
        this.emit();
      },
      err=>{ this.on=false; this.watchId=null;
        alert('GPS unavailable: '+(err&&err.message?err.message:'permission denied')+'\n\nMake sure location permission is granted for this site.');
        this.emit();
      },
      {enableHighAccuracy:true, maximumAge:2000, timeout:15000}
    );
    this.emit();
  },
  stop(){
    if(this.watchId!=null){ navigator.geolocation.clearWatch(this.watchId); }
    this.watchId=null; this.on=false; this.pos=null; this.emit();
  },
  toggle(v){ v? this.start() : this.stop(); },
  pushBreadcrumb(){
    const p=this.pos; if(!p) return;
    const last=this.breadcrumbs[this.breadcrumbs.length-1];
    // only record if moved ~>30m from last point (keeps the trail light)
    if(!last || distance({lat:last.lat,lon:last.lon},{lat:p.lat,lon:p.lon}).nm>0.016){
      this.breadcrumbs.push({lat:p.lat,lon:p.lon,ts:p.ts});
      if(this.breadcrumbs.length>5000) this.breadcrumbs.shift();
    }
  },
  clearBreadcrumbs(){ this.breadcrumbs=[]; }
};
GPS.load();

// ================= CHECKLISTS =================
const LS_CL='vfrza_checklists';
let clChecked={}; // {catIdx: Set of itemIdx} — runtime tick state, not persisted
function defaultChecklists(){
  return [
    {name:'Preflight', items:['Documents & licences aboard','Walk-around inspection complete','Fuel quantity & quality checked','Oil level checked','Controls free & correct','Weather & NOTAMs checked','Weight & balance within limits']},
    {name:'Engine Start', items:['Brakes set','Mixture rich','Master ON','Area clear / "CLEAR PROP"','Throttle cracked','Ignition START','Oil pressure rising']},
    {name:'Before Taxi', items:['Avionics ON','Flight instruments set','Altimeter set (QNH)','Radios & frequencies set','Transponder set']},
    {name:'Run-up', items:['Brakes held','Throttle 1700 RPM','Magnetos checked','Carb heat checked','Engine instruments green','Idle checked']},
    {name:'Before Takeoff', items:['Trim set for takeoff','Flaps set','Controls free','Instruments set','Fuel on fullest tank','Hatches & harnesses secure','Departure briefing done']},
    {name:'Cruise', items:['Power set','Mixture leaned','Engine instruments green','Heading & altitude held','Fuel log / time check']},
    {name:'Before Landing', items:['Fuel on fullest tank','Mixture rich','Carb heat as required','Brakes checked','Landing clearance / radio call','Flaps as required']},
    {name:'Shutdown', items:['Parking brake set','Avionics OFF','Mixture idle cut-off','Magnetos OFF','Master OFF','Controls locked']}
  ];
}
function loadChecklists(){
  try{ const s=localStorage.getItem(LS_CL); if(s) return JSON.parse(s); }catch(e){}
  return defaultChecklists();
}
function saveChecklists(c){ try{ localStorage.setItem(LS_CL, JSON.stringify(c)); }catch(e){} }

function renderChecklists(){
  const cl=loadChecklists(); const box=$('clView');
  box.innerHTML=
    '<div class="cl-toolbar">'+
      '<button class="cl-reset" id="clResetTicks">↺ Reset all ticks</button>'+
      '<button id="clAddCat">＋ Add category</button>'+
      '<button id="clRestore">Restore defaults</button>'+
    '</div>'+
    cl.map((cat,ci)=>{
      const checked=clChecked[ci]||new Set();
      const done=cat.items.filter((_,ii)=>checked.has(ii)).length;
      return '<div class="cl-cat'+(cat._open?' open':'')+'" data-cat="'+ci+'">'+
        '<div class="cl-cat-h" data-cat-toggle="'+ci+'">'+
          '<span class="cl-name">'+esc(cat.name)+'</span>'+
          '<span class="cl-prog">'+done+'/'+cat.items.length+'</span>'+
          '<span class="cl-chev">▶</span>'+
        '</div>'+
        '<div class="cl-items">'+
          cat.items.map((it,ii)=>
            '<div class="cl-item'+(checked.has(ii)?' done':'')+'" data-ci="'+ci+'" data-ii="'+ii+'">'+
              '<div class="cl-check" data-check="'+ci+','+ii+'">✓</div>'+
              '<div class="cl-text" data-check="'+ci+','+ii+'">'+esc(it)+'</div>'+
              '<button class="cl-del" data-del-item="'+ci+','+ii+'">×</button>'+
            '</div>'
          ).join('')+
          '<div class="cl-edit-row"><input placeholder="Add an item…" data-add-item-input="'+ci+'">'+
            '<button class="cl-mini" data-add-item="'+ci+'">Add</button></div>'+
          '<div class="cl-edit-row"><button class="cl-mini" data-ren-cat="'+ci+'">Rename category</button>'+
            '<button class="cl-mini" style="color:var(--red)" data-del-cat="'+ci+'">Delete category</button></div>'+
        '</div></div>';
    }).join('');

  // category expand/collapse
  box.querySelectorAll('[data-cat-toggle]').forEach(h=>h.addEventListener('click',e=>{
    if(e.target.closest('[data-check],[data-del-item],.cl-edit-row,.cl-mini')) return;
    const ci=+h.dataset.catToggle; const cl=loadChecklists(); cl[ci]._open=!cl[ci]._open; saveChecklists(cl); renderChecklists();
  }));
  // tick items
  box.querySelectorAll('[data-check]').forEach(el=>el.addEventListener('click',()=>{
    const [ci,ii]=el.dataset.check.split(',').map(Number);
    if(!clChecked[ci]) clChecked[ci]=new Set();
    if(clChecked[ci].has(ii)) clChecked[ci].delete(ii); else clChecked[ci].add(ii);
    renderChecklists();
  }));
  // delete item
  box.querySelectorAll('[data-del-item]').forEach(b=>b.addEventListener('click',()=>{
    const [ci,ii]=b.dataset.delItem.split(',').map(Number);
    const cl=loadChecklists(); cl[ci].items.splice(ii,1); cl[ci]._open=true; saveChecklists(cl);
    clChecked[ci]=new Set(); renderChecklists();
  }));
  // add item
  box.querySelectorAll('[data-add-item]').forEach(b=>b.addEventListener('click',()=>{
    const ci=+b.dataset.addItem; const inp=box.querySelector('[data-add-item-input="'+ci+'"]');
    const v=inp.value.trim(); if(!v) return;
    const cl=loadChecklists(); cl[ci].items.push(v); cl[ci]._open=true; saveChecklists(cl); renderChecklists();
  }));
  box.querySelectorAll('[data-add-item-input]').forEach(inp=>inp.addEventListener('keydown',e=>{
    if(e.key==='Enter'){ const ci=+inp.dataset.addItemInput; const v=inp.value.trim(); if(!v)return;
      const cl=loadChecklists(); cl[ci].items.push(v); cl[ci]._open=true; saveChecklists(cl); renderChecklists(); }
  }));
  // rename / delete category
  box.querySelectorAll('[data-ren-cat]').forEach(b=>b.addEventListener('click',()=>{
    const ci=+b.dataset.renCat; const cl=loadChecklists(); const nn=prompt('Rename category:',cl[ci].name);
    if(!nn) return; cl[ci].name=nn.trim(); saveChecklists(cl); renderChecklists();
  }));
  box.querySelectorAll('[data-del-cat]').forEach(b=>b.addEventListener('click',()=>{
    const ci=+b.dataset.delCat; const cl=loadChecklists();
    if(!confirm('Delete category "'+cl[ci].name+'"?')) return;
    cl.splice(ci,1); saveChecklists(cl); clChecked={}; renderChecklists(); refreshHomeCounts();
  }));
  // toolbar
  $('clResetTicks').onclick=()=>{ clChecked={}; renderChecklists(); };
  $('clAddCat').onclick=()=>{ const nn=prompt('New category name:'); if(!nn)return;
    const cl=loadChecklists(); cl.push({name:nn.trim(),items:[],_open:true}); saveChecklists(cl); renderChecklists(); refreshHomeCounts(); };
  $('clRestore').onclick=()=>{ if(!confirm('Restore the default checklists? This replaces your current ones.'))return;
    saveChecklists(defaultChecklists()); clChecked={}; renderChecklists(); refreshHomeCounts(); };
}

// ================= WEATHER (METAR / TAF) =================
// Free data from aviationweather.gov. Advisory only — not an official brief.
// Coverage is good for major fields, thin for bush strips. Needs internet.
const wxCache={}; // icao -> {metar, taf, ts}
const CAT_LABEL={VFR:'VFR',MVFR:'Marginal VFR',IFR:'IFR',LIFR:'Low IFR'};

let wxStrategy=null; // remembers which fetch method worked, for diagnostics
async function fetchWx(icao){
  if(!icao) return null;
  const now=Date.now();
  if(wxCache[icao] && now-wxCache[icao].ts < 5*60*1000) return wxCache[icao]; // 5-min cache
  const id=encodeURIComponent(icao);
  const apiM='https://aviationweather.gov/api/data/metar?ids='+id+'&format=json';
  const apiT='https://aviationweather.gov/api/data/taf?ids='+id+'&format=json';

  // try one METAR+TAF url pair; returns parsed result or throws
  const tryPair=async (mUrl,tUrl)=>{
    const [mr,tr]=await Promise.all([fetch(mUrl),fetch(tUrl)]);
    if(!mr.ok && !tr.ok) throw new Error('HTTP '+mr.status);
    let metarArr=[], tafArr=[];
    try{ metarArr=mr.ok?await mr.json():[]; }catch(e){ metarArr=[]; }
    try{ tafArr=tr.ok?await tr.json():[]; }catch(e){ tafArr=[]; }
    // some proxies wrap responses; if it's a string, try to parse JSON out of it
    if(typeof metarArr==='string'){ try{metarArr=JSON.parse(metarArr);}catch(e){} }
    if(typeof tafArr==='string'){ try{tafArr=JSON.parse(tafArr);}catch(e){} }
    const metar=(Array.isArray(metarArr)&&metarArr[0])||null;
    const taf=(Array.isArray(tafArr)&&tafArr[0])||null;
    if(!metar && !taf) throw new Error('empty');   // treat empty as failure -> try next strategy
    return {metar, taf, ts:now};
  };

  // strategy list, in order of preference
  const strategies=[
    ['netlify-fn',    ()=>tryPair('/.netlify/functions/wx?type=metar&ids='+id,
                                  '/.netlify/functions/wx?type=taf&ids='+id)],
    ['allorigins',    ()=>tryPair('https://api.allorigins.win/raw?url='+encodeURIComponent(apiM),
                                  'https://api.allorigins.win/raw?url='+encodeURIComponent(apiT))],
    ['direct',        ()=>tryPair(apiM, apiT)],
  ];
  let lastErr='';
  for(const [name,fn] of strategies){
    try{ const out=await fn(); out.via=name; wxStrategy=name; wxCache[icao]=out; return out; }
    catch(e){ lastErr=name+': '+((e&&e.message)||'fail'); }
  }
  return {error:lastErr||'all strategies failed', ts:now};
}
function catClass(c){ return (c||'').toLowerCase(); }
// build a short plain-English decode of a METAR object
function decodeMetar(m){
  if(!m) return '';
  const bits=[];
  if(m.wdir!=null && m.wspd!=null){
    const dir = (m.wdir===0||m.wdir==='VRB')?'variable':(m.wdir+'°');
    bits.push('Wind '+dir+' at '+m.wspd+' kt'+(m.wgst?' gusting '+m.wgst:''));
  }
  if(m.visib!=null) bits.push('Visibility '+m.visib+(typeof m.visib==='number'?' SM':''));
  if(m.temp!=null) bits.push('Temp '+Math.round(m.temp)+'°C'+(m.dewp!=null?' / dew '+Math.round(m.dewp)+'°C':''));
  if(m.altim!=null) bits.push('QNH '+Math.round(m.altim)+(m.altim>2000?' hPa':''));
  if(m.fltCat) bits.push('Category: '+(CAT_LABEL[m.fltCat]||m.fltCat));
  return bits.join(' · ');
}
// returns an HTML weather block for an airport (async-rendered into a placeholder)
function wxBlockPlaceholder(icao){
  if(!icao) return '';
  return '<div class="wx-block" data-wx="'+esc(icao)+'"><div class="wx-line">☁ Loading weather…</div></div>';
}
async function hydrateWxBlocks(root){
  const blocks=(root||document).querySelectorAll('[data-wx]');
  for(const el of blocks){
    const icao=el.dataset.wx;
    const wx=await fetchWx(icao);
    if(!wx || wx.error){ el.innerHTML='<div class="wx-line" style="color:var(--faint)">☁ Weather unavailable'+(wx&&wx.error?' ('+esc(wx.error)+')':' — check connection')+'</div>'; continue; }
    if(!wx.metar && !wx.taf){ el.innerHTML='<div class="wx-line" style="color:var(--faint)">☁ No weather reported for '+esc(icao)+'</div>'; continue; }
    let html='';
    if(wx.metar){
      const c=wx.metar.fltCat||'';
      html+='<div class="wx-line"><span class="wx-cat '+catClass(c)+'"></span><b>METAR</b>'+(c?' · '+(CAT_LABEL[c]||c):'')+'</div>';
      html+='<div class="wx-decoded">'+esc(decodeMetar(wx.metar))+'</div>';
      if(wx.metar.rawOb) html+='<div class="wx-raw">'+esc(wx.metar.rawOb)+'</div>';
    }
    if(wx.taf){
      html+='<div class="wx-line" style="margin-top:8px"><b>TAF</b></div>';
      if(wx.taf.rawTAF) html+='<div class="wx-raw">'+esc(wx.taf.rawTAF)+'</div>';
    }
    html+='<div class="wx-line" style="color:var(--faint);font-size:10px">Advisory only — verify with an official brief.'+(wx.via?' ['+wx.via+']':'')+'</div>';
    el.innerHTML=html;
  }
}

// ================= MAP MODE (live EFB-style map) =================
let mmLayers={};

function enterMapMode(){
  mmActive=true;
  // sync feature toggles from saved GPS prefs
  mmState.glide=GPS.features.glide; mmState.nearest=GPS.features.nearest; mmState.track=GPS.features.breadcrumb;
  buildLiveMap();
  updateMmButtons();
  // hook GPS updates to the map
  GPS.onChange(onGpsForMap);
  // if GPS already running, reflect it
  if(GPS.on && GPS.pos) onGpsForMap(GPS.pos);
}
function leaveMapMode(){
  if(!mmActive) return;
  mmActive=false;
  // we keep GPS running if the user turned it on (they may want breadcrumb while planning),
  // but tear down the Leaflet instance so it doesn't leak/overlay other screens.
  if(mmMap){ try{mmMap.remove();}catch(e){} mmMap=null; mmLayers={};
    const el=$('liveMap'); if(el){ el._leaflet_id=null; el.innerHTML=''; } }
}

function buildLiveMap(){
  const el=$('liveMap'), off=$('liveMapOffline');
  if(typeof L==='undefined'){ el.style.display='none'; off.style.display='flex'; return; }
  el.style.display='block'; off.style.display='none';
  try{
    if(mmMap){ try{mmMap.remove();}catch(e){} mmMap=null; }
    if(el._leaflet_id){ el._leaflet_id=null; el.innerHTML=''; }
    // center on the active route's departure if present, else SA, else GPS
    let center=[-29,25], zoom=6;
    const di=depPick.get();
    if(di!=null){ center=[AIRPORTS[di].lat,AIRPORTS[di].lon]; zoom=8; }
    if(GPS.pos){ center=[GPS.pos.lat,GPS.pos.lon]; zoom=10; }
    const map=L.map(el,{zoomControl:true,attributionControl:false}).setView(center,zoom);
    mmMap=map;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18}).addTo(map);
    mmLayers={};
    drawActiveRoute();
    drawAllAirportsLight();
    if(mmState.glide) drawGlideRing();
    if(mmState.track) drawBreadcrumb();
    if(GPS.pos) drawOwnShip(GPS.pos);
    // size settle
    function fit(t){ if(!mmMap)return; try{ map.invalidateSize();
      const di=depPick.get(),ai=arrPick.get();
      if(di!=null&&ai!=null){ map.fitBounds([[AIRPORTS[di].lat,AIRPORTS[di].lon],[AIRPORTS[ai].lat,AIRPORTS[ai].lon]],{padding:[50,50]}); }
    }catch(e){} if(t>0) setTimeout(()=>fit(t-1),150); }
    requestAnimationFrame(()=>fit(6));
  }catch(e){ el.style.display='none'; off.style.display='flex'; off.textContent='Map could not load. ['+(e&&e.message?e.message:e)+']'; }
}

function drawActiveRoute(){
  if(!mmMap) return;
  if(mmLayers.route){ mmMap.removeLayer(mmLayers.route); mmLayers.route=null; }
  if(mmLayers.routeDots){ mmLayers.routeDots.forEach(d=>mmMap.removeLayer(d)); }
  mmLayers.routeDots=[];
  const di=depPick.get(), ai=arrPick.get();
  if(di==null||ai==null) return;
  const wps=(typeof waypoints!=='undefined'?waypoints:[]).filter(w=>w!=null&&AIRPORTS[w]);
  const stopIdx=[di,...wps,ai];
  const pts=stopIdx.map(i=>[AIRPORTS[i].lat,AIRPORTS[i].lon]);
  mmLayers.route=L.polyline(pts,{color:'#ffb000',weight:3,opacity:.9}).addTo(mmMap);
  stopIdx.forEach((ix,k)=>{const a=AIRPORTS[ix];const isEnd=(k===0||k===stopIdx.length-1);
    const m=L.circleMarker([a.lat,a.lon],{radius:isEnd?7:6,color:isEnd?'#ffb000':'#3fd0ff',weight:2,
      fillColor:isEnd?'#ffb000':'#3fd0ff',fillOpacity:.85}).bindTooltip((k+1)+'. '+(a.icao||a.name),{direction:'top'}).addTo(mmMap);
    mmLayers.routeDots.push(m);
  });
}
function drawAllAirportsLight(){
  if(!mmMap || mmLayers.apts) return;
  const grp=L.layerGroup();
  AIRPORTS.forEach(a=>{ if(a.custom) return;
    L.circleMarker([a.lat,a.lon],{radius:2,color:'#5a6b7d',weight:1,fillColor:'#5a6b7d',fillOpacity:.5})
      .bindTooltip((a.icao||a.name),{direction:'top'}).addTo(grp);
  });
  grp.addTo(mmMap); mmLayers.apts=grp;
}
function drawOwnShip(pos){
  if(!mmMap||!pos) return;
  if(mmLayers.ship){ mmMap.removeLayer(mmLayers.ship); }
  mmLayers.ship=L.circleMarker([pos.lat,pos.lon],{radius:8,color:'#27d796',weight:3,fillColor:'#0a0e14',fillOpacity:1})
    .bindTooltip('You',{direction:'top'}).addTo(mmMap);
  if(mmState.follow) mmMap.panTo([pos.lat,pos.lon]);
}
function drawGlideRing(){
  if(!mmMap) return;
  if(mmLayers.glide){ mmMap.removeLayer(mmLayers.glide); mmLayers.glide=null; }
  if(!GPS.pos || GPS.pos.alt==null) return; // need GPS altitude
  // glide distance = height AGL-ish * glide ratio. We use GPS altitude (AMSL) as a
  // conservative proxy; honest caveat shown in the info strip.
  const ac=readBase();
  const ratio=(ac.glideRatio&&ac.glideRatio>0)?ac.glideRatio:9; // default ~9:1 light single
  const glideM=Math.max(0, GPS.pos.alt*ratio); // metres
  mmLayers.glide=L.circle([GPS.pos.lat,GPS.pos.lon],{radius:glideM,color:'#27d796',weight:2,
    dashArray:'6 5',fill:false}).addTo(mmMap);
}
function drawBreadcrumb(){
  if(!mmMap) return;
  if(mmLayers.crumb){ mmMap.removeLayer(mmLayers.crumb); mmLayers.crumb=null; }
  if(GPS.breadcrumbs.length<2) return;
  mmLayers.crumb=L.polyline(GPS.breadcrumbs.map(b=>[b.lat,b.lon]),{color:'#3fd0ff',weight:2,opacity:.7}).addTo(mmMap);
}

function onGpsForMap(pos){
  if(!mmActive) { return; }
  if(pos){ drawOwnShip(pos); if(mmState.glide) drawGlideRing(); if(mmState.track) drawBreadcrumb(); if(mmDirectTo!=null) drawDirectTo(); }
  updateMmInfo(pos);
  if(mmState.nearest) updateNearestPanel(pos);
  if(typeof updateTerrainAGL==='function') updateTerrainAGL(pos); // rough AGL, throttled
}
function updateMmInfo(pos){
  const el=$('mmInfo'); if(!el) return;
  if(!GPS.on){ el.style.display='none'; return; }
  el.style.display='flex';
  if(!pos){ el.innerHTML='<div class="mi"><div class="k">GPS</div><div class="v">acquiring…</div></div>'; return; }
  const gs = pos.speed!=null ? Math.round(pos.speed*1.94384) : null; // m/s -> kt
  const alt = pos.alt!=null ? Math.round(pos.alt*(U.dist==='km'?1:3.28084)) : null;
  const trk = pos.heading!=null && !isNaN(pos.heading) ? Math.round(pos.heading) : null;
  // rough AGL = GPS altitude (AMSL) - terrain elevation. Advisory only.
  let aglTxt='--';
  if(pos.alt!=null && curTerrainM!=null){
    const aglM=pos.alt-curTerrainM;
    const aglShown=Math.round(aglM*(U.dist==='km'?1:3.28084));
    aglTxt=n0(aglShown);
  }
  el.innerHTML=
    '<div class="mi"><div class="k">GS</div><div class="v">'+(gs!=null?gs+' kt':'--')+'</div></div>'+
    '<div class="mi"><div class="k">Track</div><div class="v">'+(trk!=null?trk+'°':'--')+'</div></div>'+
    '<div class="mi"><div class="k">Alt '+(U.dist==='km'?'m':'ft')+'</div><div class="v">'+(alt!=null?n0(alt):'--')+'</div></div>'+
    '<div class="mi"><div class="k">~AGL '+(U.dist==='km'?'m':'ft')+'</div><div class="v" title="Approximate — from ~90 m terrain data + GPS altitude. Not for terrain clearance.">'+aglTxt+'</div></div>'+
    '<div class="mi"><div class="k">Acc</div><div class="v">'+(pos.acc!=null?Math.round(pos.acc)+'m':'--')+'</div></div>';
}
function updateNearestPanel(pos){
  const el=$('mmNearestPanel'); if(!el) return;
  if(!mmState.nearest || !pos){ el.style.display='none'; return; }
  const here={lat:pos.lat,lon:pos.lon};
  const near=AIRPORTS.map((a,i)=>({a,i,d:distance(here,a).nm})).sort((x,y)=>x.d-y.d).slice(0,6);
  el.style.display='block';
  el.innerHTML='<h4>Nearest airfields — tap to go direct</h4>'+near.map(o=>{
    const a=o.a, b=bearing(here,a);
    const isTgt=(mmDirectTo===o.i);
    return '<div class="mm-near-row'+(isTgt?' tgt':'')+'" data-direct="'+o.i+'"><span class="c">'+(a.custom?'📍':esc(a.icao||a.iata||'----'))+'</span>'+
      '<span class="n">'+esc(a.name)+'</span>'+
      '<span class="d">'+n0(distOut(o.d))+' '+distUnit()+'<small>'+compass(b)+'</small></span>'+
      '<span class="go">'+(isTgt?'✓ active':'→ Direct')+'</span></div>';
  }).join('')+(mmDirectTo!=null?'<button class="mm-clear-direct" id="mmClearDirect">✕ Clear direct-to</button>':'');
  // tap a row to go direct
  el.querySelectorAll('[data-direct]').forEach(row=>row.addEventListener('click',()=>{
    setDirectTo(+row.dataset.direct);
  }));
  const clr=$('mmClearDirect'); if(clr) clr.onclick=()=>{ clearDirectTo(); };
}

// ---- Direct-to: route from current GPS position straight to a chosen airfield ----
function setDirectTo(idx){
  mmDirectTo=idx;
  drawDirectTo();
  updateNearestPanel(GPS.pos);
  // also make it the planner destination so the rest of the app reflects the choice
  if(typeof arrPick!=='undefined' && arrPick.setIndex){ try{arrPick.setIndex(idx);}catch(e){} }
}
function clearDirectTo(){
  mmDirectTo=null;
  if(mmLayers.direct){ mmMap.removeLayer(mmLayers.direct); mmLayers.direct=null; }
  if(mmLayers.directTgt){ mmMap.removeLayer(mmLayers.directTgt); mmLayers.directTgt=null; }
  updateNearestPanel(GPS.pos);
}
function drawDirectTo(){
  if(!mmMap || mmDirectTo==null || !GPS.pos) return;
  const t=AIRPORTS[mmDirectTo]; if(!t) return;
  if(mmLayers.direct){ mmMap.removeLayer(mmLayers.direct); }
  if(mmLayers.directTgt){ mmMap.removeLayer(mmLayers.directTgt); }
  // magenta direct track from current position to the target
  mmLayers.direct=L.polyline([[GPS.pos.lat,GPS.pos.lon],[t.lat,t.lon]],
    {color:'#ff4fd8',weight:3,opacity:.95,dashArray:'2 6'}).addTo(mmMap);
  mmLayers.directTgt=L.circleMarker([t.lat,t.lon],{radius:8,color:'#ff4fd8',weight:3,
    fillColor:'#ff4fd8',fillOpacity:.35}).bindTooltip('Direct: '+(t.icao||t.name),{direction:'top',permanent:false}).addTo(mmMap);
}

function updateMmButtons(){
  const set=(id,on)=>{const b=$(id); if(b) b.classList.toggle('active',!!on);};
  set('mmGps',GPS.on); set('mmGlide',mmState.glide); set('mmNearest',mmState.nearest);
  set('mmTrack',mmState.track); set('mmWx',mmState.wx);
  const dot=$('mmGpsDot'); if(dot) dot.style.background=GPS.on?(GPS.pos?'#27d796':'#ffb000'):'#ff5a52';
}

// wire map mode buttons (once)
function wireMapModeButtons(){
  $('mmGps').onclick=()=>{
    if(GPS.on){ GPS.stop(); }
    else { GPS.start(); }
    GPS.save(); updateMmButtons(); updateMmInfo(GPS.pos);
  };
  $('mmGlide').onclick=()=>{ mmState.glide=!mmState.glide; GPS.features.glide=mmState.glide; GPS.save();
    if(mmState.glide){ if(!GPS.on){ GPS.start(); } drawGlideRing(); } else if(mmLayers.glide){ mmMap.removeLayer(mmLayers.glide); mmLayers.glide=null; }
    updateMmButtons(); };
  $('mmNearest').onclick=()=>{ mmState.nearest=!mmState.nearest; GPS.features.nearest=mmState.nearest; GPS.save();
    if(mmState.nearest && !GPS.on){ GPS.start(); }
    updateNearestPanel(GPS.pos); updateMmButtons(); };
  $('mmTrack').onclick=()=>{ mmState.track=!mmState.track; GPS.features.breadcrumb=mmState.track; GPS.save();
    if(mmState.track){ if(!GPS.on){ GPS.start(); } } else if(mmLayers.crumb){ mmMap.removeLayer(mmLayers.crumb); mmLayers.crumb=null; }
    updateMmButtons(); };
  $('mmWx').onclick=()=>{ mmState.wx=!mmState.wx; updateMmButtons();
    if(mmState.wx){ showMapWeather().catch(e=>toast('Weather error: '+((e&&e.message)||e))); }
    else if(mmLayers.wx){ mmLayers.wx.forEach(m=>mmMap.removeLayer(m)); mmLayers.wx=null; } };
  $('mmRecenter').onclick=()=>{ mmState.follow=true;
    if(GPS.pos && mmMap) mmMap.setView([GPS.pos.lat,GPS.pos.lon], 10);
    else { const di=depPick.get(); if(di!=null&&mmMap) mmMap.setView([AIRPORTS[di].lat,AIRPORTS[di].lon],8); } };
}
// fetch with a timeout so a slow/stuck request can't hang the whole operation
function fetchTimeout(url, ms){
  return Promise.race([
    fetch(url),
    new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')), ms))
  ]);
}
// fetch METARs for many stations. Splits into URL-safe chunks, runs them in
// parallel, and calls onBatch(map) as EACH chunk returns so the map can draw
// progressively instead of waiting for everything. Per-batch timeout + settle
// means one slow chunk never freezes the rest.
async function fetchWxMulti(icaos, onBatch){
  const CHUNK=80, TIMEOUT=8000;
  const chunks=[];
  for(let i=0;i<icaos.length;i+=CHUNK) chunks.push(icaos.slice(i,i+CHUNK));
  let via=null, anyOk=false;
  const merged={};
  await Promise.allSettled(chunks.map(async chunk=>{
    const ids=chunk.join(',');
    const apiM='https://aviationweather.gov/api/data/metar?ids='+encodeURIComponent(ids)+'&format=json';
    const urls=[
      ['netlify-fn','/.netlify/functions/wx?type=metar&ids='+encodeURIComponent(ids)],
      ['allorigins','https://api.allorigins.win/raw?url='+encodeURIComponent(apiM)],
      ['direct',apiM]
    ];
    for(const [name,u] of urls){
      try{
        const r=await fetchTimeout(u, TIMEOUT); if(!r.ok) continue;
        let arr=await r.json();
        if(typeof arr==='string'){ try{arr=JSON.parse(arr);}catch(e){} }
        if(!Array.isArray(arr)) continue;
        const batchMap={};
        arr.forEach(m=>{ const code=m.icaoId||m.station_id; if(code){ merged[code]=m; batchMap[code]=m; } });
        anyOk=true; via=via||name;
        if(onBatch) { try{ onBatch(batchMap); }catch(e){} } // draw this batch now
        break; // chunk done
      }catch(e){ /* try next source */ }
    }
  }));
  return anyOk ? {map:merged, via} : {map:{}, error:'all sources failed (timeout or blocked)'};
}

// how old is a METAR, in minutes? uses obsTime (epoch seconds) or reportTime
function metarAgeMin(m){
  let t=null;
  if(m.obsTime) t=m.obsTime*1000;
  else if(m.reportTime){ const d=new Date(m.reportTime.replace(' ','T')+(m.reportTime.indexOf('Z')<0?'Z':'')); if(!isNaN(d)) t=d.getTime(); }
  if(t==null) return null;
  return Math.round((Date.now()-t)/60000);
}

// plot color-coded weather around region airfields on the live map.
// Draws progressively as data arrives, only shows reasonably current reports.
const WX_MAX_AGE_MIN=90; // hide reports older than this (stale); METARs issue hourly
async function showMapWeather(){
  if(!mmMap){ toast('Weather: map not ready yet — wait a moment and try again.'); mmState.wx=false; updateMmButtons(); return; }
  if(mmLayers.wx){ mmLayers.wx.forEach(m=>mmMap.removeLayer(m)); }
  mmLayers.wx=[];
  // Query only fields likely to report (medium/large airports). METAR stations
  // are virtually always these, so this catches essentially all real stations
  // while skipping hundreds of tiny strips that never report — far faster.
  const idList=AIRPORTS.filter(a=>a.icao && !a.custom &&
      (a.type==='large_airport'||a.type==='medium_airport')).map(a=>a.icao);
  if(!idList.length){ toast('Weather: no reporting airfields found.'); mmState.wx=false; updateMmButtons(); return; }
  toast('Loading weather…', 8000);
  const colors={VFR:'#27d796',MVFR:'#3fd0ff',IFR:'#ff5a52',LIFR:'#c061ff'};
  const seen=new Set();
  let shown=0, stale=0;
  // draw each station as its batch arrives
  const drawBatch=(batchMap)=>{
    Object.keys(batchMap).forEach(icao=>{
      if(seen.has(icao)) return; seen.add(icao);
      const m=batchMap[icao]; if(!m || !m.fltCat) return;
      const age=metarAgeMin(m);
      if(age!=null && age>WX_MAX_AGE_MIN){ stale++; return; } // skip stale
      const a=AIRPORTS.find(x=>x.icao===icao); if(!a) return;
      const c=colors[m.fltCat]||'#5a6b7d';
      const ageTxt=(age!=null)?(' · '+age+' min old'):'';
      const zone=L.circle([a.lat,a.lon],{radius:55000,color:c,weight:0,fillColor:c,fillOpacity:.16});
      const dot=L.circleMarker([a.lat,a.lon],{radius:7,color:c,weight:2,fillColor:c,fillOpacity:.9})
        .bindTooltip(icao+': '+(CAT_LABEL[m.fltCat]||m.fltCat)+ageTxt+(m.rawOb?' — '+m.rawOb:''),{direction:'top'});
      zone.addTo(mmMap); dot.addTo(mmMap);
      mmLayers.wx.push(zone, dot); shown++;
    });
    if(shown) toast(shown+' airfield'+(shown>1?'s':'')+' shown'+(stale?' ('+stale+' stale hidden)':'')+'. Washes = current data; gaps = none.', 6000);
  };
  const {error,via}=await fetchWxMulti(idList, drawBatch);
  if(!shown){ toast(error? ('No weather ('+error+')') : 'No current weather reports right now.'); }
}
// small transient on-screen message (so Map mode can give feedback without alert popups)
function toast(msg, ms){
  let t=$('mmToast');
  if(!t){ t=document.createElement('div'); t.id='mmToast'; t.className='mm-toast';
    const c=$('mapModeContainer')||document.body; c.appendChild(t); }
  t.textContent=msg; t.style.opacity='1';
  clearTimeout(window._toastTimer);
  window._toastTimer=setTimeout(()=>{ if(t) t.style.opacity='0'; }, ms||5000);
}

// ================= TERRAIN ELEVATION / AGL =================
// Rough AGL for situational awareness ONLY. Uses a free ~90 m digital elevation
// model (Open-Meteo). NOT an obstacle/terrain-clearance system — it can't see
// towers, power lines, or sharp ridges, and phone GPS altitude is itself coarse.
// Needs internet. Throttled so it doesn't hammer the API or the battery.
let terrainCache={};      // "lat,lon" rounded -> elevation m
let lastTerrainFetch=0;
let curTerrainM=null;     // last known terrain elevation at our position (m)

async function fetchTerrain(lat,lon){
  const key=lat.toFixed(3)+','+lon.toFixed(3); // ~100 m grid; cache hits keep it light
  if(terrainCache[key]!=null) return terrainCache[key];
  try{
    const url='https://api.open-meteo.com/v1/elevation?latitude='+lat.toFixed(5)+'&longitude='+lon.toFixed(5);
    const r=await fetch(url); if(!r.ok) throw new Error('HTTP '+r.status);
    const j=await r.json();
    const el=(j&&j.elevation&&j.elevation.length)?j.elevation[0]:null;
    if(el!=null) terrainCache[key]=el;
    return el;
  }catch(e){ return null; }
}
// called from the GPS map hook; throttled to ~every 4 s
async function updateTerrainAGL(pos){
  if(!pos) return;
  const now=Date.now();
  if(now-lastTerrainFetch < 4000) return; // throttle
  lastTerrainFetch=now;
  const el=await fetchTerrain(pos.lat,pos.lon);
  if(el!=null){ curTerrainM=el; if(mmActive) updateMmInfo(GPS.pos); }
}

// ---------- register service worker (offline support) ----------
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(()=>{ /* offline support optional */ });
  });
}
