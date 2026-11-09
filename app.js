const defaults = { exterior: 32, confort: 22, potencia: 1.5, horas: 6, pesoEnergia: 0.55, pesoConfort: 0.45, learning: 0.18, initial: 24, min: 18, max: 30 };
const scenarios = {
  base: { exterior: 32, potencia: 1.5, horas: 6 },
  efficient: { exterior: 30, potencia: 1.0, horas: 5 },
  hot: { exterior: 38, potencia: 2.0, horas: 8 }
};
let state = { ...defaults };
let initialTemperature = defaults.initial;
let running = false;
let timer = null;
let iterations = [];
let trials = JSON.parse(localStorage.getItem('ecoenergia-trials') || '[]');

const controlSpecs = [
  ['exterior', 'Temperatura exterior', 20, 40, 1, ' °C'],
  ['confort', 'Confort deseado', 18, 26, 0.5, ' °C'],
  ['potencia', 'Potencia nominal', 0.5, 3, 0.1, ' kW'],
  ['horas', 'Horas de uso', 1, 12, 0.5, ' h'],
  ['pesoEnergia', 'Peso del consumo', 0, 1, 0.05, ''],
  ['pesoConfort', 'Peso del confort', 0, 1, 0.05, ''],
  ['learning', 'Tasa de aprendizaje (α)', 0.01, 0.5, 0.01, ''],
  ['initial', 'Temperatura inicial', 18, 30, 0.5, ' °C']
];

function createControls() {
  const host = document.getElementById('controls');
  host.innerHTML = controlSpecs.map(([key, label, min, max, step, unit]) => `
    <div class="control">
      <div class="control-head"><label for="${key}">${label}</label><output id="${key}Value">${state[key]}${unit}</output></div>
      <input id="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${state[key]}" aria-label="${label}">
    </div>`).join('');
  controlSpecs.forEach(([key]) => {
    document.getElementById(key).addEventListener('input', event => {
      state[key] = Number(event.target.value);
      if (key === 'initial' && !running) initialTemperature = state.initial;
      syncWeights(key);
      update();
    });
  });
}

function syncWeights(changed) {
  if (changed === 'pesoEnergia') state.pesoConfort = Math.round((1 - state.pesoEnergia) * 100) / 100;
  if (changed === 'pesoConfort') state.pesoEnergia = Math.round((1 - state.pesoConfort) * 100) / 100;
}

function energy(T) {
  return state.potencia * state.horas * Math.max(0, state.exterior - T) / 10;
}
function cost(T) {
  return state.pesoEnergia * energy(T) / 10 + state.pesoConfort * Math.pow((T - state.confort) / 5, 2);
}
function gradient(T) {
  const coolingGradient = state.exterior > T ? -state.pesoEnergia * state.potencia * state.horas / 100 : 0;
  return coolingGradient + 2 * state.pesoConfort * (T - state.confort) / 25;
}
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function theoreticalMinimum() {
  let candidates = [state.min, state.max, state.confort];
  const numerator = state.pesoEnergia * state.potencia * state.horas / 100;
  const analytic = state.confort + numerator * 25 / (2 * state.pesoConfort || 1);
  candidates.push(analytic);
  if (state.pesoConfort > 0) {
    const intersection = state.confort + (25 * state.pesoEnergia * state.potencia * state.horas / 100) / (2 * state.pesoConfort);
    candidates.push(intersection);
  }
  candidates = candidates.filter(T => T >= state.min && T <= state.max && T < state.exterior);
  return candidates.reduce((best, T) => cost(T) < cost(best) ? T : best, candidates[0] ?? clamp(state.confort, state.min, state.max));
}

