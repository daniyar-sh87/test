import { LV, arr, clamp, lvl, derive } from "./scoring.js";
import { WORKSTREAMS, TASK_STATUSES, normTasks, groupTasks, taskStats, isOverdue, newTaskId, nextAction } from "./tasks.js";

const STAGES=["New","Discovery","Qualified","Proposal","Won","Lost"];
const DEFAULT_DOMAINS=["Smart City","Energy","Finance","Retail"];
let OPPS=[], PRODUCTS=[], aiAvailable=false, canWrite=true, dbReady=false;
let view="pipeline", domain="All", current=null, tab="value", editing=null, aiCtl=null, delArm=null;
let taskEdit=null; // null = task form closed; {} = adding; {id,...} = editing that task
let tasksOpen=false;  // the Tasks section starts collapsed
let statusDraft=null; // {id,text}: a status Claude wrote from task statuses, waiting for review

const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const vc=v=>v==="Go"?"v-go":v==="Qualify"?"v-q":"v-no";
const vk=v=>v==="Go"?"go":v==="Qualify"?"q":"no";
const money=n=>"$"+(Math.round((+n||0)*10)/10)+"M";

/* ---------- API client ---------- */
async function call(method,path,body,signal){
  const res=await fetch(path,{method,signal,headers:body?{"Content-Type":"application/json"}:undefined,body:body?JSON.stringify(body):undefined});
  if(res.status===204) return null;
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw Object.assign(new Error(data.error||res.statusText),{code:data.code,status:res.status});
  return data;
}
const api={
  list:c=>call("GET",`/api/${c}`),
  create:(c,d)=>call("POST",`/api/${c}`,d),
  replace:(c,id,d)=>call("PUT",`/api/${c}/${encodeURIComponent(id)}`,d),
  remove:(c,id)=>call("DELETE",`/api/${c}/${encodeURIComponent(id)}`),
  draft:(text,signal)=>call("POST","/api/ai/draft",{text},signal)
};
async function refresh(){
  const [o,p]=await Promise.all([api.list("opps"),api.list("products")]);
  OPPS=o.map(derive); PRODUCTS=p.sort((a,b)=>String(a.name).localeCompare(String(b.name)));
  dbReady=true; showNotice("");
  if(view!=="form") render();
}

/* ---------- navigation ---------- */
document.querySelectorAll(".navbtn").forEach(b=>b.onclick=()=>{view=b.dataset.v;editing=null;render();});
$("#newBtn").onclick=()=>{editing={};view="form";render();window.scrollTo({top:0});};

function render(){
  document.querySelectorAll(".navbtn").forEach(b=>b.setAttribute("aria-current",b.dataset.v===view?"page":"false"));
  $("#newBtn").hidden=!canWrite||view==="form";
  if(view==="pipeline") renderPipeline();
  else if(view==="products") renderProducts();
  else renderForm();
}

/* ---------- pipeline ---------- */
let mode=(()=>{try{return localStorage.getItem("od-mode")||"exec"}catch(e){return "exec"}})();
let stageFilter=null, bucketFilter=null;
const BUCKETS=[{k:"b0",l:"< $1M",min:0,max:1},{k:"b1",l:"$1–3M",min:1,max:3},{k:"b3",l:"$3–5M",min:3,max:5},{k:"b5",l:"$5–10M",min:5,max:10},{k:"b10",l:"$10M+",min:10,max:Infinity}];
const inBucket=(o,k)=>{const b=BUCKETS.find(x=>x.k===k);return !b||(o.valueM>=b.min&&o.valueM<b.max);};
const FUNNEL=["New","Discovery","Qualified","Proposal","Won"];
const fmtDate=s=>{if(!s)return "";const d=new Date(s);return isNaN(d)?"":d.toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric"});};
function renderPipeline(){
  const el=$("#view");
  if(!dbReady){el.innerHTML=`<div class="card empty"><strong>Loading opportunities…</strong></div>`;return;}
  if(!OPPS.length){el.innerHTML=`<div class="card empty"><strong>No opportunities yet</strong><span>Add your first one, or paste an RFP or client email and let Claude draft the assessment.</span>${canWrite?`<button class="btn primary" id="emptyNew">+ New opportunity</button>`:""}</div>`;
    const b=$("#emptyNew"); if(b) b.onclick=()=>$("#newBtn").click(); return;}
  const domains=["All",...new Set(OPPS.map(o=>o.domain).filter(Boolean))];
  if(!domains.includes(domain)) domain="All";
  const inDomain=OPPS.filter(o=>domain==="All"||o.domain===domain);
  const byStage=o=>!stageFilter||o.stage===stageFilter, byBucket=o=>!bucketFilter||inBucket(o,bucketFilter);
  const items=inDomain.filter(o=>byStage(o)&&byBucket(o)).sort((a,b)=>b.score-a.score);
  if(!items.find(o=>o.id===current)) current=items[0]?.id;
  const sel=items.find(o=>o.id===current);
  const toolbar=`<div class="toolbar">
     <div class="seg" role="group" aria-label="View mode">
       <button id="m-exec" aria-pressed="${mode==="exec"}" data-m="exec">Executive</button>
       <button id="m-ops" aria-pressed="${mode==="ops"}" data-m="ops">Operational</button></div>
     <div class="filters" role="group" aria-label="Filter by domain">${domains.map(d=>`<button class="chip" id="f-${esc(d.replace(/\W/g,''))}" aria-pressed="${d===domain}" data-d="${esc(d)}">${esc(d)}</button>`).join("")}</div>
   </div>`;
  const active=[stageFilter&&`stage <strong>${esc(stageFilter)}</strong>`,bucketFilter&&`deal size <strong>${esc(BUCKETS.find(b=>b.k===bucketFilter).l)}</strong>`].filter(Boolean);
  const filterNote=active.length?`<div class="fnote">Showing <strong>${items.length}</strong> lead${items.length===1?"":"s"} · ${active.join(" · ")} <button class="linkbtn" id="clearStage">Clear filters</button></div>`:"";
  if(mode==="exec"){
    el.innerHTML=`<div class="col">${toolbar}
     <div class="exec-top">
       <section class="card" aria-label="Fit versus value chart">
         <div class="chart-head"><h2 style="font-size:17px">Fit vs. value</h2>
           <div class="legend"><span class="lg-go">Go</span><span class="lg-q">Qualify</span><span class="lg-no">No-go</span></div></div>
         <div class="chartbox">${chartSvg(items)}</div>
       </section>
       <div class="col" style="gap:14px">
         <section class="card" aria-label="Stage funnel"><div class="chart-head"><h2 style="font-size:17px">Pipeline by stage</h2><span class="sub" style="font-size:12px">Tap to filter</span></div>${funnelHtml(inDomain.filter(byBucket))}</section>
         <section class="card" aria-label="Deal size distribution"><div class="chart-head"><h2 style="font-size:17px">Leads by deal size</h2><span class="sub" style="font-size:12px">Tap to filter</span></div>${bucketHtml(inDomain.filter(byStage))}</section>
       </div>
     </div>
     ${filterNote}
     <div class="main exec">
       <div class="list">${items.length?items.map(oppCard).join(""):`<p class="sub card">No leads match these filters.</p>`}</div>
       <article class="card statuscard" id="dossier" aria-live="polite">${statusCardHtml(sel)}</article>
     </div></div>`;
  } else {
    el.innerHTML=`<div class="col">${toolbar}${filterNote}
     <div class="main">
       <div class="col" style="gap:8px"><div class="label">Queue · ranked by opportunity score</div><div class="list">${items.length?items.map(oppCard).join(""):`<p class="sub">No leads match.</p>`}</div></div>
       <article class="card" id="dossier" aria-live="polite">${dossierHtml(sel)}</article>
     </div></div>`;
  }
  el.querySelectorAll(".seg button").forEach(b=>b.onclick=()=>{mode=b.dataset.m;try{localStorage.setItem("od-mode",mode)}catch(e){}renderPipeline();});
  el.querySelectorAll(".chip").forEach(b=>b.onclick=()=>{domain=b.dataset.d;renderPipeline();});
  el.querySelectorAll(".fstage").forEach(b=>b.onclick=()=>{stageFilter=stageFilter===b.dataset.s?null:b.dataset.s;renderPipeline();});
  el.querySelectorAll(".bcol").forEach(b=>b.onclick=()=>{bucketFilter=bucketFilter===b.dataset.b?null:b.dataset.b;renderPipeline();});
  const cs=$("#clearStage"); if(cs) cs.onclick=()=>{stageFilter=null;bucketFilter=null;renderPipeline();};
  el.querySelectorAll(".opp").forEach(b=>b.onclick=()=>select(b.dataset.id,true));
  el.querySelectorAll(".dot").forEach(d=>{d.onclick=()=>select(d.dataset.id,true);d.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();select(d.dataset.id,true);}};});
  const of=$("#openFull"); if(of) of.onclick=()=>{mode="ops";try{localStorage.setItem("od-mode",mode)}catch(e){}renderPipeline();window.scrollTo({top:0});};
  if(mode==="ops") bindDossier();
}
function select(id,scroll){current=id;taskEdit=null;renderPipeline();
  if(scroll&&window.innerWidth<=900){const d=$("#dossier");d&&d.scrollIntoView({behavior:"smooth",block:"start"});}}
