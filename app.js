(() => {
  const cfg = window.CJ_TRACKER_CONFIG || {};
  const configured = cfg.SUPABASE_URL && cfg.SUPABASE_PUBLISHABLE_KEY && !cfg.SUPABASE_URL.includes('PASTE_');
  const sb = configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY) : null;

  const app = document.getElementById('app');
  const statuses = ['Not Started','In Progress','Waiting','Needs Review','Complete'];
  let session = null;
  let member = null;
  let currentView = 'dashboard';
  let modal = null;
  let data = {colleges:[],tasks:[],recruiting:[],scholarships:[],comments:[],activity:[]};

  const esc = (v='') => String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));
  const fmt = d => d ? new Date(d+'T12:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) : 'No date';
  const days = d => { if(!d) return 9999; const x=new Date(d+'T12:00:00'); const t=new Date(); t.setHours(12,0,0,0); return Math.ceil((x-t)/86400000); };
  const pillClass = s => s==='Complete'?'green':s==='In Progress'?'blue':s==='Waiting'?'amber':s==='Needs Review'?'red':'gray';
  const initials = n => (n||'Family').split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase();

  async function boot(){
    if(!configured){ renderConfigHelp(); return; }
    const {data:{session:s}} = await sb.auth.getSession();
    session=s;
    sb.auth.onAuthStateChange((_e,sess)=>{session=sess; if(!sess){member=null; renderLogin();} else loadAll();});
    if(!session) renderLogin(); else await loadAll();
  }

  function renderConfigHelp(){
    app.innerHTML = `<div class="auth-screen"><div class="auth-photo"><div class="auth-brand"><div class="big">CJ's<br>College Tracker</div><div class="small">Black Track Editorial</div></div></div><div class="auth-card-wrap"><div class="auth-card"><div class="kicker">Setup required</div><h1>Connect Supabase</h1><p>Open <strong>config.js</strong> and paste your Supabase Project URL and publishable key. Then refresh this page.</p><div class="error">Never use the secret key in a GitHub Pages app.</div></div></div></div>`;
  }

  function renderLogin(msg=''){
    app.innerHTML = `<div class="auth-screen"><div class="auth-photo"><div class="auth-brand"><div class="big">CJ's<br>College Tracker</div><div class="small">Family Access • Season 2026–27</div></div></div><div class="auth-card-wrap"><form class="auth-card" id="loginForm"><div class="kicker">Family access</div><h1>Sign in</h1><p>Use the account invited through the family Supabase project.</p><div class="field"><label>Email</label><input name="email" type="email" required autocomplete="email"></div><div class="field"><label>Password</label><input name="password" type="password" required autocomplete="current-password"></div>${msg?`<div class="error">${esc(msg)}</div>`:''}<div style="margin-top:16px"><button class="btn red" type="submit">Enter Tracker</button></div></form></div></div>`;
    document.getElementById('loginForm').onsubmit = async e=>{
      e.preventDefault();
      const f=new FormData(e.target);
      const {error}=await sb.auth.signInWithPassword({email:f.get('email'),password:f.get('password')});
      if(error) renderLogin(error.message);
    };
  }

  async function loadAll(){
    const uid=session.user.id;
    const {data:m,error:me}=await sb.from('family_members').select('*').eq('user_id',uid).maybeSingle();
    if(me || !m){ app.innerHTML=`<div class="auth-card-wrap" style="min-height:100vh"><div class="auth-card"><div class="kicker">Access pending</div><h1>Account created</h1><p>This login exists, but it has not been added to the Stanley family workspace yet.</p><button class="btn" id="logoutBtn">Sign out</button></div></div>`; document.getElementById('logoutBtn').onclick=()=>sb.auth.signOut(); return; }
    member=m;
    const [c,t,r,s,a]=await Promise.all([
      sb.from('colleges').select('*').order('interest_level',{ascending:false}),
      sb.from('tasks').select('*').order('due_date',{ascending:true}),
      sb.from('recruiting_contacts').select('*').order('follow_up_date',{ascending:true}),
      sb.from('scholarships').select('*').order('deadline',{ascending:true}),
      sb.from('activity_log').select('*').order('created_at',{ascending:false}).limit(30)
    ]);
    data.colleges=c.data||[]; data.tasks=t.data||[]; data.recruiting=r.data||[]; data.scholarships=s.data||[]; data.activity=a.data||[];
    renderApp();
  }

  function renderApp(){
    app.innerHTML=`<div class="app-shell"><aside class="sidebar"><div class="side-inner"><div><div class="brand-script">CJ's</div><div class="brand-title">College Tracker</div><div class="brand-tag">Discipline<br>Opens Doors</div></div>${nav()}<div class="side-foot">Same Work.<br>Bigger Opportunities.<small>Student Athlete • Future Leader</small></div></div></aside><main class="main"><div class="topbar"><div class="search"><input id="searchInput" placeholder="Search colleges, tasks, or recruiting..."></div><div class="account"><button class="btn small" id="addTaskTop">+ Task</button><div class="avatar">${initials(member.display_name)}</div><div><div><strong>${esc(member.display_name)}</strong></div><div class="sub">Family editor</div></div><button class="btn small" id="logout">Sign out</button></div></div><div id="viewRoot"></div></main></div>${modal?renderModal():''}`;
    bind(); renderView();
  }

  function nav(){
    const items=[['dashboard','⌂','Command Center'],['tasks','◎','Next Moves'],['colleges','▦','Colleges'],['recruiting','◉','Recruiting'],['scholarships','◆','Scholarships'],['financials','▥','Financials']];
    return `<nav class="nav">${items.map(([v,i,l])=>`<button data-view="${v}" class="${currentView===v?'active':''}"><span class="ico">${i}</span>${l}</button>`).join('')}</nav>`;
  }

  function bind(){
    document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{currentView=b.dataset.view; renderApp();});
    document.getElementById('logout').onclick=()=>sb.auth.signOut();
    document.getElementById('addTaskTop').onclick=()=>{modal={type:'task'};renderApp();};
  }

  function renderView(){
    const root=document.getElementById('viewRoot');
    if(currentView==='dashboard') root.innerHTML=dashboard();
    if(currentView==='tasks') root.innerHTML=tasksPage();
    if(currentView==='colleges') root.innerHTML=collegesPage();
    if(currentView==='recruiting') root.innerHTML=recruitingPage();
    if(currentView==='scholarships') root.innerHTML=scholarshipsPage();
    if(currentView==='financials') root.innerHTML=financialsPage();
    bindView();
  }

  function dashboard(){
    const open=data.tasks.filter(t=>t.status!=='Complete');
    const dueWeek=open.filter(t=>days(t.due_date)>=0&&days(t.due_date)<=7).length;
    const waiting=open.filter(t=>t.status==='Waiting').length;
    return `<section class="watermark-page" data-watermark="Lane 01"><div class="hero"><div class="hero-photo"><div class="caption"><small>Student athlete • future leader</small>Discipline today.<br>Opportunity tomorrow.</div></div><div class="hero-copy"><div class="kicker">CJ's College Tracker</div><h1>Family<br>Command Center</h1><div class="meta">Lane 01 &nbsp;//&nbsp; Season 2026–27</div><div class="quote">Preparation today.<br>Opportunities tomorrow.</div></div></div><div class="metrics">${metric(open.length,'Open Tasks','Across the process')}${metric(dueWeek,'Due This Week',dueWeek?'Action needed':'Clear')}${metric(data.colleges.length,'Active Colleges','Applications + fit')}${metric(data.recruiting.length,'Coaches Contacted','Recruiting pipeline')}${metric(data.scholarships.filter(x=>x.status!=='Complete').length,'Scholarships Open','Current pipeline')}${metric(waiting,'Waiting','Blocked / pending')}</div><div class="grid3"><div class="panel">${taskTable(open.slice().sort(taskSort).slice(0,8))}</div><div class="panel">${recruitTable(data.recruiting.slice(0,6))}</div><div class="panel motivation"><div class="copy">Discipline<br>Today<br><span>Opportunities</span><br><span>Tomorrow</span></div></div></div><div class="grid2"><div class="panel">${collegeTable(data.colleges.slice(0,6))}</div><div class="panel">${scholarTable(data.scholarships.slice(0,6))}</div></div></section>`;
  }
  const metric=(n,l,s)=>`<div class="metric"><div class="n">${esc(n)}</div><div class="l">${esc(l)}</div><div class="s">${esc(s)}</div></div>`;
  const head=t=>`<div class="panel-head"><div class="panel-title"><span class="accent">●</span>${esc(t)}</div><div class="panel-link">Live data</div></div>`;
  function taskSort(a,b){ const da=a.due_date||'9999-12-31', db=b.due_date||'9999-12-31'; return da.localeCompare(db); }
  function taskTable(rows){return `${head("CJ's Next Moves")}<div class="table-wrap"><table><thead><tr><th>Task</th><th>Owner</th><th>Due</th><th>Status</th></tr></thead><tbody>${rows.length?rows.map(t=>`<tr><td>${esc(t.title)}</td><td><span class="owner ${t.owner_name==='CJ'?'cj':''}">${esc(t.owner_name||'Unassigned')}</span></td><td>${fmt(t.due_date)}</td><td><span class="pill ${pillClass(t.status)}">${esc(t.status)}</span></td></tr>`).join(''):`<tr><td colspan="4" class="empty">No open tasks yet.</td></tr>`}</tbody></table></div>`}
  function recruitTable(rows){return `${head('Recruiting')}<div class="table-wrap"><table><thead><tr><th>Coach / School</th><th>Last Contact</th><th>Follow Up</th><th>Status</th></tr></thead><tbody>${rows.length?rows.map(r=>`<tr><td><strong>${esc(r.coach_name)}</strong><br><span style="color:var(--muted)">${esc(r.school_name||'')}</span></td><td>${fmt(r.last_contact_date)}</td><td>${fmt(r.follow_up_date)}</td><td><span class="pill ${pillClass(r.status)}">${esc(r.status||'Active')}</span></td></tr>`).join(''):`<tr><td colspan="4" class="empty">No recruiting contacts yet.</td></tr>`}</tbody></table></div>`}
  function collegeTable(rows){return `${head('Colleges')}<div class="table-wrap"><table><thead><tr><th>School</th><th>Deadline</th><th>Visit</th><th>Application</th></tr></thead><tbody>${rows.length?rows.map(c=>`<tr><td>${esc(c.name)}</td><td>${fmt(c.application_deadline)}</td><td>${esc(c.visit_status||'Not Scheduled')}</td><td><span class="pill ${pillClass(c.application_status)}">${esc(c.application_status||'Not Started')}</span></td></tr>`).join(''):`<tr><td colspan="4" class="empty">No colleges yet.</td></tr>`}</tbody></table></div>`}
  function scholarTable(rows){return `${head('Scholarships')}<div class="table-wrap"><table><thead><tr><th>Scholarship</th><th>Amount</th><th>Deadline</th><th>Status</th></tr></thead><tbody>${rows.length?rows.map(s=>`<tr><td>${esc(s.name)}</td><td>${s.amount?new Intl.NumberFormat(undefined,{style:'currency',currency:'USD',maximumFractionDigits:0}).format(s.amount):'—'}</td><td>${fmt(s.deadline)}</td><td><span class="pill ${pillClass(s.status)}">${esc(s.status||'Not Started')}</span></td></tr>`).join(''):`<tr><td colspan="4" class="empty">No scholarships yet.</td></tr>`}</tbody></table></div>`}

  function pageShell(title,desc,watermark,buttonLabel,modalType,content){return `<section class="watermark-page" data-watermark="${esc(watermark)}"><div class="page-head"><div><div class="kicker">Black Track Editorial</div><h2>${esc(title)}</h2><p>${esc(desc)}</p></div>${buttonLabel?`<button class="btn red" data-open="${modalType}">${esc(buttonLabel)}</button>`:''}</div>${content}</section>`}
  function tasksPage(){return pageShell('Next Moves','Prioritized family work across applications, recruiting, scholarships, financial aid, testing, essays, visits, and documents.','Next Moves','+ Add task','task',`<div class="panel">${taskTable(data.tasks.slice().sort(taskSort))}</div>`)}
  function collegesPage(){return pageShell('Colleges','CJ’s active college list, deadlines, visits, majors, cost, fit, and application status.','Colleges','+ Add college','college',`<div class="panel">${collegeTable(data.colleges)}</div>`)}
  function recruitingPage(){return pageShell('Recruiting','Coach outreach, recruiting questionnaires, roster research, benchmarks, and follow-up dates.','Recruiting','+ Add recruiting contact','recruiting',`<div class="panel">${recruitTable(data.recruiting)}</div>`)}
  function scholarshipsPage(){return pageShell('Scholarships','A separate pipeline for institutional and outside scholarship opportunities.','Scholarships','+ Add scholarship','scholarship',`<div class="panel">${scholarTable(data.scholarships)}</div>`)}
  function financialsPage(){
    const rows=data.colleges.filter(c=>c.annual_cost||c.estimated_aid||c.scholarship_amount);
    const content=`<div class="panel">${head('Net Cost Comparison')}<div class="table-wrap"><table><thead><tr><th>College</th><th>Annual Cost</th><th>Scholarships</th><th>Estimated Aid</th><th>Estimated Net</th></tr></thead><tbody>${rows.length?rows.map(c=>{const net=(Number(c.annual_cost)||0)-(Number(c.scholarship_amount)||0)-(Number(c.estimated_aid)||0);return `<tr><td>${esc(c.name)}</td><td>$${Number(c.annual_cost||0).toLocaleString()}</td><td>$${Number(c.scholarship_amount||0).toLocaleString()}</td><td>$${Number(c.estimated_aid||0).toLocaleString()}</td><td><strong>$${Math.max(net,0).toLocaleString()}</strong></td></tr>`}).join(''):`<tr><td colspan="5" class="empty">Add cost and aid values to college records to compare them here.</td></tr>`}</tbody></table></div></div>`;
    return pageShell('Financials','Compare sticker price, scholarships, estimated aid, and likely family cost.','Costs','+ Add / edit college','college',content);
  }

  function bindView(){ document.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>{modal={type:b.dataset.open};renderApp();}); }

  function renderModal(){
    const t=modal.type;
    const title={task:'Add Task',college:'Add College',recruiting:'Add Recruiting Contact',scholarship:'Add Scholarship'}[t]||'Add';
    return `<div class="modal-bg"><form class="modal" id="modalForm"><div class="modal-head"><strong>${title}</strong><button class="btn small" type="button" id="closeModal">Close</button></div><div class="modal-body">${formFields(t)}</div><div class="modal-foot"><button class="btn" type="button" id="cancelModal">Cancel</button><button class="btn red" type="submit">Save</button></div></form></div>`;
  }
  function formFields(t){
    if(t==='task') return `<div class="form-grid"><div class="field span2"><label>Task</label><input name="title" required></div><div class="field"><label>Owner</label><select name="owner_name"><option>CJ</option><option>Dad</option><option>Kristen</option></select></div><div class="field"><label>Status</label><select name="status">${statuses.map(s=>`<option>${s}</option>`).join('')}</select></div><div class="field"><label>Due Date</label><input name="due_date" type="date"></div><div class="field"><label>Category</label><input name="category" placeholder="Application, Recruiting..."></div><div class="field span2"><label>Notes</label><textarea name="notes"></textarea></div></div>`;
    if(t==='college') return `<div class="form-grid"><div class="field span2"><label>College</label><input name="name" required></div><div class="field"><label>Interest level (1-5)</label><input name="interest_level" type="number" min="1" max="5" value="3"></div><div class="field"><label>Application deadline</label><input name="application_deadline" type="date"></div><div class="field"><label>Intended major</label><input name="intended_major"></div><div class="field"><label>Location</label><input name="location"></div><div class="field"><label>Annual cost</label><input name="annual_cost" type="number"></div><div class="field"><label>Scholarship amount</label><input name="scholarship_amount" type="number"></div><div class="field"><label>Estimated aid</label><input name="estimated_aid" type="number"></div><div class="field"><label>Application status</label><select name="application_status">${statuses.map(s=>`<option>${s}</option>`).join('')}</select></div><div class="field"><label>Visit status</label><input name="visit_status" placeholder="Visited / Planned / Not Scheduled"></div><div class="field span2"><label>Notes</label><textarea name="notes"></textarea></div></div>`;
    if(t==='recruiting') return `<div class="form-grid"><div class="field"><label>Coach name</label><input name="coach_name" required></div><div class="field"><label>School</label><input name="school_name"></div><div class="field"><label>Email</label><input name="email" type="email"></div><div class="field"><label>Status</label><input name="status" value="Active"></div><div class="field"><label>Last contact</label><input name="last_contact_date" type="date"></div><div class="field"><label>Follow up</label><input name="follow_up_date" type="date"></div><div class="field span2"><label>Questionnaire URL</label><input name="questionnaire_url"></div><div class="field span2"><label>Roster research / benchmarks / notes</label><textarea name="notes"></textarea></div></div>`;
    if(t==='scholarship') return `<div class="form-grid"><div class="field span2"><label>Scholarship</label><input name="name" required></div><div class="field"><label>Amount</label><input name="amount" type="number"></div><div class="field"><label>Deadline</label><input name="deadline" type="date"></div><div class="field"><label>Owner</label><select name="owner_name"><option>CJ</option><option>Dad</option><option>Kristen</option></select></div><div class="field"><label>Status</label><select name="status">${statuses.map(s=>`<option>${s}</option>`).join('')}</select></div><div class="field span2"><label>Eligibility / requirements</label><textarea name="requirements"></textarea></div></div>`;
    return '';
  }
  async function saveModal(){
    const form=document.getElementById('modalForm'); const fd=new FormData(form); const obj=Object.fromEntries(fd.entries());
    obj.created_by=session.user.id; obj.updated_by=session.user.id;
    let table='';
    if(modal.type==='task') table='tasks';
    if(modal.type==='college') {table='colleges'; ['interest_level','annual_cost','scholarship_amount','estimated_aid'].forEach(k=>{if(obj[k]==='')obj[k]=null;else obj[k]=Number(obj[k]);});}
    if(modal.type==='recruiting') table='recruiting_contacts';
    if(modal.type==='scholarship') {table='scholarships'; if(obj.amount==='')obj.amount=null;else obj.amount=Number(obj.amount);}
    const {error}=await sb.from(table).insert(obj);
    if(error){ alert(error.message); return; }
    modal=null; await loadAll();
  }
  function bindModal(){
    const form=document.getElementById('modalForm'); if(!form)return;
    document.getElementById('closeModal').onclick=()=>{modal=null;renderApp();};
    document.getElementById('cancelModal').onclick=()=>{modal=null;renderApp();};
    form.onsubmit=e=>{e.preventDefault();saveModal();};
  }
  const oldRenderApp=renderApp;
  renderApp=function(){ oldRenderApp(); bindModal(); };

  boot();
})();
