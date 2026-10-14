'use strict';
const S=require('./schema.cjs');
const {body,send}=require('./http.cjs');
const {pageHTML,CSP}=require('./presentation.cjs');
const {starter,starters}=require('./starters.cjs');
const {briefHistory}=require('./history.cjs');
const {extractSource,cleanName}=require('./inputs.cjs');
const {importTokens}=require('./tokens-import.cjs');
const {normalizeTokens}=require('./kit.cjs');
const MAX_SOURCES=6;
const previews=new Map();
function cachePreview(pid,html,key){
  for(const [id,p]of previews)if(Date.now()-p.created>300000)previews.delete(id);
  while(previews.size>=20||[...previews.values()].reduce((n,p)=>n+p.html.length,0)+html.length>20000000){const first=previews.keys().next().value;if(!first)break;previews.delete(first);}
  previews.set(key,{pid,html,created:Date.now()});
}
function tx(db,fn){db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}
function initializeStudio(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS project_styles(project_id TEXT PRIMARY KEY REFERENCES projects(id),data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS design_kits(id TEXT PRIMARY KEY,name TEXT NOT NULL,data TEXT NOT NULL,updated TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS design_notes(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),revision_id TEXT NOT NULL REFERENCES revisions(id),screen TEXT NOT NULL,target TEXT NOT NULL,text TEXT NOT NULL,resolved INTEGER NOT NULL DEFAULT 0,created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS project_sources(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),name TEXT NOT NULL,kind TEXT NOT NULL,text TEXT NOT NULL,chars INTEGER NOT NULL,summary TEXT NOT NULL,truncated INTEGER NOT NULL DEFAULT 0,created TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS notes_revision ON design_notes(revision_id);
    CREATE INDEX IF NOT EXISTS sources_project ON project_sources(project_id);`);
}
// Stored 0.2 styles only have the legacy fields: return them with the 0.3 tokens filled in.
function projectStyle(db,pid) {
  const row=db.prepare('SELECT data FROM project_styles WHERE project_id=?').get(pid);if(!row)return null;
  const data=JSON.parse(row.data);try{return S.designSystem(data);}catch{return data;}
}
const insertProject=(db,p)=>db.prepare('INSERT INTO projects(id,kind,title,brand,refs,current_id,created,updated) VALUES(?,?,?,?,?,?,?,?)').run(p.id,p.kind,p.title,p.brand,p.refs,p.current_id??null,p.created,p.updated);
const insertStyle=(db,pid,data)=>db.prepare('INSERT INTO project_styles(project_id,data) VALUES(?,?)').run(pid,JSON.stringify(data));
// Source documents: the text feeds prompts.sources(); API responses only ever carry metadata.
function projectSources(db,pid,withText=false) {
  return db.prepare(`SELECT id,name,kind,chars,summary,truncated,created${withText?',text':''} FROM project_sources WHERE project_id=? ORDER BY created,rowid`).all(pid).map(s=>({...s,truncated:!!s.truncated}));
}
function insertSource(db,id,pid,s,created) {
  db.prepare('INSERT INTO project_sources(id,project_id,name,kind,text,chars,summary,truncated,created) VALUES(?,?,?,?,?,?,?,?,?)').run(id,pid,s.name,s.kind,s.text,s.chars??s.text.length,s.summary||'',s.truncated?1:0,created);
}
async function extractOne(f) {
  if(!f||typeof f!=='object'||Array.isArray(f))S.fail('Each source document needs a name and base64 data.');
  try{return await extractSource({name:f.name,data:f.data});}
  catch(e){if(e.status)throw e;S.fail(`Could not read the source document "${cleanName(f.name)}".`);}
}
async function extractSources(list,max=MAX_SOURCES) {
  if(list==null)return [];
  if(!Array.isArray(list)||list.length>max)S.fail(`Source documents must be an array with at most ${max} files.`);
  const out=[];for(const f of list)out.push(await extractOne(f));return out;
}
async function studioRoute(req,res,url,ctx) {
  const {db,id,now,project,revision,assertIdle}=ctx,parts=url.pathname.split('/').filter(Boolean);
  if(url.pathname==='/api/starters'&&req.method==='GET'){send(res,200,starters);return true;}
  if(parts[1]==='starters'&&parts[2]&&req.method==='POST'){
    const a=starter(parts[2]);if(!a)S.fail('Unknown starter.');const pid=id(),rid=id(),date=now();
    tx(db,()=>{
      insertProject(db,{id:pid,kind:'web',title:a.title,brand:'Use the existing design system and preserve the selected flow unless the brief changes it.',refs:'[]',current_id:rid,created:date,updated:date});
      db.prepare('INSERT INTO revisions(id,project_id,artifact,prompt,origin,metrics,created,parent_id) VALUES(?,?,?,?,?,?,?,?)').run(rid,pid,JSON.stringify(a),'Curated UI starter. Sample content only; replace with the user’s brief.','template',JSON.stringify({mode:'template',modelCalls:0,durationSeconds:0,warnings:['Curated starter, not GLM output. Sample content must be adapted and verified for your use.']}),date,null);
      insertStyle(db,pid,a.designSystem);
    });send(res,201,{id:pid});return true;
  }
  if(url.pathname==='/api/design-kits') {
    if(req.method==='GET'){send(res,200,db.prepare('SELECT * FROM design_kits ORDER BY updated DESC').all().map(r=>({...r,data:JSON.parse(r.data)})));return true;}
    if(req.method==='POST'){const input=await body(req,20000),data=S.designSystem(input),key=id();db.prepare('INSERT INTO design_kits(id,name,data,updated) VALUES(?,?,?,?)').run(key,data.name,JSON.stringify(data),now());send(res,201,{id:key});return true;}
  }
  if(url.pathname==='/api/design-tokens/import'&&req.method==='POST') {
    // importTokens enforces the 200 KB text limit; the body limit leaves room for JSON escaping.
    const input=await body(req,1000000),imported=importTokens(input.text);
    send(res,200,{tokens:S.designSystem(normalizeTokens({...imported.tokens,name:'Imported tokens',preset:'custom'})),notes:imported.notes});return true;
  }
  if(parts[1]!=='projects'||!parts[2])return false;
  const action=parts[3];
  if(!['preview-draft','draft','design-system','notes','duplicate','sources'].includes(action))return false;
  const p=project(parts[2]);
  if(action==='draft'&&req.method==='GET'){
    const cached=previews.get(parts[4]);
    if(!cached||cached.pid!==p.id||Date.now()-cached.created>300000){send(res,404,{error:'Draft preview expired. Refresh the design canvas.'});return true;}
    send(res,200,cached.html,'text/html; charset=utf-8',{'Content-Security-Policy':CSP+'; sandbox allow-scripts allow-forms','X-Frame-Options':'SAMEORIGIN'});return true;
  }
  if(action==='preview-draft'&&req.method==='POST') {
    const input=await body(req,1000000),a=S.artifact(input.artifact,p.kind);
    if(!/^[a-f0-9-]{36}$/.test(input.channel||''))S.fail('Invalid preview channel.');
    const screen=typeof input.screen==='string'&&/^[a-zA-Z][\w-]{0,47}$/.test(input.screen)?input.screen:'home';
    const key=id();cachePreview(p.id,pageHTML(a,p.references,null,{channel:input.channel,screen}),key);
    send(res,200,{url:`/api/projects/${p.id}/draft/${key}`,artifact:a});return true;
  }
  if(action==='design-system') {
    if(req.method==='GET'){send(res,200,projectStyle(db,p.id));return true;}
    if(req.method==='POST'){assertIdle(p.id);const data=S.designSystem(await body(req,20000));db.prepare('INSERT INTO project_styles(project_id,data) VALUES(?,?) ON CONFLICT(project_id) DO UPDATE SET data=excluded.data').run(p.id,JSON.stringify(data));send(res,200,data);return true;}
  }
  if(action==='sources') {
    if(req.method==='GET'&&!parts[4]){send(res,200,projectSources(db,p.id));return true;}
    if(req.method==='POST'&&!parts[4]) {
      // One file per request: 15 MB of file data is about 20.5 MB as base64.
      const input=await body(req,23000000);
      if(db.prepare('SELECT COUNT(*) AS n FROM project_sources WHERE project_id=?').get(p.id).n>=MAX_SOURCES)S.fail(`A project can hold at most ${MAX_SOURCES} source documents. Remove one first.`);
      const s=await extractOne(input),key=id();
      tx(db,()=>{
        if(db.prepare('SELECT COUNT(*) AS n FROM project_sources WHERE project_id=?').get(p.id).n>=MAX_SOURCES)S.fail(`A project can hold at most ${MAX_SOURCES} source documents. Remove one first.`);
        insertSource(db,key,p.id,s,now());
      });
      send(res,201,{id:key,name:s.name,kind:s.kind,chars:s.chars,truncated:!!s.truncated,summary:s.summary});return true;
    }
    if(req.method==='DELETE'&&parts[4]) {
      if(!db.prepare('DELETE FROM project_sources WHERE id=? AND project_id=?').run(parts[4],p.id).changes){send(res,404,{error:'Source document not found.'});return true;}
      send(res,200,{ok:true});return true;
    }
  }
  if(action==='notes') {
    if(req.method==='GET'){const rid=url.searchParams.get('revision')||p.current_id;revision(rid,p.id);send(res,200,db.prepare('SELECT * FROM design_notes WHERE project_id=? AND revision_id=? ORDER BY created').all(p.id,rid));return true;}
    if(req.method==='POST') {
      const input=await body(req,20000),r=revision(input.revisionId,p.id),screen=S.str(input.screen,'Screen',48),target=S.str(input.target,'Element',160);
      if(screen && (r.artifact.kind!=='web'||!S.webScreens(r.artifact).some(s=>s.id===screen)))S.fail('Note screen is not in this revision.');
      const key=id();db.prepare('INSERT INTO design_notes(id,project_id,revision_id,screen,target,text,resolved,created) VALUES(?,?,?,?,?,?,?,?)').run(key,p.id,r.id,screen,target,S.str(input.text,'Feedback',4000,true),0,now());send(res,201,{id:key});return true;
    }
    if(req.method==='PATCH'&&parts[4]){const input=await body(req,1000);if(typeof input.resolved!=='boolean')S.fail('Resolved must be true or false.');const result=db.prepare('UPDATE design_notes SET resolved=? WHERE id=? AND project_id=?').run(input.resolved?1:0,parts[4],p.id);if(!result.changes)S.fail('Note not found.');send(res,200,{ok:true});return true;}
  }
  if(action==='duplicate'&&req.method==='POST') {
    const input=await body(req,10000),r=revision(input.revisionId||p.current_id,p.id),pid=id(),rid=id(),date=now();
    const a={...r.artifact,title:S.str(input.title||p.title+' — exploration','Title',140,true)};
    const history=briefHistory(db,p.id,r.id),sourceBriefs=history.briefs.map(b=>b.prompt).join('\n\n');
    tx(db,()=>{
      insertProject(db,{id:pid,kind:p.kind,title:a.title,brand:p.brand,refs:JSON.stringify(p.references),current_id:rid,created:date,updated:date});
      db.prepare('INSERT INTO revisions(id,project_id,artifact,prompt,origin,metrics,created,parent_id) VALUES(?,?,?,?,?,?,?,?)').run(rid,pid,JSON.stringify(a),'Source context carried from the selected revision branch:\n'+sourceBriefs,'copy',JSON.stringify({mode:'copy',modelCalls:0,durationSeconds:0,warnings:['Copied design for exploration. No model was called and previous quality review does not apply.',...(history.omitted?[`${history.omitted} intermediate briefs exceeded the context limit.`]:[])]}),date,null);
      const style=projectStyle(db,p.id);if(style)insertStyle(db,pid,style);
      for(const s of projectSources(db,p.id,true))insertSource(db,id(),pid,s,s.created);
    });
    send(res,201,{id:pid});return true;
  }
  return false;
}
module.exports={initializeStudio,projectStyle,projectSources,insertSource,insertProject,insertStyle,extractSources,studioRoute,tx,MAX_SOURCES};