function funnelHtml(list){
  const all=[...FUNNEL,"Lost"];
  const rows=all.map(st=>{const os=list.filter(o=>o.stage===st);return {s:st,n:os.length,v:os.reduce((a,o)=>a+o.valueM,0)};});
  const max=Math.max(1,...rows.map(r=>r.n));
  return `<div class="hfunnel">${rows.map(r=>`<button class="fstage${r.s==="Lost"?" lost":""}" id="st-${r.s}" data-s="${esc(r.s)}" aria-pressed="${stageFilter===r.s}" ${stageFilter&&stageFilter!==r.s?'data-dim="1"':""} aria-label="${esc(r.s)}: ${r.n} leads, ${money(r.v)}">
     <span class="fcount num">${r.n}</span>
     <span class="ftrack"><span class="fbar" style="height:${r.n?Math.max(18,r.n/max*100):6}%"></span></span>
     <span class="fname">${esc(r.s)}</span><span class="fval num">${money(r.v)}</span></button>`).join("")}</div>`;
}
function bucketHtml(list){
  const rows=BUCKETS.map(b=>({...b,n:list.filter(o=>inBucket(o,b.k)).length}));
  const max=Math.max(1,...rows.map(r=>r.n));
  return `<div class="bchart">${rows.map(r=>`<button class="bcol" id="bk-${r.k}" data-b="${r.k}" aria-pressed="${bucketFilter===r.k}" ${bucketFilter&&bucketFilter!==r.k?'data-dim="1"':""} aria-label="${esc(r.l)}: ${r.n} leads">
     <span class="bcount num">${r.n}</span><span class="btrack"><span class="bbar" style="height:${r.n?r.n/max*100:0}%"></span></span><span class="fname">${esc(r.l)}</span></button>`).join("")}</div>`;
}
function statusCardHtml(o){
  if(!o) return `<p class="sub">Select a lead to see its latest status.</p>`;
  const top=[...o.risks].sort((a,b)=>LV[b.l]-LV[a.l])[0];
  const best=[...o.products].sort((a,b)=>b.f-a.f)[0];
  const champ=o.stakeholders.find(s=>s.s==="Champion");
  const lv=l=>l==="H"?"High":l==="M"?"Med":"Low";
  const ts=taskStats(normTasks(o.tasks));
  const taskLine=!ts.total?"No tasks yet":`${ts.done} of ${ts.total} done`+(ts.overdue?` · <span style="color:var(--no)">${ts.overdue} overdue</span>`:"")+(ts.blocked?` · <span style="color:var(--q)">${ts.blocked} blocked</span>`:"");
  return `<div class="d-head">
     <div style="min-width:0"><span class="label">${esc(o.domain)} · ${esc(o.client)}</span><h2>${esc(o.title)}</h2>
       <div class="meta"><span>Stage: <strong style="color:var(--ink)">${esc(o.stage)}</strong></span><span class="num">${money(o.valueM)}</span><span>Owner: ${esc(o.owner)||"—"}</span>${o.example?`<span class="ex">example</span>`:""}</div></div>
     <div class="verdict"><span class="big" style="color:var(--${vk(o.verdict)})">${o.score}</span><span class="pill ${vc(o.verdict)}">${o.verdict}</span></div></div>
   ${latestStatusHtml(o,false)}
   <div class="kv">
     <div><span>Next action</span><strong>${nextActionText(o)}</strong></div>
     <div><span>Tasks</span><strong>${taskLine}</strong></div>
     <div><span>Top risk</span><strong>${top?`<span class="lvl l-${top.l}">${lv(top.l)}</span> ${esc(top.c)}: ${esc(top.note)}`:"None recorded"}</strong></div>
     <div><span>Best-fit product</span><strong>${best?`${esc(best.n)} <span class="num">${best.f}%</span>`:"No match yet"}</strong></div>
     <div><span>Champion</span><strong>${champ?esc(champ.n):`<span style="color:var(--no)">None identified</span>`}</strong></div>
   </div>
   <div class="actions"><button class="btn" id="openFull">Open full assessment</button></div>`;
}
function oppCard(o){return `<button class="opp" data-id="${esc(o.id)}" aria-current="${o.id===current}">
   <span class="score ${vc(o.verdict)}">${o.score}</span>
   <span style="min-width:0"><h3>${esc(o.title)}</h3><p>${esc(o.client)} · ${esc(o.domain)}</p>
   <p><span class="pill ${vc(o.verdict)}">${o.verdict}</span> &nbsp;<span class="num">${money(o.valueM)}</span> · ${esc(o.stage)}${o.example?`<span class="ex">example</span>`:""}</p></span></button>`;}
