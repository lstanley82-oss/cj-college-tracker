(() => {
  const cfg = window.CJ_TRACKER_CONFIG || {};
  const configured = cfg.SUPABASE_URL && cfg.SUPABASE_PUBLISHABLE_KEY && !cfg.SUPABASE_URL.includes('PASTE_');
  const sb = configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY) : null;

  const app = document.getElementById('app');
  const taskStatuses = ['Not Started','In Progress','Waiting','Needs Review','Complete'];
  const documentStatuses = ['Not Started','Drafting','Needs Review','Revising','Final','Submitted'];
  const documentTypes = ['Personal Statement','Supplemental Essay','Coach Letter','Recruiting Email','Athletic Résumé','Activities List','Recommendation Material','Financial Aid','Transcript','Other'];
  const visitStatuses = ['Not Scheduled','Planned','Visited','Virtual Visit'];

  let session = null;
  let member = null;
  let currentView = 'dashboard';
  let modal = null;
  let documentSchoolFilter = 'all';
  let documentStatusFilter = 'all';
  let data = {
    family:[], colleges:[], tasks:[], recruiting:[], scholarships:[],
    comments:[], activity:[], documents:[], documentLinks:[]
  };

  const esc = (v='') => String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));
  const fmt = d => d ? new Date(d+'T12:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) : 'No date';
  const days = d => { if(!d) return 9999; const x=new Date(d+'T12:00:00'); const t=new Date(); t.setHours(12,0,0,0); return Math.ceil((x-t)/86400000); };
  const initials = n => (n||'Family').split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase();
  const money = v => (v === null || v === undefined || v === '') ? '—' : new Intl.NumberFormat(undefined,{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(v)||0);
  const selected = (a,b) => String(a ?? '') === String(b ?? '') ? ' selected' : '';
  const checked = (cond) => cond ? ' checked' : '';
  const pillClass = s => ['Complete','Final','Submitted','Visited'].includes(s)?'green':(['In Progress','Drafting','Revising','Planned'].includes(s)?'blue':(s==='Waiting'?'amber':(s==='Needs Review'?'red':'gray')));
  const safeUrl = u => { try { const x=new URL(u); return ['http:','https:'].includes(x.protocol) ? x.href : ''; } catch { return ''; } };
  const collegeName = id => data.colleges.find(c=>c.id===id)?.name || '';
  const memberName = id => data.family.find(m=>m.user_id===id)?.display_name || 'Family member';
  const commentsForTask = id => data.comments.filter(c=>c.task_id===id).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
  const linksForDocument = id => data.documentLinks.filter(x=>x.document_id===id);
  const documentsForCollege = id => data.documentLinks.filter(x=>x.college_id===id).map(x=>data.documents.find(d=>d.id===x.document_id)).filter(Boolean);

  async function boot(){
    if(!configured){ renderConfigHelp(); return; }
    const {data:{session:s}} = await sb.auth.getSession();
    session=s;
    sb.auth.onAuthStateChange((_e,sess)=>{ session=sess; if(!sess){member=null; renderLogin();} else loadAll(); });
    if(!session) renderLogin(); else await loadAll();
  }

  function renderConfigHelp(){
    app.innerHTML = `<div class="auth-screen"><div class="auth-photo"><div class="auth-brand"><div class="big">CJ's<br>College Tracker</div><div class="small">Black Track Editorial</div></div></div><div class="auth-card-wrap"><div class="auth-card"><div class="kicker">Setup required</div><h1>Connect Supabase</h1><p>Open <strong>config.js</strong> and paste your Supabase Project URL and publishable key. Then refresh this page.</p><div class="error">Never use the secret key in a GitHub Pages app.</div></div></div></div>`;
  }

  function renderLogin(msg=''){
    app.innerHTML = `<div class="auth-screen"><div class="auth-photo"><div class="auth-brand"><div class="big">CJ's<br>College Tracker</div><div class="small">Family Access • Season 2026–27</div></div></div><div class="auth-card-wrap"><form class="auth-card" id="loginForm"><div class="kicker">Family access</div><h1>Sign in</h1><p>Use your family account to enter the shared tracker.</p><div class="field"><label>Email</label><input name="email" type="email" required autocomplete="email"></div><div class="field"><label>Password</label><input name="password" type="password" required autocomplete="current-password"></div>${msg?`<div class="error">${esc(msg)}</div>`:''}<div style="margin-top:16px"><button class="btn red" type="submit">Enter Tracker</button></div></form></div></div>`;
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
    if(me || !m){
      app.innerHTML=`<div class="auth-card-wrap" style="min-height:100vh"><div class="auth-card"><div class="kicker">Access pending</div><h1>Account created</h1><p>This login exists, but it has not been added to the family workspace yet.</p><button class="btn" id="logoutBtn">Sign out</button></div></div>`;
      document.getElementById('logoutBtn').onclick=()=>sb.auth.signOut();
      return;
    }
    member=m;
    const [fm,c,t,r,s,a,cm,d,dl]=await Promise.all([
      sb.from('family_members').select('*').order('display_name'),
      sb.from('colleges').select('*').order('interest_level',{ascending:false}),
      sb.from('tasks').select('*').order('due_date',{ascending:true}),
      sb.from('recruiting_contacts').select('*').order('follow_up_date',{ascending:true}),
      sb.from('scholarships').select('*').order('deadline',{ascending:true}),
      sb.from('activity_log').select('*').order('created_at',{ascending:false}).limit(50),
      sb.from('task_comments').select('*').order('created_at',{ascending:true}),
      sb.from('documents').select('*').order('due_date',{ascending:true}),
      sb.from('document_colleges').select('*')
    ]);
    const failures=[fm,c,t,r,s,a,cm,d,dl].filter(x=>x.error);
    if(failures.length){ console.error('Load errors', failures.map(x=>x.error)); }
    data.family=fm.data||[m];
    data.colleges=c.data||[];
    data.tasks=t.data||[];
    data.recruiting=r.data||[];
    data.scholarships=s.data||[];
    data.activity=a.data||[];
    data.comments=cm.data||[];
    data.documents=d.data||[];
    data.documentLinks=dl.data||[];
    renderApp();
  }

  function renderApp(){
    app.innerHTML=`<div class="app-shell"><aside class="sidebar"><div class="side-inner"><div><div class="brand-script">CJ's</div><div class="brand-title">College Tracker</div><div class="brand-tag">Discipline<br>Opens Doors</div></div>${nav()}<div class="side-foot">Same Work.<br>Bigger Opportunities.<small>Student Athlete • Future Leader</small></div></div></aside><main class="main"><div class="topbar"><div class="search"><input id="searchInput" placeholder="Search colleges, tasks, recruiting, or documents..."></div><div class="account"><button class="btn small" id="addTaskTop">+ Task</button><div class="avatar">${initials(member.display_name)}</div><div><div><strong>${esc(member.display_name)}</strong></div><div class="sub">Family editor</div></div><button class="btn small" id="logout">Sign out</button></div></div><div id="viewRoot"></div></main></div>${modal?renderModal():''}`;
    bind(); renderView(); bindModal();
  }

  function nav(){
    const items=[
      ['dashboard','⌂','Command Center'],['tasks','◎','Next Moves'],['colleges','▦','Colleges'],
      ['recruiting','◉','Recruiting'],['scholarships','◆','Scholarships'],['documents','▤','Documents'],['financials','▥','Financials']
    ];
    return `<nav class="nav">${items.map(([v,i,l])=>`<button data-view="${v}" class="${currentView===v?'active':''}"><span class="ico">${i}</span>${l}</button>`).join('')}</nav>`;
  }

  function bind(){
    document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{ currentView=b.dataset.view; renderApp(); });
    document.getElementById('logout').onclick=()=>sb.auth.signOut();
    document.getElementById('addTaskTop').onclick=()=>openModal('task');
    const search=document.getElementById('searchInput');
    if(search){
      search.onkeydown=e=>{
        if(e.key==='Enter'){
          const q=search.value.trim().toLowerCase();
          if(!q) return;
          const college=data.colleges.find(c=>c.name.toLowerCase().includes(q));
          const task=data.tasks.find(t=>t.title.toLowerCase().includes(q));
          const doc=data.documents.find(d=>d.title.toLowerCase().includes(q));
          if(college){ currentView='colleges'; renderApp(); }
          else if(task){ currentView='tasks'; renderApp(); }
          else if(doc){ currentView='documents'; renderApp(); }
        }
      };
    }
  }

  function renderView(){
    const root=document.getElementById('viewRoot');
    if(currentView==='dashboard') root.innerHTML=dashboard();
    if(currentView==='tasks') root.innerHTML=tasksPage();
    if(currentView==='colleges') root.innerHTML=collegesPage();
    if(currentView==='recruiting') root.innerHTML=recruitingPage();
    if(currentView==='scholarships') root.innerHTML=scholarshipsPage();
    if(currentView==='documents') root.innerHTML=documentsPage();
    if(currentView==='financials') root.innerHTML=financialsPage();
    bindView();
  }

  function dashboard(){
    const open=data.tasks.filter(t=>t.status!=='Complete');
    const dueWeek=open.filter(t=>days(t.due_date)>=0&&days(t.due_date)<=7).length;
    const activeDocs=data.documents.filter(d=>!['Final','Submitted'].includes(d.status)).length;
    return `<section class="watermark-page" data-watermark="Lane 01"><div class="hero"><div class="hero-photo"><div class="caption"><small>Student athlete • future leader</small>Discipline today.<br>Opportunity tomorrow.</div></div><div class="hero-copy"><div class="kicker">CJ's College Tracker</div><h1>Family<br>Command Center</h1><div class="meta">Lane 01 &nbsp;//&nbsp; Season 2026–27</div><div class="quote">Preparation today.<br>Opportunities tomorrow.</div></div></div><div class="metrics">${metric(open.length,'Open Tasks','Across the process')}${metric(dueWeek,'Due This Week',dueWeek?'Action needed':'Clear')}${metric(data.colleges.length,'Active Colleges','Applications + fit')}${metric(data.recruiting.length,'Coaches Contacted','Recruiting pipeline')}${metric(data.scholarships.filter(x=>x.status!=='Complete').length,'Scholarships Open','Current pipeline')}${metric(activeDocs,'Documents Active','Writing + review')}</div><div class="grid3"><div class="panel">${taskTable(open.slice().sort(taskSort).slice(0,8))}</div><div class="panel">${recruitTable(data.recruiting.slice(0,6))}</div><div class="panel motivation"><div class="copy">Discipline<br>Today<br><span>Opportunities</span><br><span>Tomorrow</span></div></div></div><div class="grid2"><div class="panel">${collegeTable(data.colleges.slice(0,6))}</div><div class="panel">${documentTable(data.documents.slice(0,6), true)}</div></div></section>`;
  }

  const metric=(n,l,s)=>`<div class="metric"><div class="n">${esc(n)}</div><div class="l">${esc(l)}</div><div class="s">${esc(s)}</div></div>`;
  const head=t=>`<div class="panel-head"><div class="panel-title"><span class="accent">●</span>${esc(t)}</div><div class="panel-link">Live data</div></div>`;
  function taskSort(a,b){ const da=a.due_date||'9999-12-31', db=b.due_date||'9999-12-31'; return da.localeCompare(db); }

  function taskTable(rows){
    return `${head("CJ's Next Moves")}<div class="table-wrap"><table><thead><tr><th>Task</th><th>Owner</th><th>Due</th><th>Status</th><th>Notes</th><th></th></tr></thead><tbody>${rows.length?rows.map(t=>`<tr><td><button class="text-link" data-edit="task" data-id="${t.id}">${esc(t.title)}</button></td><td><span class="owner ${t.owner_name==='CJ'?'cj':''}">${esc(t.owner_name||'Unassigned')}</span></td><td>${fmt(t.due_date)}</td><td><select class="status-quick ${pillClass(t.status)}" data-task-status="${t.id}">${taskStatuses.map(s=>`<option${selected(s,t.status)}>${esc(s)}</option>`).join('')}</select></td><td>${commentsForTask(t.id).length?`<button class="comment-count" data-edit="task" data-id="${t.id}">${commentsForTask(t.id).length} comment${commentsForTask(t.id).length===1?'':'s'}</button>`:'—'}</td><td><button class="btn tiny" data-edit="task" data-id="${t.id}">Edit</button></td></tr>`).join(''):`<tr><td colspan="6" class="empty">No tasks yet.</td></tr>`}</tbody></table></div>`;
  }

  function recruitTable(rows){
    return `${head('Recruiting')}<div class="table-wrap"><table><thead><tr><th>Coach / School</th><th>Last Contact</th><th>Follow Up</th><th>Status</th><th></th></tr></thead><tbody>${rows.length?rows.map(r=>`<tr><td><strong>${esc(r.coach_name)}</strong><br><span style="color:var(--muted)">${esc(r.school_name||collegeName(r.college_id)||'')}</span></td><td>${fmt(r.last_contact_date)}</td><td>${fmt(r.follow_up_date)}</td><td><span class="pill ${pillClass(r.status)}">${esc(r.status||'Active')}</span></td><td><button class="btn tiny" data-edit="recruiting" data-id="${r.id}">Edit</button></td></tr>`).join(''):`<tr><td colspan="5" class="empty">No recruiting contacts yet.</td></tr>`}</tbody></table></div>`;
  }

  function collegeTable(rows){
    return `${head('Colleges')}<div class="table-wrap"><table><thead><tr><th>School</th><th>Deadline</th><th>Visit</th><th>Application</th><th>Documents</th><th></th></tr></thead><tbody>${rows.length?rows.map(c=>{const docs=documentsForCollege(c.id);return `<tr><td><button class="text-link" data-edit="college" data-id="${c.id}">${esc(c.name)}</button></td><td>${fmt(c.application_deadline)}</td><td>${esc(c.visit_status||'Not Scheduled')}</td><td><span class="pill ${pillClass(c.application_status)}">${esc(c.application_status||'Not Started')}</span></td><td><button class="doc-count" data-docschool="${c.id}">${docs.length} doc${docs.length===1?'':'s'}</button></td><td><button class="btn tiny" data-edit="college" data-id="${c.id}">Edit</button></td></tr>`}).join(''):`<tr><td colspan="6" class="empty">No colleges yet.</td></tr>`}</tbody></table></div>`;
  }

  function scholarTable(rows){
    return `${head('Scholarships')}<div class="table-wrap"><table><thead><tr><th>Scholarship</th><th>Amount</th><th>Deadline</th><th>Status</th><th></th></tr></thead><tbody>${rows.length?rows.map(s=>`<tr><td>${esc(s.name)}</td><td>${money(s.amount)}</td><td>${fmt(s.deadline)}</td><td><span class="pill ${pillClass(s.status)}">${esc(s.status||'Not Started')}</span></td><td><button class="btn tiny" data-edit="scholarship" data-id="${s.id}">Edit</button></td></tr>`).join(''):`<tr><td colspan="5" class="empty">No scholarships yet.</td></tr>`}</tbody></table></div>`;
  }

  function documentTable(rows, compact=false){
    return `${head(compact?'Documents':'Documents & Writing')}<div class="table-wrap"><table><thead><tr><th>Document</th><th>Schools</th><th>Owner</th><th>Due</th><th>Status</th><th>Link</th><th></th></tr></thead><tbody>${rows.length?rows.map(d=>{const schools=linksForDocument(d.id).map(x=>collegeName(x.college_id)).filter(Boolean);const url=safeUrl(d.url);return `<tr><td><strong>${esc(d.title)}</strong><br><span class="subtext">${esc(d.document_type||'Other')}</span></td><td>${schools.length?schools.map(s=>`<span class="school-chip">${esc(s)}</span>`).join(' '):'<span class="subtext">General</span>'}</td><td><span class="owner ${d.owner_name==='CJ'?'cj':''}">${esc(d.owner_name||'Unassigned')}</span></td><td>${fmt(d.due_date)}</td><td><span class="pill ${pillClass(d.status)}">${esc(d.status||'Not Started')}</span></td><td>${url?`<a class="btn tiny" href="${esc(url)}" target="_blank" rel="noopener">Open</a>`:'—'}</td><td><button class="btn tiny" data-edit="document" data-id="${d.id}">Edit</button></td></tr>`}).join(''):`<tr><td colspan="7" class="empty">No documents yet.</td></tr>`}</tbody></table></div>`;
  }

  function pageShell(title,desc,watermark,buttonLabel,modalType,content){
    return `<section class="watermark-page" data-watermark="${esc(watermark)}"><div class="page-head"><div><div class="kicker">Black Track Editorial</div><h2>${esc(title)}</h2><p>${esc(desc)}</p></div>${buttonLabel?`<button class="btn red" data-open="${modalType}">${esc(buttonLabel)}</button>`:''}</div>${content}</section>`;
  }

  function tasksPage(){
    const complete=data.tasks.filter(t=>t.status==='Complete').length;
    const open=data.tasks.length-complete;
    const content=`<div class="mini-stats"><div><strong>${open}</strong><span>Open</span></div><div><strong>${complete}</strong><span>Complete</span></div><div><strong>${data.tasks.filter(t=>t.status==='Waiting').length}</strong><span>Waiting</span></div><div><strong>${data.comments.length}</strong><span>Comments</span></div></div><div class="panel">${taskTable(data.tasks.slice().sort(taskSort))}</div>`;
    return pageShell('Next Moves','Edit ownership, due dates, notes, comments, and status as work moves through the process.','Next Moves','+ Add task','task',content);
  }

  function collegesPage(){
    return pageShell('Colleges','CJ’s active college list, deadlines, visits, majors, cost, application status, and linked documents.','Colleges','+ Add college','college',`<div class="panel">${collegeTable(data.colleges)}</div>`);
  }

  function recruitingPage(){
    return pageShell('Recruiting','Coach outreach, recruiting questionnaires, roster research, benchmarks, and follow-up dates.','Recruiting','+ Add recruiting contact','recruiting',`<div class="panel">${recruitTable(data.recruiting)}</div>`);
  }

  function scholarshipsPage(){
    return pageShell('Scholarships','A separate pipeline for institutional and outside scholarship opportunities.','Scholarships','+ Add scholarship','scholarship',`<div class="panel">${scholarTable(data.scholarships)}</div>`);
  }

  function documentsPage(){
    let rows=data.documents.slice();
    if(documentSchoolFilter!=='all') rows=rows.filter(d=>linksForDocument(d.id).some(x=>x.college_id===documentSchoolFilter));
    if(documentStatusFilter!=='all') rows=rows.filter(d=>d.status===documentStatusFilter);
    const toolbar=`<div class="filterbar"><div class="field"><label>School</label><select id="documentSchoolFilter"><option value="all">All schools</option>${data.colleges.map(c=>`<option value="${c.id}"${selected(c.id,documentSchoolFilter)}>${esc(c.name)}</option>`).join('')}</select></div><div class="field"><label>Status</label><select id="documentStatusFilter"><option value="all">All statuses</option>${documentStatuses.map(s=>`<option${selected(s,documentStatusFilter)}>${esc(s)}</option>`).join('')}</select></div><div class="filter-summary">${rows.length} document${rows.length===1?'':'s'} shown</div></div>`;
    return pageShell('Documents','Working links for essays, coach letters, résumés, recommendations, and other materials. One document can be linked to several colleges.','Documents','+ Add document','document',`${toolbar}<div class="panel">${documentTable(rows)}</div>`);
  }

  function financialsPage(){
    const rows=data.colleges.filter(c=>c.annual_cost||c.estimated_aid||c.scholarship_amount);
    const content=`<div class="panel">${head('Net Cost Comparison')}<div class="table-wrap"><table><thead><tr><th>College</th><th>Annual Cost</th><th>Scholarships</th><th>Estimated Aid</th><th>Estimated Net</th><th></th></tr></thead><tbody>${rows.length?rows.map(c=>{const net=(Number(c.annual_cost)||0)-(Number(c.scholarship_amount)||0)-(Number(c.estimated_aid)||0);return `<tr><td>${esc(c.name)}</td><td>${money(c.annual_cost)}</td><td>${money(c.scholarship_amount)}</td><td>${money(c.estimated_aid)}</td><td><strong>${money(Math.max(net,0))}</strong></td><td><button class="btn tiny" data-edit="college" data-id="${c.id}">Edit</button></td></tr>`}).join(''):`<tr><td colspan="6" class="empty">Add cost and aid values to college records to compare them here.</td></tr>`}</tbody></table></div></div>`;
    return pageShell('Financials','Compare sticker price, scholarships, estimated aid, and likely family cost.','Costs','+ Add / edit college','college',content);
  }

  function openModal(type,id=null){ modal={type,id}; renderApp(); }

  function bindView(){
    document.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>openModal(b.dataset.open));
    document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openModal(b.dataset.edit,b.dataset.id));
    document.querySelectorAll('[data-docschool]').forEach(b=>b.onclick=()=>{ documentSchoolFilter=b.dataset.docschool; documentStatusFilter='all'; currentView='documents'; renderApp(); });
    document.querySelectorAll('[data-task-status]').forEach(s=>s.onchange=()=>quickTaskStatus(s.dataset.taskStatus,s.value));
    const sf=document.getElementById('documentSchoolFilter'); if(sf) sf.onchange=()=>{documentSchoolFilter=sf.value;renderView();};
    const st=document.getElementById('documentStatusFilter'); if(st) st.onchange=()=>{documentStatusFilter=st.value;renderView();};
  }

  function getRecord(type,id){
    if(!id) return null;
    if(type==='task') return data.tasks.find(x=>x.id===id)||null;
    if(type==='college') return data.colleges.find(x=>x.id===id)||null;
    if(type==='recruiting') return data.recruiting.find(x=>x.id===id)||null;
    if(type==='scholarship') return data.scholarships.find(x=>x.id===id)||null;
    if(type==='document') return data.documents.find(x=>x.id===id)||null;
    return null;
  }

  function renderModal(){
    const t=modal.type;
    const record=getRecord(t,modal.id);
    const label={task:'Task',college:'College',recruiting:'Recruiting Contact',scholarship:'Scholarship',document:'Document'}[t]||'Item';
    const title=`${record?'Edit':'Add'} ${label}`;
    const comments=(t==='task'&&record)?taskCommentsBlock(record.id):'';
    return `<div class="modal-bg"><form class="modal" id="modalForm"><div class="modal-head"><div><div class="kicker">${record?'Update live record':'Create new record'}</div><strong>${esc(title)}</strong></div><button class="btn small" type="button" id="closeModal">Close</button></div><div class="modal-body">${formFields(t,record)}${comments}</div><div class="modal-foot">${record?`<button class="btn danger" type="button" id="deleteRecord">Delete</button>`:''}<div class="modal-spacer"></div><button class="btn" type="button" id="cancelModal">Cancel</button><button class="btn red" type="submit">${record?'Save Changes':'Save'}</button></div></form></div>`;
  }

  function memberOptions(current,blank=false){
    const names=data.family.map(x=>x.display_name).filter(Boolean);
    const unique=[...new Set(names)];
    return `${blank?'<option value="">None</option>':''}${unique.map(n=>`<option${selected(n,current)}>${esc(n)}</option>`).join('')}`;
  }

  function collegeOptions(current,blank=true){
    return `${blank?'<option value="">No linked college</option>':''}${data.colleges.map(c=>`<option value="${c.id}"${selected(c.id,current)}>${esc(c.name)}</option>`).join('')}`;
  }

  function formFields(t,r={}){
    r=r||{};
    if(t==='task') return `<div class="form-grid"><div class="field span2"><label>Task</label><input name="title" value="${esc(r.title||'')}" required></div><div class="field"><label>Owner</label><select name="owner_name">${memberOptions(r.owner_name||'CJ')}</select></div><div class="field"><label>Status</label><select name="status">${taskStatuses.map(s=>`<option${selected(s,r.status||'Not Started')}>${esc(s)}</option>`).join('')}</select></div><div class="field"><label>Due Date</label><input name="due_date" type="date" value="${esc(r.due_date||'')}"></div><div class="field"><label>Priority</label><select name="priority">${['High','Medium','Low'].map(p=>`<option${selected(p,r.priority||'Medium')}>${p}</option>`).join('')}</select></div><div class="field"><label>Category</label><input name="category" value="${esc(r.category||'')}" placeholder="Application, Recruiting..."></div><div class="field"><label>Related college</label><select name="college_id">${collegeOptions(r.college_id)}</select></div><div class="field span2"><label>Notes</label><textarea name="notes">${esc(r.notes||'')}</textarea></div></div>`;

    if(t==='college') {
      const docs=r.id?documentsForCollege(r.id):[];
      return `<div class="form-grid"><div class="field span2"><label>College</label><input name="name" value="${esc(r.name||'')}" required></div><div class="field"><label>Interest level (1-5)</label><input name="interest_level" type="number" min="1" max="5" value="${esc(r.interest_level||3)}"></div><div class="field"><label>Application deadline</label><input name="application_deadline" type="date" value="${esc(r.application_deadline||'')}"></div><div class="field"><label>Intended major</label><input name="intended_major" value="${esc(r.intended_major||'')}"></div><div class="field"><label>Location</label><input name="location" value="${esc(r.location||'')}"></div><div class="field"><label>Annual cost</label><input name="annual_cost" type="number" value="${esc(r.annual_cost??'')}"></div><div class="field"><label>Scholarship amount</label><input name="scholarship_amount" type="number" value="${esc(r.scholarship_amount??'')}"></div><div class="field"><label>Estimated aid</label><input name="estimated_aid" type="number" value="${esc(r.estimated_aid??'')}"></div><div class="field"><label>Application status</label><select name="application_status">${taskStatuses.map(s=>`<option${selected(s,r.application_status||'Not Started')}>${s}</option>`).join('')}</select></div><div class="field"><label>Visit status</label><select name="visit_status">${visitStatuses.map(s=>`<option${selected(s,r.visit_status||'Not Scheduled')}>${s}</option>`).join('')}</select></div><div class="field"><label>Application portal</label><input name="portal_url" type="url" value="${esc(r.portal_url||'')}"></div><div class="field"><label>Admissions URL</label><input name="admissions_url" type="url" value="${esc(r.admissions_url||'')}"></div><div class="field span2"><label>Notes</label><textarea name="notes">${esc(r.notes||'')}</textarea></div>${r.id?`<div class="field span2"><label>Linked documents</label><div class="linked-docs">${docs.length?docs.map(d=>`<span class="school-chip">${esc(d.title)}</span>`).join(' '):'<span class="subtext">No documents linked yet.</span>'}</div></div>`:''}</div>`;
    }

    if(t==='recruiting') return `<div class="form-grid"><div class="field"><label>Coach name</label><input name="coach_name" value="${esc(r.coach_name||'')}" required></div><div class="field"><label>School</label><input name="school_name" value="${esc(r.school_name||'')}"></div><div class="field"><label>Linked college</label><select name="college_id">${collegeOptions(r.college_id)}</select></div><div class="field"><label>Status</label><input name="status" value="${esc(r.status||'Active')}"></div><div class="field"><label>Email</label><input name="email" type="email" value="${esc(r.email||'')}"></div><div class="field"><label>Phone</label><input name="phone" value="${esc(r.phone||'')}"></div><div class="field"><label>Last contact</label><input name="last_contact_date" type="date" value="${esc(r.last_contact_date||'')}"></div><div class="field"><label>Follow up</label><input name="follow_up_date" type="date" value="${esc(r.follow_up_date||'')}"></div><div class="field span2"><label>Questionnaire URL</label><input name="questionnaire_url" type="url" value="${esc(r.questionnaire_url||'')}"></div><div class="field span2"><label>Roster URL</label><input name="roster_url" type="url" value="${esc(r.roster_url||'')}"></div><div class="field"><label>CJ benchmarks</label><textarea name="cj_benchmarks">${esc(r.cj_benchmarks||'')}</textarea></div><div class="field"><label>Program benchmarks</label><textarea name="program_benchmarks">${esc(r.program_benchmarks||'')}</textarea></div><div class="field span2"><label>Roster research / notes</label><textarea name="notes">${esc(r.notes||'')}</textarea></div></div>`;

    if(t==='scholarship') return `<div class="form-grid"><div class="field span2"><label>Scholarship</label><input name="name" value="${esc(r.name||'')}" required></div><div class="field"><label>Amount</label><input name="amount" type="number" value="${esc(r.amount??'')}"></div><div class="field"><label>Deadline</label><input name="deadline" type="date" value="${esc(r.deadline||'')}"></div><div class="field"><label>Owner</label><select name="owner_name">${memberOptions(r.owner_name||'CJ')}</select></div><div class="field"><label>Status</label><select name="status">${taskStatuses.map(s=>`<option${selected(s,r.status||'Not Started')}>${s}</option>`).join('')}</select></div><div class="field"><label>Related college</label><select name="college_id">${collegeOptions(r.college_id)}</select></div><div class="field"><label>URL</label><input name="url" type="url" value="${esc(r.url||'')}"></div><div class="field span2"><label>Eligibility</label><textarea name="eligibility">${esc(r.eligibility||'')}</textarea></div><div class="field span2"><label>Requirements</label><textarea name="requirements">${esc(r.requirements||'')}</textarea></div><div class="field span2"><label>Notes</label><textarea name="notes">${esc(r.notes||'')}</textarea></div></div>`;

    if(t==='document') {
      const linked=new Set(r.id?linksForDocument(r.id).map(x=>x.college_id):[]);
      return `<div class="form-grid"><div class="field span2"><label>Document title</label><input name="title" value="${esc(r.title||'')}" required></div><div class="field"><label>Type</label><select name="document_type">${documentTypes.map(s=>`<option${selected(s,r.document_type||'Other')}>${esc(s)}</option>`).join('')}</select></div><div class="field"><label>Status</label><select name="status">${documentStatuses.map(s=>`<option${selected(s,r.status||'Not Started')}>${esc(s)}</option>`).join('')}</select></div><div class="field"><label>Owner</label><select name="owner_name">${memberOptions(r.owner_name||'CJ')}</select></div><div class="field"><label>Reviewer</label><select name="reviewer_name">${memberOptions(r.reviewer_name||'',true)}</select></div><div class="field"><label>Due date</label><input name="due_date" type="date" value="${esc(r.due_date||'')}"></div><div class="field"><label>Google Doc / Drive link</label><input name="url" type="url" value="${esc(r.url||'')}" placeholder="https://..."></div><div class="field span2"><label>Linked colleges</label><div class="college-check-grid">${data.colleges.length?data.colleges.map(c=>`<label class="check-card"><input type="checkbox" name="college_ids" value="${c.id}"${checked(linked.has(c.id))}><span>${esc(c.name)}</span></label>`).join(''):'<span class="subtext">Add colleges first, or save this as a general document.</span>'}</div></div><div class="field span2"><label>Notes</label><textarea name="notes">${esc(r.notes||'')}</textarea></div></div>`;
    }
    return '';
  }

  function taskCommentsBlock(taskId){
    const comments=commentsForTask(taskId);
    return `<div class="comments-block"><div class="comments-head"><strong>Task comments</strong><span>${comments.length}</span></div><div class="comment-list">${comments.length?comments.map(c=>`<div class="comment"><div class="comment-meta">${esc(memberName(c.author_id))} • ${new Date(c.created_at).toLocaleString()}</div><div>${esc(c.body)}</div></div>`).join(''):'<div class="subtext">No comments yet.</div>'}</div><div class="comment-add"><textarea id="newComment" placeholder="Add a note for the family..."></textarea><button class="btn" type="button" id="addComment">Add comment</button></div></div>`;
  }

  function cleanObject(obj){
    Object.keys(obj).forEach(k=>{ if(obj[k]==='') obj[k]=null; });
    return obj;
  }

  async function saveModal(){
    const form=document.getElementById('modalForm');
    const fd=new FormData(form);
    const obj=Object.fromEntries(fd.entries());
    const isEdit=Boolean(modal.id);
    const type=modal.type;
    let table='';
    let documentCollegeIds=[];

    if(type==='document') documentCollegeIds=fd.getAll('college_ids');
    delete obj.college_ids;

    if(type==='task') table='tasks';
    if(type==='college') { table='colleges'; ['interest_level','annual_cost','scholarship_amount','estimated_aid'].forEach(k=>{if(obj[k]==='')obj[k]=null;else obj[k]=Number(obj[k]);}); }
    if(type==='recruiting') table='recruiting_contacts';
    if(type==='scholarship') { table='scholarships'; if(obj.amount==='')obj.amount=null;else obj.amount=Number(obj.amount); }
    if(type==='document') table='documents';

    cleanObject(obj);
    obj.updated_by=session.user.id;
    if(!isEdit) obj.created_by=session.user.id;

    let id=modal.id;
    let error=null;
    if(isEdit){
      ({error}=await sb.from(table).update(obj).eq('id',modal.id));
    } else {
      const result=await sb.from(table).insert(obj).select('id').single();
      error=result.error;
      id=result.data?.id;
    }
    if(error){ alert(error.message); return; }

    if(type==='document' && id){
      const del=await sb.from('document_colleges').delete().eq('document_id',id);
      if(del.error){ alert(del.error.message); return; }
      if(documentCollegeIds.length){
        const links=documentCollegeIds.map(college_id=>({document_id:id,college_id}));
        const ins=await sb.from('document_colleges').insert(links);
        if(ins.error){ alert(ins.error.message); return; }
      }
    }

    await logActivity(isEdit?`Updated ${type}`:`Added ${type}`, getDisplayDetail(type,obj));
    modal=null;
    await loadAll();
  }

  function getDisplayDetail(type,obj){
    if(type==='task') return obj.title||'';
    if(type==='college') return obj.name||'';
    if(type==='recruiting') return `${obj.coach_name||''}${obj.school_name?` • ${obj.school_name}`:''}`;
    if(type==='scholarship') return obj.name||'';
    if(type==='document') return obj.title||'';
    return '';
  }

  async function quickTaskStatus(id,status){
    const task=data.tasks.find(t=>t.id===id);
    const {error}=await sb.from('tasks').update({status,updated_by:session.user.id}).eq('id',id);
    if(error){ alert(error.message); return; }
    await logActivity('Updated task status', `${task?.title||'Task'} → ${status}`);
    await loadAll();
    toast(`Task moved to ${status}`);
  }

  async function addComment(taskId){
    const box=document.getElementById('newComment');
    const body=box?.value.trim();
    if(!body) return;
    const {error}=await sb.from('task_comments').insert({task_id:taskId,body,author_id:session.user.id});
    if(error){ alert(error.message); return; }
    const task=data.tasks.find(t=>t.id===taskId);
    await logActivity('Commented on task', task?.title||'Task');
    await loadAll();
  }

  async function deleteRecord(){
    if(!modal?.id) return;
    const type=modal.type;
    const record=getRecord(type,modal.id);
    const label=getDisplayDetail(type,record||{});
    if(!window.confirm(`Delete ${label || type}? This cannot be undone.`)) return;
    const table={task:'tasks',college:'colleges',recruiting:'recruiting_contacts',scholarship:'scholarships',document:'documents'}[type];
    const {error}=await sb.from(table).delete().eq('id',modal.id);
    if(error){ alert(error.message); return; }
    await logActivity(`Deleted ${type}`,label);
    modal=null;
    await loadAll();
  }

  async function logActivity(action,detail){
    try { await sb.from('activity_log').insert({user_id:session.user.id,action,detail}); } catch(e) { console.warn(e); }
  }

  function bindModal(){
    const form=document.getElementById('modalForm');
    if(!form) return;
    document.getElementById('closeModal').onclick=()=>{modal=null;renderApp();};
    document.getElementById('cancelModal').onclick=()=>{modal=null;renderApp();};
    const del=document.getElementById('deleteRecord'); if(del) del.onclick=deleteRecord;
    const add=document.getElementById('addComment'); if(add) add.onclick=()=>addComment(modal.id);
    form.onsubmit=e=>{e.preventDefault();saveModal();};
  }

  function toast(message){
    const old=document.querySelector('.toast'); if(old) old.remove();
    const el=document.createElement('div'); el.className='toast'; el.textContent=message; document.body.appendChild(el);
    setTimeout(()=>el.remove(),2200);
  }

  boot();
})();
