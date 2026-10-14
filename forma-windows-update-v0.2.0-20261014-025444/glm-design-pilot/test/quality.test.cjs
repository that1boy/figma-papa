'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const JSZip = require('jszip');
const { initializeHistory, briefHistory } = require('../lib/history.cjs');
const { start, stop, client, waitJob } = require('./helpers.cjs');
const { artifact } = require('../lib/schema.cjs');
const { exportPPTX, exportDOCX } = require('../lib/exports.cjs');
const { generate, configFromEnv } = require('../lib/model.cjs');

test('old revision history migrates without changing content and follows restores, not abandoned branches', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE revisions(id TEXT PRIMARY KEY,project_id TEXT,prompt TEXT,origin TEXT,artifact TEXT); CREATE TABLE jobs(result_id TEXT,project_id TEXT,base_id TEXT)');
    const insert = db.prepare('INSERT INTO revisions VALUES(?,?,?,?,?)');
    insert.run('a','p','Original brief: blue.','glm','{"title":"Original"}');
    insert.run('b','p','Change accent to green.','glm','{"title":"Original","blocks":[{"text":"Unconfirmed generated claim"},{"text":"Old owner"}]}');
    db.prepare('INSERT INTO jobs VALUES(?,?,?)').run('b','p','a');
    insert.run('c','p','Manual edit','manual','{"title":"Manual","blocks":[{"text":"Unconfirmed generated claim"},{"text":"New owner"}]}');
    insert.run('d','p','Restored revision a','restore','restored bytes');
    insert.run('e','q','Unrelated project','glm','other bytes');
    initializeHistory(db);
    initializeHistory(db);
    const manualHistory = briefHistory(db,'p','c').briefs.map(b => b.prompt);
    assert.deepEqual(manualHistory.slice(0,2), ['Original brief: blue.','Change accent to green.']);
    assert.match(manualHistory[2], /"field":"title","value":"Manual"/);
    assert.match(manualHistory[2], /blocks\[1\]\.text/);
    assert.doesNotMatch(manualHistory[2], /Unconfirmed generated claim/);
    assert.deepEqual(briefHistory(db,'p','d').briefs.map(b => b.prompt), ['Original brief: blue.']);
    assert.equal(briefHistory(db,'q','d').briefs.length, 0);
    assert.equal(db.prepare('SELECT artifact FROM revisions WHERE id=?').get('a').artifact, '{"title":"Original"}');
    const limited = briefHistory(db,'p','c',22);
    assert.equal(limited.briefs[0].prompt,'Original brief: blue.');
    assert.equal(limited.omitted,2);
  } finally { db.close(); }
});