function chartSvg(items){
  const W=560,H=340,L=46,R=12,T=12,B=42,pw=W-L-R,ph=H-T-B;
  const x=v=>L+v/100*pw, y=v=>T+(100-v)/100*ph;
  let s=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Scatter plot of solution fit against value with four quadrants">`;
  s+=`<rect class="c-quad-lo" x="${x(0)}" y="${y(100)}" width="${pw/2}" height="${ph/2}"/>`;
  s+=`<rect class="c-quad-hi" x="${x(50)}" y="${y(100)}" width="${pw/2}" height="${ph/2}"/>`;
  s+=`<rect class="c-quad-lo" x="${x(0)}" y="${y(50)}" width="${pw/2}" height="${ph/2}"/>`;
  s+=`<rect class="c-quad-lo" x="${x(50)}" y="${y(50)}" width="${pw/2}" height="${ph/2}"/>`;
  [0,25,75,100].forEach(t=>{s+=`<line class="c-grid" x1="${x(t)}" x2="${x(t)}" y1="${y(0)}" y2="${y(100)}"/><line class="c-grid" x1="${x(0)}" x2="${x(100)}" y1="${y(t)}" y2="${y(t)}"/>`;});
  s+=`<line class="c-mid" x1="${x(50)}" x2="${x(50)}" y1="${y(0)}" y2="${y(100)}"/><line class="c-mid" x1="${x(0)}" x2="${x(100)}" y1="${y(50)}" y2="${y(50)}"/>`;
  [0,25,50,75,100].forEach(t=>{s+=`<text class="c-tick" x="${x(t)}" y="${y(0)+16}" text-anchor="middle">${t}</text><text class="c-tick" x="${x(0)-8}" y="${y(t)+4}" text-anchor="end">${t}</text>`;});
  s+=`<text class="c-axis" x="${x(50)}" y="${H-6}" text-anchor="middle">Solution fit →</text>`;
  s+=`<text class="c-axis" transform="translate(14 ${y(50)}) rotate(-90)" text-anchor="middle">Value →</text>`;
  s+=`<text class="c-quadlbl" x="${x(0)+10}" y="${y(100)+20}">Build or partner</text>`;
  s+=`<text class="c-quadlbl hi" x="${x(100)-10}" y="${y(100)+20}" text-anchor="end">Pursue</text>`;
  s+=`<text class="c-quadlbl" x="${x(0)+10}" y="${y(0)-10}">Deprioritise</text>`;
  s+=`<text class="c-quadlbl" x="${x(100)-10}" y="${y(0)-10}" text-anchor="end">Quick wins</text>`;
  const sorted=[...items].sort((a,b)=>b.valueM-a.valueM);
  let sel="";
  sorted.forEach(o=>{
    const r=Math.min(22,6+Math.sqrt(Math.max(0,o.valueM))*4);
    const cx=x(clamp(o.fit,2,98)), cy=y(clamp(o.valueScore,2,98));
    s+=`<circle class="dot ${vk(o.verdict)}${o.id===current?" sel":""}" data-id="${esc(o.id)}" cx="${cx}" cy="${cy}" r="${r}" tabindex="0" role="button" aria-label="${esc(o.title)}: fit ${o.fit}, value ${o.valueScore}"><title>${esc(o.title)} — fit ${o.fit}, value ${o.valueScore}, ${money(o.valueM)}</title></circle>`;
    if(o.id===current){
      const t=o.title.length>34?o.title.slice(0,33)+"…":o.title;
      const right=cx<W-200; const tx=right?cx+r+6:cx-r-6;
      const w=t.length*6.6+10;
      sel=`<rect class="c-selbg" x="${right?tx-4:tx-w+4}" y="${cy-11}" width="${w}" height="20" rx="4"/><text class="c-sel" x="${tx}" y="${cy+4}" text-anchor="${right?"start":"end"}">${esc(t)}</text>`;
    }
  });
  return s+sel+`</svg>`;
}
function dim(name,val,hint,inverse){
  const c=inverse?(val>=50?"var(--no)":val>=25?"var(--q)":"var(--go)"):(val>=70?"var(--go)":val>=50?"var(--q)":"var(--no)");
  return `<div class="dim"><div class="row"><span class="label">${name}</span><b style="color:${c}">${val}</b></div><span class="track"><i style="width:${val}%;background:${c}"></i></span><small>${hint}</small></div>`;
}
function dossierHtml(o){
  if(!o) return `<p class="sub">No opportunities in this domain.</p>`;
  const lv=l=>l==="H"?"High":l==="M"?"Med":"Low";
  const panels={
   fit:`<p class="need"><span class="label">Client need</span><br>${esc(o.need)||"—"}</p>
     ${o.products.length?`<div class="tbl"><table><thead><tr><th>Product</th><th>Fit</th><th>Why</th></tr></thead><tbody>
     ${[...o.products].sort((a,b)=>b.f-a.f).map(p=>`<tr><td><strong>${esc(p.n)}</strong></td><td><div class="fitbar"><span class="track"><i style="width:${p.f}%"></i></span><span class="num">${p.f}%</span></div></td><td>${esc(p.note)}</td></tr>`).join("")}</tbody></table></div>`:`<p class="sub">No product matched yet.</p>`}
     <div><span class="label">Gaps needing custom work</span>${o.gaps.length?`<ul class="bul">${o.gaps.map(g=>`<li>${esc(g)}</li>`).join("")}</ul>`:`<p class="sub">None recorded.</p>`}</div>`,
   value:`<div class="kv"><div><span>Deal size</span><strong class="num">${money(o.valueM)}</strong></div><div><span>Timeline</span><strong>${esc(o.timeline)||"—"}</strong></div>
     <div><span>Source</span><strong>${esc(o.source)||"—"}</strong></div><div><span>Stage</span><strong>${esc(o.stage)}</strong></div></div>
     <div><span class="label">Strategic value</span>${o.strategic.length?`<ul class="bul">${o.strategic.map(s=>`<li>${esc(s)}</li>`).join("")}</ul>`:`<p class="sub">None recorded.</p>`}</div>`,
   people:o.stakeholders.length?`<div class="tbl"><table><thead><tr><th>Stakeholder</th><th>Role</th><th>Influence</th><th>Stance</th></tr></thead><tbody>
     ${o.stakeholders.map(s=>`<tr><td><strong>${esc(s.n)}</strong></td><td>${esc(s.r)}</td><td><span class="lvl l-${s.i}">${lv(s.i)}</span></td><td><span class="pill ${s.s==="Champion"?"v-go":s.s==="Blocker"?"v-no":"v-q"}">${esc(s.s)}</span></td></tr>`).join("")}</tbody></table></div>
     ${o.stakeholders.some(s=>s.s==="Champion")?"":`<p class="notice" style="margin:0">No champion identified yet.</p>`}`:`<p class="sub">No stakeholders recorded.</p>`,
   risk:o.risks.length?`<div class="tbl"><table><thead><tr><th>Risk</th><th>Level</th><th>Detail</th><th>Mitigation</th></tr></thead><tbody>
     ${o.risks.map(r=>`<tr><td><strong>${esc(r.c)}</strong></td><td><span class="lvl l-${r.l}">${lv(r.l)}</span></td><td>${esc(r.note)}</td><td>${esc(r.m)||"—"}</td></tr>`).join("")}</tbody></table></div>`:`<p class="sub">No risks recorded.</p>`
  };
  return `<div class="d-head">
     <div style="min-width:0"><span class="label">${esc(o.domain)} · ${esc(o.client)}</span><h2>${esc(o.title)}</h2>
       <div class="meta"><span>Owner: ${esc(o.owner)||"—"}</span><span>Stage: ${esc(o.stage)}</span><span class="num">${money(o.valueM)}</span>${o.example?`<span class="ex">example</span>`:""}</div></div>
     <div class="verdict"><span class="big" style="color:var(--${vk(o.verdict)})">${o.score}</span><span class="pill ${vc(o.verdict)}">${o.verdict}</span></div></div>
   <div class="dims">${dim("Solution fit",o.fit,"Best product match")}${dim("Value",o.valueScore,"Deal size + strategic weight")}${dim("Risk",o.risk,"Sum of rated risks",true)}</div>
   ${latestStatusHtml(o,true)}
   ${nextActionHtml(o)}
   ${tasksHtml(o)}
   <div class="tabs" role="tablist">${[["value","Value"],["fit","Solution fit"],["people","Stakeholders"],["risk","Risks"]].map(([k,l])=>`<button class="tab" role="tab" id="t-${k}" aria-selected="${tab===k}" data-t="${k}">${l}</button>`).join("")}</div>
   <div class="panel" role="tabpanel">${panels[tab]}</div>
   <small class="sub">Score = 40% fit + 35% value + 25% (100 − risk). Go ≥ 70, Qualify 55–69, No-go below 55.</small>
   ${canWrite?`<div class="actions"><button class="btn" id="editBtn">Edit</button><button class="btn danger" id="delBtn">${delArm===o.id?"Tap again to delete":"Delete"}</button></div>`:""}`;
}
/* ---------- latest status (can be written by Claude from task statuses) ---------- */
const AI_TAG_TIP="Written by Claude from the task statuses. Edit the status text to remove this mark.";
const aiTag=(label)=>`<span class="aitag" title="${AI_TAG_TIP}"><span aria-hidden="true">✦</span> ${label}</span>`;
const STATUS_ERR={ai_unavailable:"AI is off on this server. Add ANTHROPIC_API_KEY to .env to turn it on.",no_tasks:"Add some tasks first; the status is written from them.",rate_limited:"Too many requests just now. Try again in a minute.",upstream_error:"The AI service didn't respond. Try again.",invalid_json:"Claude's answer was empty. Try again.",not_found:"This lead no longer exists."};
function latestStatusHtml(o,ops){
  const ai=o.statusSource==="ai-tasks"&&!!o.status;
  const draft=ops&&statusDraft?.id===o.id?statusDraft:null;
  const hasTasks=normTasks(o.tasks).length>0;
  return `<div class="latest"><div class="chart-head"><span class="label">Latest status</span><span class="sub num" style="font-size:12px">${fmtDate(o.statusAt||o.updatedAt||o.createdAt)}</span></div>
     <p>${esc(o.status)||`<span class="sub">No status update yet.</span>`}</p>
     ${ai?`<p class="ailine">${aiTag("AI-generated from task status")}</p>`:""}
     ${draft?`<div class="sdraft" role="group" aria-label="Status written by Claude, not saved yet"><p class="ailine">${aiTag("AI draft from task status")} <span class="sub">Not saved yet</span></p><p>${esc(draft.text)}</p>
        <div class="actions"><button class="btn primary" id="useDraft">Use this status</button><button class="btn" id="discardDraft">Discard</button></div></div>`:""}
     ${ops&&canWrite&&!draft?`<div class="actions"><button class="btn" id="genStatus"${aiAvailable&&hasTasks?"":" disabled"}><span aria-hidden="true">✦</span> Write from task status</button>
        <span class="status" id="sStatus" role="status">${!aiAvailable?"AI is off on this server (no ANTHROPIC_API_KEY).":!hasTasks?"Add tasks to write a status from them.":""}</span></div>`:""}
   </div>`;
}
const rawOf=o=>{const {fit,risk,score,verdict,id,...raw}=o;return raw;}; // a stored record, without derive()'s computed fields