function update() {
  if (state.pesoEnergia + state.pesoConfort !== 1 && document.activeElement?.id) syncWeights(document.activeElement.id);
  controlSpecs.forEach(([key, , , , , unit]) => {
    const input = document.getElementById(key);
    const output = document.getElementById(`${key}Value`);
    input.value = state[key];
    output.textContent = `${Number(state[key]).toFixed(key === 'initial' || key === 'exterior' || key === 'confort' ? 1 : (key === 'learning' ? 2 : 1))}${unit}`;
  });
  const T = running || iterations.length ? state.initial : initialTemperature;
  document.getElementById('mTemp').textContent = `${T.toFixed(1)} °C`;
  document.getElementById('roomTemp').textContent = `${T.toFixed(1)} °C`;
  document.getElementById('mEnergy').textContent = `${energy(T).toFixed(2)} kWh`;
  document.getElementById('mCost').textContent = cost(T).toFixed(4);
  document.getElementById('mGrad').textContent = `Gradiente: ${gradient(T).toFixed(4)}`;
  const optimum = theoreticalMinimum();
  document.getElementById('optimum').textContent = `${optimum.toFixed(1)} °C`;
  document.getElementById('optCost').textContent = cost(optimum).toFixed(4);
  document.getElementById('optEnergy').textContent = `${energy(optimum).toFixed(2)} kWh`;
  document.getElementById('explanation').textContent = `El modelo propone ${optimum.toFixed(1)} °C como equilibrio entre consumo y confort. A esa temperatura se estiman ${energy(optimum).toFixed(2)} kWh y un índice J de ${cost(optimum).toFixed(4)}.`;
  document.getElementById('workedExample').textContent = `Con T = ${T.toFixed(1)} °C, E ≈ ${energy(T).toFixed(2)} kWh, J(T) ≈ ${cost(T).toFixed(4)} y J'(T) ≈ ${gradient(T).toFixed(4)}.`;
  drawCurve(optimum);
  drawHistory();
}

