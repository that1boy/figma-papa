'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {chromium}=require('playwright'),JSZip=require('jszip');
const {start,stop,freePort,client,root}=require('./helpers.cjs');
const {starter,starters}=require('../lib/starters.cjs');
const {pageHTML}=require('../lib/presentation.cjs');
(async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'forma-studio-browser-'));
  const results=process.env.TEST_RESULTS_DIR||path.join(root,'test-results','studio');await fs.mkdir(results,{recursive:true});
  let browser,app,renderer;
  try{
    renderer=await start('renderer.cjs',{RENDER_PORT:String(await freePort()),RENDER_HOST:'127.0.0.1',RENDER_TOKEN:'studio-test-render-token'});
    app=await start('server.cjs',{APP_PASSWORD:'test-pilot-password',MODEL_MODE:'demo',DATA_DIR:dir,HOST:'127.0.0.1',RENDER_URL:renderer.url,RENDER_TOKEN:'studio-test-render-token'});
    const api=await client(app.url);
    browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
    const context=await browser.newContext({viewport:{width:1600,height:1000},acceptDownloads:true});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(app.url);await page.getByLabel('Pilot password').fill('test-pilot-password');await page.getByRole('button',{name:/Open workspace/}).click();
    await page.locator('[data-starter="workspace"]').waitFor();await page.screenshot({path:path.join(results,'01-library.png'),fullPage:true});
    await page.locator('[data-starter="workspace"]').click();const frame=page.frameLocator('#preview-frame');
    await frame.getByRole('heading',{name:'A little more clarity.'}).waitFor();
    await page.locator('#canvas-zoom').selectOption('1');
    assert.match(await page.locator('#chat-history').innerText(),/CURATED LAYOUT/);assert.equal(await page.locator('#generate-button').isEnabled(),false);
    assert.equal(await page.locator('.screen-item').count(),4);
    await frame.getByRole('button',{name:'Requests',exact:true}).click();await frame.getByRole('heading',{name:'Everything in one place.'}).waitFor();
    await frame.getByRole('searchbox',{name:'Search requests'}).fill('unmatched phrase');await frame.getByText('No matching results. Try another search.',{exact:true}).waitFor();
    await frame.getByRole('searchbox',{name:'Search requests'}).fill('');assert.equal(await frame.locator('#requests:visible tr:visible').count(),3);
    await frame.getByRole('button',{name:'Design review',exact:true}).click();await frame.getByRole('button',{name:'Leave an example review'}).click();
    await frame.getByLabel('Your notes').fill('Synthetic review');await frame.getByRole('button',{name:'Save example review'}).click();assert.match(await frame.locator('dialog [role=status]').innerText(),/No request has been sent/);
    await frame.getByRole('button',{name:'Close',exact:true}).click();assert.equal(await frame.locator('dialog').evaluate(n=>n.open),false);
    await frame.getByRole('button',{name:'Leave an example review'}).click();await frame.getByLabel('Your notes').press('Escape');assert.equal(await frame.locator('dialog').evaluate(n=>n.open),false);
    await page.locator('[data-screen="overview"]').click();await frame.getByRole('heading',{name:'A little more clarity.'}).waitFor();
    await page.locator('#studio-focus').click();await page.locator('#design-mode').click();
    await frame.getByRole('heading',{name:'A little more clarity.'}).click();await page.locator('#element-text').waitFor();
    await page.locator('#element-text').fill('Your team, in focus.');await page.locator('#element-size').fill('36');await page.getByRole('button',{name:'Apply changes',exact:true}).click();
    await frame.getByRole('heading',{name:'Your team, in focus.'}).waitFor();assert.match(await page.locator('#draft-status').innerText(),/Unsaved/);
    await frame.getByRole('heading',{name:'Your team, in focus.'}).click();await page.locator('#element-padding').fill('18');await page.getByRole('button',{name:'Apply changes',exact:true}).click();
    await frame.getByRole('heading',{name:'Your team, in focus.'}).waitFor();assert.equal(await frame.getByRole('heading',{name:'Your team, in focus.'}).evaluate(n=>getComputedStyle(n).fontSize),'36px','property edits preserve earlier changes');
    await page.locator('#studio-undo').click();await frame.getByRole('heading',{name:'Your team, in focus.'}).waitFor();await page.locator('#studio-undo').click();await frame.getByRole('heading',{name:'A little more clarity.'}).waitFor();
    await page.locator('#studio-redo').click();await frame.getByRole('heading',{name:'Your team, in focus.'}).waitFor();
    await page.locator('#export-button').click();assert.match(await page.locator('#toast').innerText(),/Save design/);
    await page.locator('#studio-save').click();await page.locator('#draft-status').filter({hasText:'Saved revision'}).waitFor();await frame.getByRole('heading',{name:'Your team, in focus.'}).waitFor();
    const pid=(await api('/projects')).data[0].id;let project=(await api('/projects/'+pid)).data;
    assert.equal(project.revisions.length,2);assert.match(project.current.artifact.screens[0].html,/Your team, in focus/);assert.equal(project.current.metrics.mode,'template');
    await page.locator('#design-mode').click();await frame.getByRole('heading',{name:'Your team, in focus.'}).click();
    await page.locator('[data-element-action="duplicate"]').click();await frame.getByRole('heading',{name:'Your team, in focus.'}).nth(1).waitFor();assert.equal(await frame.getByRole('heading',{name:'Your team, in focus.'}).count(),2);
    assert.deepEqual(await frame.getByRole('heading',{name:'Your team, in focus.'}).evaluateAll(nodes=>nodes.map(n=>getComputedStyle(n).fontSize)),['36px','36px']);
    await page.locator('#studio-undo').click();await page.locator('#draft-status').filter({hasText:'Saved revision'}).waitFor();
    await page.locator('#add-screen').click();await page.getByLabel('Screen name',{exact:true}).fill('Review complete');await page.getByRole('button',{name:'Save screen',exact:true}).click();
    await frame.getByRole('heading',{name:'Review complete',exact:true}).waitFor();await page.locator('[data-component="button"]').click();await frame.getByRole('button',{name:'Button label'}).waitFor();
    await frame.getByRole('button',{name:'Button label'}).click();await page.locator('#element-text').fill('Back to overview');await page.locator('#element-link').selectOption('overview');await page.getByRole('button',{name:'Apply changes',exact:true}).click();await frame.getByRole('button',{name:'Back to overview'}).waitFor();
    await page.locator('#interact-mode').click();await frame.getByRole('button',{name:'Back to overview'}).click();await frame.getByRole('heading',{name:'Your team, in focus.'}).waitFor();
    await page.locator('#studio-save').click();await page.locator('#draft-status').filter({hasText:'Saved revision'}).waitFor();
    assert.equal((await api('/projects/'+pid)).data.current.artifact.screens.length,5);
    await page.locator('#studio-style').click();await page.locator('#style-preset').selectOption('preset-2');await page.locator('#style-name').fill('Synthetic team style');await page.getByRole('button',{name:'Apply to design',exact:true}).click();
    await page.locator('#draft-status').filter({hasText:'Unsaved changes'}).waitFor();await page.locator('#save-kit').click();await page.locator('#style-preset').locator('option').filter({hasText:'Saved: Synthetic team style'}).waitFor({state:'attached'});
    await page.locator('#studio-save').click();await page.locator('#draft-status').filter({hasText:'Saved revision'}).waitFor();
    await page.locator('#studio-notes').click();await page.locator('#note-text').fill('Check the heading with a real teammate.');await page.getByRole('button',{name:'Add feedback',exact:true}).click();await page.locator('.design-note').filter({hasText:'Check the heading'}).waitFor();
    await page.locator('[data-use-note]').click();assert.match(await page.locator('#prompt').inputValue(),/Check the heading/);await page.locator('[data-resolve-note]').click();await page.locator('.design-note.resolved').waitFor();
    await page.locator('#close-inspector').click();await page.locator('#mobile-view').click();await page.waitForFunction(()=>Math.abs(document.querySelector('#preview-frame').getBoundingClientRect().width-390)<2);
    await page.screenshot({path:path.join(results,'03-mobile-canvas.png'),fullPage:true});
    await page.locator('#desktop-view').click();await page.locator('#design-mode').click();await frame.getByRole('heading',{name:'Your team, in focus.'}).click();await page.screenshot({path:path.join(results,'02-design-inspector.png'),fullPage:true});
    await page.locator('#interact-mode').click();await page.locator('#export-format').selectOption('zip');const download=page.waitForEvent('download');await page.locator('#export-button').click();const file=await download;await file.saveAs(path.join(results,'studio-handoff.zip'));
    const zip=await JSZip.loadAsync(await fs.readFile(path.join(results,'studio-handoff.zip')),{checkCRC32:true});assert.equal(Object.keys(zip.files).filter(n=>n.startsWith('screens/')).length,5);assert.match(await zip.file('README.md').async('string'),/Check the heading with a real teammate/);
    // The handoff remains usable offline, with no editor bridge or server API.
    const offline=await context.newPage();await offline.setContent(await zip.file('index.html').async('string'));await offline.getByRole('button',{name:'Requests',exact:true}).click();await offline.getByRole('heading',{name:'Everything in one place.'}).waitFor();await offline.close();
    await page.locator('#studio-copy').click();await page.locator('#breadcrumbs').filter({hasText:'exploration'}).waitFor();assert.match(await page.locator('#chat-history').innerText(),/COPIED DESIGN/);
    const copied=(await api('/projects')).data[0].id;assert.notEqual(copied,pid);assert.equal((await api('/projects/'+copied)).data.current.metrics.mode,'copy');
    // Source drafts are retained when switching panels or saving unapplied JSON.
    await page.locator('[data-tab="edit"]').click();const sourceTitle=page.locator('[data-field="title"]');await sourceTitle.fill('Source draft retained');
    await page.locator('[data-tab="preview"]').click();assert.equal(await page.locator('#edit-panel').isVisible(),true);assert.match(await page.locator('#toast').innerText(),/source edits/);
    await page.locator('[data-tab="edit"]').click();assert.equal(await sourceTitle.inputValue(),'Source draft retained');
    await page.locator('#edit-panel summary').click();const originalJSON=await page.locator('#artifact-json').inputValue();await page.locator('#artifact-json').fill('{');await page.locator('#save-edit').click();assert.match(await page.locator('#toast').innerText(),/Apply your JSON/);
    await page.locator('#artifact-json').fill(originalJSON);await page.locator('#save-edit').click();await page.locator('#breadcrumbs').filter({hasText:'Source draft retained'}).waitFor();
    await page.locator('[data-tab="checks"]').click();await page.locator('#render-now').click();await page.getByRole('heading',{name:'Responsive screen checks'}).waitFor();assert.equal(await page.locator('.responsive-checks tbody tr').count(),5);
    await page.locator('[data-tab="preview"]').click();await frame.getByRole('heading',{name:'Your team, in focus.'}).waitFor();await page.locator('#canvas-zoom').selectOption('fit');await page.locator('#design-mode').click();await page.locator('[data-layer]').first().click();await page.screenshot({path:path.join(results,'05-studio-fit.png'),fullPage:true});
    // All supplied starter screens get real Chromium layout checks at three widths.
    const audit=[];for(const info of starters){const a=starter(info.id);const response=await fetch(renderer.url+'/render',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer studio-test-render-token'},body:JSON.stringify({html:pageHTML(a)})});assert.equal(response.status,200);const render=await response.json();audit.push({starter:info.id,...render.metrics,views:render.views});assert.equal(render.metrics.screenCount,a.screens.length);assert.equal(render.metrics.horizontalOverflow,false,info.id+' desktop overflow');assert.equal(render.metrics.tabletHorizontalOverflow,false,info.id+' tablet overflow');assert.equal(render.metrics.mobileHorizontalOverflow,false,info.id+' mobile overflow');assert.equal(render.metrics.brokenTargets,0,info.id+' broken targets');assert.equal(render.metrics.unnamedControls,0,info.id+' unnamed controls');assert.equal(render.metrics.inactiveButtons,0,info.id+' inactive buttons');assert.equal(render.metrics.duplicateIds,0,info.id+' duplicate IDs');assert.deepEqual(render.metrics.errors,[]);assert(render.views.some(v=>v.includes(a.screens.at(-1).name)));await fs.writeFile(path.join(results,info.id+'-mobile.png'),Buffer.from(render.screenshots[2],'base64'));}
    await fs.writeFile(path.join(results,'responsive-audit.json'),JSON.stringify(audit,null,2));
    // Small editor viewport remains navigable without body overflow.
    await page.setViewportSize({width:390,height:844});await page.locator('#nav-projects').click();await page.locator('#library').waitFor({state:'visible'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));await page.screenshot({path:path.join(results,'04-mobile-library.png'),fullPage:true});
    assert.deepEqual(errors,[]);console.log('Studio browser passed: linked screens, search and empty state, forms, dialogs, visual edits, style preservation, undo/redo, components, screen creation, styles, feedback, safe draft/export, independent copy, offline ZIP, and responsive checks on all 11 starter screens.');
    console.log('Evidence: '+results);
  }finally{await browser?.close();await stop(app);await stop(renderer);await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