/* ---------- next action: one of the tasks ---------- */
// The next action is the task to work on next (see nextAction() in tasks.js). Deals that have no
// open task fall back to the older free-text "Next action" field.
function nextActionText(o){
  const t=nextAction(normTasks(o.tasks));
  if(t) return `${esc(t.t)} <span class="sub">· ${esc(t.owner)||"Unassigned"}${t.due?` · ${isOverdue(t)?`<span class="od">overdue ${esc(fmtDate(t.due+"T12:00:00"))}</span>`:`due ${esc(fmtDate(t.due+"T12:00:00"))}`}`:""}</span>`;
  const all=normTasks(o.tasks);
  if(all.length) return `<span class="sub">All tasks done</span>`;
  return esc(o.next)||"—";
}
function nextActionHtml(o){
  const t=nextAction(normTasks(o.tasks));
  if(!t&&!o.next&&!normTasks(o.tasks).length) return "";
  return `<div class="next"><span class="label">Next action</span><p>${nextActionText(o)}</p>
    ${t?`<div class="actions"><span class="pill ${t.status==="In progress"?"v-go":"v-q"}">${esc(t.status)}</span><span class="sub">${esc(t.ws)}</span>${canWrite?`<button class="btn" id="doneNext" data-tid="${esc(t.id)}">Mark done</button>`:""}</div>`:""}</div>`;
}