function drawCurve(optimum) {
  const canvas = document.getElementById('curve');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr; canvas.height = 270 * dpr;
  ctx.scale(dpr, dpr); const w = canvas.clientWidth, h = 270;
  ctx.clearRect(0,0,w,h);
  const pad = { l: 48, r: 18, t: 18, b: 35 };
  const current = running || iterations.length ? state.initial : initialTemperature;
  const vals = Array.from({length: 61}, (_, i) => state.min + i * (state.max - state.min) / 60).map(cost);
  const yMax = Math.max(...vals) * 1.08;
  const sx = x => pad.l + (x - state.min) / (state.max - state.min) * (w-pad.l-pad.r);
  const sy = y => pad.t + (1 - y / yMax) * (h-pad.t-pad.b);
  ctx.strokeStyle='#dbe4dd'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(pad.l,pad.t); ctx.lineTo(pad.l,h-pad.b); ctx.lineTo(w-pad.r,h-pad.b); ctx.stroke();
  ctx.strokeStyle='#13a06f'; ctx.lineWidth=3; ctx.beginPath();
  for (let i=0;i<=60;i++) { const T=state.min+i*(state.max-state.min)/60; const x=sx(T), y=sy(cost(T)); i?ctx.lineTo(x,y):ctx.moveTo(x,y); }
  ctx.stroke();
  ctx.fillStyle='#142438'; ctx.beginPath(); ctx.arc(sx(clamp(current,state.min,state.max)),sy(cost(clamp(current,state.min,state.max))),5,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#13a06f'; ctx.beginPath(); ctx.arc(sx(optimum),sy(cost(optimum)),6,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#65758a'; ctx.font='11px Segoe UI'; ctx.fillText(`${state.min} °C`,pad.l,h-12); ctx.fillText(`${state.max} °C`,w-pad.r-32,h-12);
}

function drawHistory() {
  const canvas = document.getElementById('history');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr; canvas.height = 270 * dpr;
  ctx.scale(dpr, dpr); const w=canvas.clientWidth, h=270, pad={l:48,r:18,t:18,b:35};
  ctx.clearRect(0,0,w,h); ctx.strokeStyle='#dbe4dd'; ctx.beginPath(); ctx.moveTo(pad.l,h-pad.b); ctx.lineTo(w-pad.r,h-pad.b); ctx.stroke();
  if (!iterations.length) return;
  const yMax=Math.max(...iterations)*1.05, yMin=Math.min(...iterations)*.95;
  const sx=i=>pad.l+(iterations.length===1?0:i/(iterations.length-1)*(w-pad.l-pad.r));
  const sy=y=>pad.t+(1-(y-yMin)/(yMax-yMin||1))*(h-pad.t-pad.b);
  ctx.strokeStyle='#4d8ca8'; ctx.lineWidth=3; ctx.beginPath();
  iterations.forEach((y,i)=> i?ctx.lineTo(sx(i),sy(y)):ctx.moveTo(sx(i),sy(y))); ctx.stroke();
}

function start() {
  if (running) return;
  if (!iterations.length) {
    initialTemperature = state.initial;
    iterations = [cost(state.initial)];
  }
  running = true;
  document.getElementById('start').disabled = true;
  document.getElementById('pause').disabled = false;
  document.getElementById('acStatus').textContent = 'OPTIMIZANDO';
  document.getElementById('status').textContent = 'Ejecutando descenso del gradiente...';
  timer = setInterval(step, document.getElementById('reducedMotion').checked ? 35 : 500);
}
function step() {
  const g = gradient(state.initial);
  state.initial = clamp(state.initial - state.learning * g, state.min, state.max);
  iterations.push(cost(state.initial));
  document.getElementById('mIter').textContent = iterations.length - 1;
  document.getElementById('status').textContent = iterations.length > 1 ? `Iteración ${iterations.length-1}: paso hacia la zona de menor índice.` : document.getElementById('status').textContent;
  update();
  if (iterations.length > 80 || Math.abs(g) < .002) pause(true);
}
function pause(completed=false) {
  clearInterval(timer); timer=null; running=false;
  document.getElementById('start').disabled = false;
  document.getElementById('pause').disabled = true;
  document.getElementById('pause').textContent = 'Ⅱ Pausar';
  document.getElementById('acStatus').textContent = completed ? 'ÓPTIMO' : 'PAUSADO';
  if (completed) document.getElementById('status').textContent = 'Convergencia alcanzada. Compara el resultado con el óptimo teórico.';
  update();
}
function reset() {
  clearInterval(timer); timer=null; running=false;
  state.initial = initialTemperature; iterations=[];
  document.getElementById('start').disabled=false; document.getElementById('pause').disabled=true;
  document.getElementById('acStatus').textContent='LISTO'; document.getElementById('mIter').textContent='0';
  document.getElementById('status').textContent='Reiniciado sin borrar ensayos.';
  update();
}

function saveTrial() {
  const code=document.getElementById('studentCode').value.trim(), group=document.getElementById('group').value.trim();
  if (!code || !group) { document.getElementById('storageStatus').textContent='Completa el código y el grupo antes de guardar.'; return; }
  const optimum=theoreticalMinimum();
  trials.push({ id:Date.now(), date:new Date().toLocaleString(), code, group, name:document.getElementById('studentName').value.trim(), course:document.getElementById('course').value.trim(), initial:initialTemperature, final:state.initial, exterior:state.exterior, energy:energy(state.initial), cost:cost(state.initial), optimum, prediction:document.getElementById('prediction').value.trim(), observation:document.getElementById('observation').value.trim(), conclusion:document.getElementById('conclusion').value.trim() });
  localStorage.setItem('ecoenergia-trials',JSON.stringify(trials)); renderTrials();
  document.getElementById('storageStatus').textContent=`Ensayo guardado en este navegador. Total: ${trials.length}.`;
}
function renderTrials() {
  document.getElementById('rows').innerHTML=trials.map((t,i)=>`
    <tr><td><input class="trialSelect" type="checkbox" value="${t.id}" aria-label="Seleccionar ensayo ${i+1}"></td><td>${i+1}</td><td>${t.date}</td><td>${escapeHtml(t.code)} / ${escapeHtml(t.group)}</td><td>${t.initial.toFixed(1)}</td><td>${t.final.toFixed(1)}</td><td>${t.exterior.toFixed(1)}</td><td>${t.energy.toFixed(2)}</td><td>${t.cost.toFixed(4)}</td><td>${escapeHtml(t.observation)}</td><td><button data-delete="${t.id}">Eliminar</button></td></tr>`).join('');
  document.querySelectorAll('[data-delete]').forEach(button=>button.addEventListener('click',()=>{ trials=trials.filter(t=>String(t.id)!==button.dataset.delete); localStorage.setItem('ecoenergia-trials',JSON.stringify(trials)); renderTrials(); }));
}
function escapeHtml(value='') { const div=document.createElement('div'); div.textContent=value; return div.innerHTML; }
function compareTrials() {
  const selected=[...document.querySelectorAll('.trialSelect:checked')].map(i=>trials.find(t=>String(t.id)===i.value)).filter(Boolean);
  const target=document.getElementById('comparison');
  if(selected.length!==2){target.textContent='Selecciona exactamente dos ensayos para compararlos.'; return;}
  const a=selected[0], b=selected[1];
  target.innerHTML=`<b>Comparación de los ensayos ${trials.indexOf(a)+1} y ${trials.indexOf(b)+1}</b><br>Exterior: ${a.exterior} °C frente a ${b.exterior} °C.<br>Temperatura inicial: ${a.initial.toFixed(1)} °C frente a ${b.initial.toFixed(1)} °C.<br>Temperatura final: ${a.final.toFixed(1)} °C frente a ${b.final.toFixed(1)} °C.<br>Consumo final: ${a.energy.toFixed(2)} kWh frente a ${b.energy.toFixed(2)} kWh.`;
}
function download(filename, content, type) {
  const blob=new Blob([content],{type}); const link=document.createElement('a'); link.href=URL.createObjectURL(blob); link.download=filename; link.click(); URL.revokeObjectURL(link.href);
}
function csvCell(value='') { return `"${String(value).replace(/"/g,'""')}"`; }
function downloadCsv() {
  const headers=['Fecha','Código','Grupo','Nombre','Curso','T inicial','T final','Exterior','Consumo kWh','Índice J','Óptimo','Predicción','Observación','Conclusión'];
  const rows=trials.map(t=>[t.date,t.code,t.group,t.name,t.course,t.initial,t.final,t.exterior,t.energy,t.cost,t.optimum,t.prediction,t.observation,t.conclusion]);
  download('ecoenergia-ensayos.csv','\ufeff'+[headers,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');
}
function downloadXlsx() {
  const headers=['Fecha','Código','Grupo','Nombre','Curso','T inicial','T final','Exterior','Consumo kWh','Índice J','Óptimo','Predicción','Observación','Conclusión'];
  let rows=`<Row>${headers.map(h=>`<Cell><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`).join('')}</Row>`;
  trials.forEach(t=>{rows+=`<Row>${[t.date,t.code,t.group,t.name,t.course,t.initial,t.final,t.exterior,t.energy,t.cost,t.optimum,t.prediction,t.observation,t.conclusion].map(v=>`<Cell><Data ss:Type="${typeof v==='number'?'Number':'String'}">${escapeXml(v)}</Data></Cell>`).join('')}</Row>`;});
  const xml=`<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Ensayos"><Table>${rows}</Table></Worksheet></Workbook>`;
  download('ecoenergia-ensayos.xls',xml,'application/vnd.ms-excel');
}
function escapeXml(value='') { return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

document.addEventListener('DOMContentLoaded', () => {
  createControls();
  document.getElementById('start').addEventListener('click',start);
  document.getElementById('pause').addEventListener('click',()=>pause(false));
  document.getElementById('reset').addEventListener('click',reset);
  document.getElementById('restore').addEventListener('click',()=>{state={...defaults};initialTemperature=defaults.initial;iterations=[];syncScenario();update();});
  document.getElementById('reducedMotion').addEventListener('change',e=>document.body.classList.toggle('reduced',e.checked));
  document.getElementById('scenario').addEventListener('change',e=>{Object.assign(state,scenarios[e.target.value]);syncScenario();update();});
  document.getElementById('save').addEventListener('click',saveTrial);
  document.getElementById('compare').addEventListener('click',compareTrials);
  document.getElementById('clear').addEventListener('click',()=>{if(confirm('¿Eliminar todos los ensayos guardados?')){trials=[];localStorage.removeItem('ecoenergia-trials');renderTrials();}});
  document.getElementById('csv').addEventListener('click',downloadCsv);
  document.getElementById('xlsx').addEventListener('click',downloadXlsx);
  document.getElementById('worksheet').addEventListener('click',()=>download('ficha-ecoenergia.txt',worksheetText(),'text/plain;charset=utf-8'));
  document.querySelectorAll('[data-answer]').forEach(button=>button.addEventListener('click',()=>{const answer=document.getElementById(button.dataset.answer);answer.hidden=!answer.hidden;}));
  renderTrials(); update();
  window.addEventListener('resize',update);
});
function syncScenario() {
  const scenario=document.getElementById('scenario');
  if (scenario) scenario.value=scenario.value;
}
function worksheetText() {
  return ['ECOENERGÍA · Ficha de indagación','',`Código: ${document.getElementById('studentCode').value}`,`Grupo: ${document.getElementById('group').value}`,`Predicción: ${document.getElementById('prediction').value}`,`Conclusión: ${document.getElementById('conclusion').value}`,'',...trials.map((t,i)=>`${i+1}. T inicial ${t.initial}, T final ${t.final}, exterior ${t.exterior} °C, observación: ${t.observation}`)].join('\n');
}