test('content review works without a renderer and carries original facts across revisions and restores', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'forma-quality-'));
  const calls = [];
  let app, correcting = false;
  const specimen = () => artifact({ kind:'document', title:'Fictional access procedure', theme:{accent:'#275DAD',background:'#ffffff',text:'#202333'}, blocks:[
    {type:'heading',text:'Verification'},
    {type:'paragraph',text:correcting ? 'Check the assigned role. Failure handling is unspecified.' : 'Check the assigned role. Contact Service Desk if the role is incorrect.'},
  ]});
  const mock = http.createServer(async (req,res) => {
    let raw=''; for await (const chunk of req) raw += chunk;
    const input=JSON.parse(raw); calls.push(input);
    const reviewing=input.messages[0].content.startsWith('You check artifacts');
    const output=reviewing ? {issues:['The source leaves failure handling unspecified; remove the invented Service Desk instruction.'],summary:'Unsupported failure-handling instruction.'} : specimen();
    if (reviewing) correcting=true;
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}]}));
  });
  await new Promise(r=>mock.listen(0,'127.0.0.1',r));
  t.after(async()=>{ await stop(app); mock.closeAllConnections(); await new Promise(r=>mock.close(r)); await fs.rm(dir,{recursive:true,force:true}); });
  app=await start('server.cjs',{APP_PASSWORD:'test-pilot-password',MODEL_MODE:'glm',DATA_DIR:dir,RENDER_URL:'',GLM_BASE_URL:`http://127.0.0.1:${mock.address().port}/v1`});
  const api=await client(app.url);
  const p=(await api('/projects','POST',{kind:'document',title:'Source continuity'})).data;
  const run=async(prompt,review)=>{
    const j=(await api(`/projects/${p.id}/generate`,'POST',{prompt,review})).data;
    const done=await waitJob(api,j.id); assert.equal(done.status,'complete',done.error);
    return (await api('/projects/'+p.id)).data.current;
  };
  const first=await run('Use blue #275DAD. Failure handling is unspecified. Editor expiry is 30 days.',false);
  const revised=await run('Change Editor expiry to 14 days.',true);
  assert.equal(calls.length,4);
  assert.match(calls[1].messages[1].content[0].text,/Failure handling is unspecified/);
  assert.match(calls[2].messages[1].content[0].text,/Artifact before this user request/);
  assert.match(calls[3].messages[1].content[0].text,/#275DAD/);
  assert.match(revised.artifact.blocks[1].text,/Failure handling is unspecified/);
  assert.equal(revised.metrics.review.scope,'content-only');
  assert.equal(revised.metrics.review.pagesReviewed,0);
  assert.equal(revised.metrics.review.refined,true);
  assert.equal(revised.metrics.render,null);
  assert.ok(revised.metrics.warnings.some(w=>w.includes('Rendering unavailable')));
  const manual=structuredClone(revised.artifact); manual.title='User edited title';
  await api(`/projects/${p.id}/save`,'POST',{baseId:revised.id,artifact:manual});
  await run('Make headings concise.',false);
  assert.match(calls.at(-1).messages[1].content[0].text,/Change Editor expiry to 14 days/);
  assert.match(calls.at(-1).messages[1].content[0].text,/User edited title/);
  await api(`/projects/${p.id}/restore`,'POST',{revisionId:first.id});
  await run('Keep the original expiry and shorten the title.',false);
  assert.doesNotMatch(calls.at(-1).messages[1].content[0].text,/Change Editor expiry to 14 days|Make headings concise/);
  assert.match(calls.at(-1).messages[1].content[0].text,/Editor expiry is 30 days/);
});

test('table slide export keeps explanatory content, source colors and all table cells', async () => {
  const a=artifact({kind:'slides',title:'Options',theme:{accent:'#275DAD',background:'#ffffff',text:'#202333'},slides:[{layout:'table',title:'Recommendation',subtitle:'A constrained comparison',body:'The lower-cost qualifying option saves USD 6,000 annually.',bullets:['Support terms remain unspecified.'],table:{headers:['Option','Cost'],rows:[['A','24,000'],['B','30,000']]}}]});
  const zip=await JSZip.loadAsync(await exportPPTX(a));
  const xml=await zip.file('ppt/slides/slide1.xml').async('string');
  for(const text of ['6,000','Support terms remain unspecified.','24,000','30,000','275DAD']) assert.ok(xml.includes(text));
  assert.match(xml,/<a:tbl>/);
  assert.match(xml,/<p:bg>[\s\S]*?FFFFFF/);
});

test('revision output inherits omitted theme fields and permits explicit theme changes', async (t) => {
  const current=artifact({kind:'document',title:'Source',theme:{accent:'#275DAD',background:'#ffffff',text:'#123456'},blocks:[{type:'paragraph',text:'Source facts.'}]});
  let theme;
  t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({...current,theme})}}]})));
  const cfg=configFromEnv({MODEL_MODE:'glm',GLM_BASE_URL:'http://unused/v1'});
  const run=()=>generate(cfg,{kind:'document',references:[]},'Revise the title.',current,new AbortController().signal,{modelCalls:0,inputTokens:0,outputTokens:0},()=>{});
  assert.deepEqual((await run()).theme,current.theme);
  theme={accent:'#0F766E'};
  assert.deepEqual((await run()).theme,{...current.theme,accent:'#0F766E'});
});

test('Word export keeps headings with following content and uses compact native table paragraphs', async () => {
  const a=artifact({kind:'document',title:'Action record',blocks:[{type:'heading',text:'Actions'},{type:'table',table:{headers:['Owner','Due'],rows:[['Asha','10 October']]}}]});
  const zip=await JSZip.loadAsync(await exportDOCX(a));
  const styles=await zip.file('word/styles.xml').async('string');
  const xml=await zip.file('word/document.xml').async('string');
  assert.match(styles,/<w:keepNext\/>/);
  assert.match(styles,/<w:widowControl\/>/);
  assert.match(xml,/<w:tblHeader\/>/);
  assert.match(xml,/<w:cantSplit\/>/);
  assert.match(xml,/<w:spacing w:after="0" w:before="0" w:line="240"/);
  assert.match(xml,/Asha/);
});