/* ---------- tasks ---------- */
function tasksHtml(o){
  const tasks=normTasks(o.tasks), st=taskStats(tasks);
  const sum=st.total?`${st.done} of ${st.total} done`+(st.overdue?` · <span class="od">${st.overdue} overdue</span>`:"")+(st.blocked?` · <span class="bl">${st.blocked} blocked</span>`:""):"None yet";
  return `<details class="fold" id="tasksD" aria-label="Tasks"${tasksOpen?" open":""}>
    <summary><span class="label">Tasks</span><span class="sub">${sum}</span></summary>
    <div class="tasks">${groupTasks(tasks).map(g=>`<div class="ws"><h3 class="ws-h">${esc(g.ws)} <span class="num">${g.tasks.filter(t=>t.status==="Done").length}/${g.tasks.length}</span></h3>
      <ul class="tlist">${g.tasks.map(taskRow).join("")}</ul></div>`).join("")}
    ${canWrite?(taskEdit?taskFormHtml():`<div class="actions"><button class="btn" id="addTask">+ Add task</button></div>`):""}</div>
  </details>`;
}
function taskRow(t){
  const od=isOverdue(t);
  return `<li class="task${t.status==="Done"?" done":""}" data-tid="${esc(t.id)}">
    <div class="tmain"><span class="ttitle">${esc(t.t)}</span>
      <span class="tmeta"><span>${esc(t.owner)||"Unassigned"}</span><span class="num${od?" od":""}">${t.due?(od?"Overdue · ":"Due ")+esc(fmtDate(t.due+"T12:00:00")):"No due date"}</span></span></div>
    ${canWrite?`<select class="tstatus s-${esc(t.status.replace(/\s/g,"").toLowerCase())}" data-tstatus="${esc(t.id)}" aria-label="Status of ${esc(t.t)}">${TASK_STATUSES.map(s=>`<option${s===t.status?" selected":""}>${s}</option>`).join("")}</select>
      <span class="tbtns"><button class="linkbtn" data-tedit="${esc(t.id)}">Edit</button><button class="linkbtn danger" data-tdel="${esc(t.id)}">${delArm===t.id?"Confirm?":"Delete"}</button></span>`
      :`<span class="pill v-q">${esc(t.status)}</span>`}
  </li>`;
}
function taskFormHtml(){
  const t=taskEdit;
  return `<form class="tform" id="taskForm" novalidate>
    <div class="field"><label for="tk-ws">Workstream</label><select id="tk-ws">${WORKSTREAMS.map(w=>`<option${(t.ws||WORKSTREAMS[0])===w?" selected":""}>${w}</option>`).join("")}</select></div>
    <div class="field"><label for="tk-status">Status</label><select id="tk-status">${TASK_STATUSES.map(s=>`<option${(t.status||TASK_STATUSES[0])===s?" selected":""}>${s}</option>`).join("")}</select></div>
    <div class="field full"><label for="tk-t">Task</label><input id="tk-t" value="${esc(t.t)}" placeholder="e.g. Complete SIG-Lite questionnaire"></div>
    <div class="field"><label for="tk-owner">Owner</label><input id="tk-owner" value="${esc(t.owner)}"></div>
    <div class="field"><label for="tk-due">Due date</label><input id="tk-due" type="date" value="${esc(t.due)}"></div>
    <div class="field full"><div class="actions"><button class="btn primary" type="submit">${t.id?"Save task":"Add task"}</button><button class="btn" type="button" id="tkCancel">Cancel</button></div><div class="status err" id="tkStatus" role="status"></div></div>
  </form>`;
}
// Persist a new task list. PUT replaces the record, so strip fields derive() computes.
async function saveTasks(o,tasks){
  await api.replace("opps",o.id,{...rawOf(o),tasks});
  statusDraft=null; // a draft written from the old task list would be stale
  await refresh();
}
function bindTasks(o){
  const fail=err=>showNotice("Couldn't update tasks: "+(err?.message||"try again."));
  const tasks=()=>normTasks(o.tasks);
  $("#tasksD").ontoggle=e=>{tasksOpen=e.target.open;};
  const dn=$("#doneNext"); if(dn) dn.onclick=async()=>{dn.disabled=true;try{await saveTasks(o,tasks().map(t=>t.id===dn.dataset.tid?{...t,status:"Done"}:t));}catch(e){fail(e);renderPipeline();}};
  const add=$("#addTask"); if(add) add.onclick=()=>{taskEdit={};renderPipeline();$("#tk-t")?.focus();};
  const cancel=$("#tkCancel"); if(cancel) cancel.onclick=()=>{taskEdit=null;renderPipeline();};
  document.querySelectorAll("[data-tstatus]").forEach(s=>s.onchange=async()=>{
    s.disabled=true;
    try{await saveTasks(o,tasks().map(t=>t.id===s.dataset.tstatus?{...t,status:s.value}:t));}catch(e){fail(e);renderPipeline();}
  });
  document.querySelectorAll("[data-tedit]").forEach(b=>b.onclick=()=>{taskEdit=tasks().find(t=>t.id===b.dataset.tedit)||null;renderPipeline();$("#tk-t")?.focus();});
  document.querySelectorAll("[data-tdel]").forEach(b=>b.onclick=async()=>{
    const id=b.dataset.tdel;
    if(delArm!==id){delArm=id;renderPipeline();setTimeout(()=>{if(delArm===id){delArm=null;if(view==="pipeline")renderPipeline();}},4000);return;}
    delArm=null; b.disabled=true;
    try{await saveTasks(o,tasks().filter(t=>t.id!==id));}catch(e){fail(e);renderPipeline();}
  });
  const f=$("#taskForm"); if(f) f.onsubmit=async e=>{
    e.preventDefault();
    const title=$("#tk-t").value.trim();
    if(!title){$("#tkStatus").textContent="Describe the task first.";$("#tk-t").focus();return;}
    const t={id:taskEdit.id||newTaskId(),ws:$("#tk-ws").value,t:title,owner:$("#tk-owner").value,due:$("#tk-due").value,status:$("#tk-status").value};
    const list=tasks(), next=taskEdit.id?list.map(x=>x.id===t.id?t:x):[...list,t];
    f.querySelector("button[type=submit]").disabled=true;
    try{await saveTasks(o,next);taskEdit=null;renderPipeline();}
    catch(err){f.querySelector("button[type=submit]").disabled=false;$("#tkStatus").textContent="Couldn't save: "+(err?.message||"try again.");}
  };
}
function bindDossier(){
  document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{tab=b.dataset.t;renderPipeline();});
  const o=OPPS.find(x=>x.id===current);
  if(o) bindTasks(o);
  const gen=$("#genStatus"); if(gen) gen.onclick=async()=>{
    const st=$("#sStatus"); gen.disabled=true; st.className="status"; st.textContent="Writing from the task list…";
    try{ const r=await call("POST","/api/ai/status",{id:o.id}); statusDraft={id:o.id,text:r.text}; renderPipeline(); }
    catch(err){ gen.disabled=false; st.className="status err"; st.textContent=STATUS_ERR[err?.code]||"Something went wrong. Try again."; }
  };
  const use=$("#useDraft"); if(use) use.onclick=async()=>{
    use.disabled=true; const now=new Date().toISOString();
    try{ await api.replace("opps",o.id,{...rawOf(o),status:statusDraft.text,statusAt:now,statusSource:"ai-tasks",updatedAt:now}); statusDraft=null; await refresh(); }
    catch(err){ use.disabled=false; showNotice("Couldn't save the status: "+(err?.message||"try again.")); }
  };
  const drop=$("#discardDraft"); if(drop) drop.onclick=()=>{statusDraft=null;renderPipeline();};
  const e=$("#editBtn"); if(e) e.onclick=()=>{editing=o;view="form";render();window.scrollTo({top:0});};
  const d=$("#delBtn"); if(d) d.onclick=async()=>{
    if(delArm!==o.id){delArm=o.id;renderPipeline();setTimeout(()=>{if(delArm===o.id){delArm=null;if(view==="pipeline")renderPipeline();}},4000);return;}
    delArm=null; d.disabled=true;
    try{await api.remove("opps",o.id);await refresh();}catch(err){showNotice("Couldn't delete: "+(err?.message||"try again."));}
  };
}

/* ---------- form ---------- */
const lines=v=>String(v||"").split("\n").map(s=>s.trim()).filter(Boolean);
const cells=l=>l.split("|").map(s=>s.trim());
function toText(o){
  return {
    products:arr(o.products).map(p=>`${p.n} | ${p.f} | ${p.note||""}`).join("\n"),
    stakeholders:arr(o.stakeholders).map(s=>`${s.n} | ${s.r||""} | ${s.i||"M"} | ${s.s||"Unknown"}`).join("\n"),
    risks:arr(o.risks).map(r=>`${r.c} | ${r.l||"M"} | ${r.note||""} | ${r.m||""}`).join("\n"),
    gaps:arr(o.gaps).join("\n"), strategic:arr(o.strategic).join("\n")
  };
}
function renderForm(){
  const o=editing||{}; const t=toText(o);
  const domains=[...new Set([...DEFAULT_DOMAINS,...OPPS.map(x=>x.domain).filter(Boolean)])];
  const isEdit=!!o.id;
  $("#view").innerHTML=`<div class="col">
   <div class="chart-head"><h2 style="font-size:22px">${isEdit?"Edit opportunity":"New opportunity"}</h2><button class="btn" id="cancelBtn">Cancel</button></div>
   ${isEdit?"":`<section class="ai" aria-label="Draft with Claude">
     <div><span class="label" style="color:var(--accent)">Draft with Claude</span><p class="sub" style="margin-top:2px">Paste an RFP excerpt, client email or meeting notes. Claude fills in the form below using your product catalog; you review before saving.</p></div>
     <textarea id="aiInput" placeholder="e.g. 'The Authority invites proposals for an AI-based incident detection system covering 140 km of urban roads…'"></textarea>
     <div class="actions"><button class="btn primary" id="aiBtn">Draft assessment</button><button class="btn" id="aiStop" hidden>Stop</button></div>
     <div class="status" id="aiStatus" role="status"></div>
   </section>`}
   <form class="card form" id="oppForm" novalidate>
     <div class="field full"><label for="f-title">Opportunity title</label><input id="f-title" required value="${esc(o.title)}" placeholder="Citywide traffic incident detection"></div>
     <div class="field"><label for="f-client">Client</label><input id="f-client" value="${esc(o.client)}"></div>
     <div class="field"><label for="f-domain">Domain</label><input id="f-domain" list="domainList" value="${esc(o.domain)}"><datalist id="domainList">${domains.map(d=>`<option value="${esc(d)}">`).join("")}</datalist></div>
     <div class="field"><label for="f-source">Source</label><input id="f-source" value="${esc(o.source)}" placeholder="Inbound RFI, partner referral…"></div>
     <div class="field"><label for="f-owner">Owner</label><input id="f-owner" value="${esc(o.owner)}"></div>
     <div class="field"><label for="f-stage">Stage</label><select id="f-stage">${STAGES.map(s=>`<option${(o.stage||"New")===s?" selected":""}>${s}</option>`).join("")}</select></div>
     <div class="field"><label for="f-valueM">Deal size ($M)</label><input id="f-valueM" type="number" min="0" step="0.1" value="${o.valueM??""}"></div>
     <div class="field"><label for="f-timeline">Timeline</label><input id="f-timeline" value="${esc(o.timeline)}" placeholder="Q1 2027 tender"></div>
     <div class="field"><label for="f-valueScore">Value score</label><div class="rangewrap"><input id="f-valueScore" type="range" min="0" max="100" value="${clamp(o.valueScore??50,0,100)}"><output id="vsOut">${clamp(o.valueScore??50,0,100)}</output></div><small>Deal size plus strategic weight, 0–100</small></div>
     <div class="field full"><label for="f-status">Latest status</label><textarea id="f-status" class="prose" placeholder="What happened most recently, e.g. 'Met CIO on 18 Oct; asked for a pilot proposal by end of month.'">${esc(o.status)}</textarea><small>Shown to executives on the lead's status card. Updating it stamps today's date.</small></div>
     <div class="field full"><label for="f-need">Client need</label><textarea id="f-need" class="prose">${esc(o.need)}</textarea></div>
     <div class="field full"><label for="f-products">Product fit</label><textarea id="f-products" placeholder="Vision Analytics | 85 | Core detection models fit">${esc(t.products)}</textarea><small>One per line: product | fit 0–100 | why</small></div>
     <div class="field"><label for="f-gaps">Gaps needing custom work</label><textarea id="f-gaps" class="prose" placeholder="One per line">${esc(t.gaps)}</textarea></div>
     <div class="field"><label for="f-strategic">Strategic value</label><textarea id="f-strategic" class="prose" placeholder="One per line">${esc(t.strategic)}</textarea></div>
     <div class="field full"><label for="f-stakeholders">Stakeholders</label><textarea id="f-stakeholders" placeholder="Director of Operations | Decision maker | H | Champion">${esc(t.stakeholders)}</textarea><small>One per line: name or title | role | influence H/M/L | Champion, Neutral, Blocker or Unknown</small></div>
     <div class="field full"><label for="f-risks">Risks</label><textarea id="f-risks" placeholder="Data access | H | Residency approval not started | Engage DPO early">${esc(t.risks)}</textarea><small>One per line: category | level H/M/L | detail | mitigation</small></div>
     <div class="field full"><label for="f-next">Next action (fallback text)</label><input id="f-next" value="${esc(o.next)}"><small>The card shows the next open task from the Tasks list. This text is only used while a deal has no tasks.</small></div>
     <div class="field full"><div class="actions"><button class="btn primary" type="submit" id="saveBtn">${isEdit?"Save changes":"Save opportunity"}</button></div><div class="status" id="saveStatus" role="status"></div></div>
   </form></div>`;
  $("#cancelBtn").onclick=()=>{aiCtl?.abort();editing=null;view="pipeline";render();};
  $("#f-valueScore").oninput=e=>$("#vsOut").textContent=e.target.value;
  $("#oppForm").onsubmit=saveOpp;
  if(!isEdit) bindAi();
}
function readForm(){
  const v=id=>$("#"+id).value.trim();
  return {
    title:v("f-title"),client:v("f-client"),domain:v("f-domain"),source:v("f-source"),owner:v("f-owner"),stage:v("f-stage"),
    valueM:clamp(parseFloat(v("f-valueM"))||0,0,100000),timeline:v("f-timeline"),valueScore:clamp(parseInt(v("f-valueScore")),0,100),
    need:v("f-need"),next:v("f-next"),status:v("f-status"),gaps:lines(v("f-gaps")),strategic:lines(v("f-strategic")),
    products:lines(v("f-products")).map(l=>{const c=cells(l);return {n:c[0],f:clamp(parseInt(c[1]),0,100),note:c.slice(2).join(" | ")}}).filter(p=>p.n),
    stakeholders:lines(v("f-stakeholders")).map(l=>{const c=cells(l);return {n:c[0],r:c[1]||"",i:lvl(c[2]),s:normStance(c[3])}}),
    risks:lines(v("f-risks")).map(l=>{const c=cells(l);return {c:c[0],l:lvl(c[1]),note:c[2]||"",m:c.slice(3).join(" | ")}})
  };
}
function normStance(s){s=String(s||"").toLowerCase();return s.startsWith("ch")?"Champion":s.startsWith("bl")?"Blocker":s.startsWith("ne")?"Neutral":"Unknown";}
async function saveOpp(e){
  e.preventDefault();
  const st=$("#saveStatus"), btn=$("#saveBtn");
  const data=readForm();
  if(!data.title){st.textContent="Add a title before saving.";st.className="status err";$("#f-title").focus();return;}
  btn.disabled=true; st.className="status"; st.textContent="Saving…";
  data.updatedAt=new Date().toISOString();
  data.tasks=normTasks(editing?.tasks); // the form doesn't edit tasks; keep them
  if(editing?.id) for(const k of ["nextStep","dueDate","lastActivityAt"]) if(editing[k]!==undefined) data[k]=editing[k]; // set by the server's update history; keep them
  data.statusAt=(editing?.id&&editing.status===data.status&&editing.statusAt)?editing.statusAt:(data.status?data.updatedAt:"");
  data.statusSource=(editing?.id&&editing.status===data.status)?(editing.statusSource||""):""; // hand-edited text is no longer AI-generated
  try{
    let id=editing?.id;
    if(id){ data.createdAt=editing.createdAt||data.updatedAt; if(editing.example) data.example=true; await api.replace("opps",id,data); }
    else { data.createdAt=data.updatedAt; const doc=await api.create("opps",data); id=doc.id; }
    current=id; editing=null; view="pipeline"; tab="value"; await refresh(); render(); window.scrollTo({top:0});
  }catch(err){
    btn.disabled=false; st.className="status err";
    st.textContent="Couldn't save: "+(err?.message||"try again.");
  }
}
const AI_ERR={ai_unavailable:"AI drafting is off on this server. Add ANTHROPIC_API_KEY to .env, or fill the form by hand.",rate_limited:"Too many requests just now. Try again in a minute.",refused:"Claude declined this text. Try a shorter or different excerpt.",invalid_json:"Claude's answer couldn't be read. Try again.",prompt_too_large:"That text is too long. Paste a shorter excerpt.",session_expired:"Sign in to Claude again, then retry."};
function bindAi(){
  const btn=$("#aiBtn"), stop=$("#aiStop"), st=$("#aiStatus");
  if(!aiAvailable){btn.disabled=true;st.textContent="AI drafting is off on this server (no ANTHROPIC_API_KEY). You can still fill the form by hand.";}
  stop.onclick=()=>aiCtl?.abort();
  btn.onclick=async()=>{
    const text=$("#aiInput").value.trim();
    if(!text){st.className="status err";st.textContent="Paste some text first.";return;}
    aiCtl=new AbortController(); btn.disabled=true; stop.hidden=false; st.className="status"; st.textContent="Thinking… this can take up to a minute.";
    try{
      const r=await api.draft(text,aiCtl.signal);
      if(!r||typeof r!=="object") throw {code:"invalid_json"};
      const draft={...readForm(),...r}; // keep anything already typed if Claude left it out
      ["title","client","domain","source","timeline","need","next"].forEach(k=>{if(!r[k]) draft[k]=readForm()[k];});
      const keep=$("#aiInput").value;
      editing={...draft,stage:readForm().stage||"New",status:readForm().status}; renderForm();
      $("#aiInput").value=keep; $("#aiStatus").textContent="Draft ready. Review the fields, adjust scores, then save.";
    }catch(e){
      if(e?.name==="AbortError"){st.textContent="Stopped.";}
      else{st.className="status err";st.textContent=AI_ERR[e?.code]||"Something went wrong. Try again.";}
    }finally{const b=$("#aiBtn"),s=$("#aiStop");if(b)b.disabled=!aiAvailable;if(s)s.hidden=true;}
  };
}

const norm=s=>String(s).toLowerCase().replace(/[.;,]+$/,"").replace(/\s+/g," ").trim();

/* ---------- products ---------- */
function renderProducts(){
  const el=$("#view");
  if(!dbReady){el.innerHTML=`<div class="card empty"><strong>Loading…</strong></div>`;return;}
  const stats=p=>{const os=OPPS.filter(o=>o.products.some(x=>norm(x.n)===norm(p.name)&&x.f>=60));return {n:os.length,v:os.reduce((s,o)=>s+o.valueM,0)};};
  el.innerHTML=`<div class="col">
   <div><h2 style="font-size:22px">Product catalog</h2><p class="sub">Claude matches new opportunities against this list, so keep names and descriptions accurate.</p></div>
   ${PRODUCTS.length?`<div class="grid2">${PRODUCTS.map(p=>{const s=stats(p);return `<div class="card prod"><div class="chart-head"><h3>${esc(p.name)}</h3>${p.example?`<span class="ex">example</span>`:""}</div>
     <p style="margin:0">${esc(p.desc)||"<span class='sub'>No description</span>"}</p>
     ${arr(p.domains).length?`<div class="tags">${p.domains.map(d=>`<span class="tag">${esc(d)}</span>`).join("")}</div>`:""}
     <div class="figs sub num" style="font-size:13px">${s.n} strong-fit deals · ${money(s.v)}</div>
     ${canWrite?`<div class="actions"><button class="btn danger" data-del="${esc(p.id)}">${delArm===p.id?"Tap again to remove":"Remove"}</button></div>`:""}</div>`;}).join("")}</div>`
     :`<div class="card empty"><strong>No products yet</strong><span>Add your products so Claude can score solution fit.</span></div>`}
   ${canWrite?`<form class="card form" id="prodForm" novalidate>
     <div class="field full"><h2 style="font-size:18px">Add a product</h2></div>
     <div class="field"><label for="p-name">Name</label><input id="p-name"></div>
     <div class="field"><label for="p-domains">Domains</label><input id="p-domains" placeholder="Smart City, Energy"><small>Comma-separated</small></div>
     <div class="field full"><label for="p-desc">What it does</label><textarea id="p-desc" class="prose" placeholder="One or two sentences on capabilities"></textarea></div>
     <div class="field full"><div class="actions"><button class="btn primary" type="submit">Add product</button></div><div class="status" id="pStatus" role="status"></div></div>
   </form>`:""}</div>`;
  el.querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{const id=b.dataset.del;
    if(delArm!==id){delArm=id;renderProducts();setTimeout(()=>{if(delArm===id){delArm=null;if(view==="products")renderProducts();}},4000);return;}
    delArm=null;b.disabled=true;try{await api.remove("products",id);await refresh();}catch(e){showNotice("Couldn't remove the product. Try again.");}});
  const f=$("#prodForm"); if(f) f.onsubmit=async e=>{e.preventDefault();const st=$("#pStatus");
    const name=$("#p-name").value.trim(); if(!name){st.className="status err";st.textContent="Add a product name.";return;}
    try{await api.create("products",{name,desc:$("#p-desc").value.trim(),domains:$("#p-domains").value.split(",").map(s=>s.trim()).filter(Boolean),createdAt:new Date().toISOString()});await refresh();}
    catch(err){st.className="status err";st.textContent="Couldn't add the product. Try again.";}};
}

function showNotice(t){const n=$("#notice");n.textContent=t;n.hidden=!t;}

/* ---------- boot ---------- */
render();
(async()=>{
  try{ aiAvailable=!!(await call("GET","/api/config")).ai; }catch(e){}
  try{ await refresh(); }
  catch(e){ dbReady=true; showNotice("Can't reach the server. Is it running? Reload to try again."); render(); return; }
  // Pick up teammates' changes while the tab is open.
  setInterval(()=>{ if(document.visibilityState==="visible"&&view!=="form"&&!taskEdit) refresh().catch(()=>showNotice("Lost connection to the server.")); },20000);
})();
