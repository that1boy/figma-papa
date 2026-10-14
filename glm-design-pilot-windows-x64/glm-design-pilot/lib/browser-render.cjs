'use strict';
const {chromium}=require('playwright');
async function browserRender(payload) {
  if(typeof payload.html!=='string'||payload.html.length>9000000)throw new Error('Invalid HTML render request.');
  const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{}),args:['--disable-dev-shm-usage']});
  let timer;
  try{
    timer=setTimeout(()=>browser.close().catch(()=>{}),90000);
    const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block',acceptDownloads:false});
    await context.route('**/*',r=>r.abort());
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message.slice(0,300)));
    await page.setContent(payload.html,{waitUntil:'load',timeout:15000});await page.evaluate(()=>document.fonts.ready);
    const ids=await page.locator('[data-forma-screen]').evaluateAll(nodes=>nodes.map(n=>({id:n.dataset.formaScreen,name:n.getAttribute('aria-label')})));
    const screenList=ids.length?ids:[{id:null,name:'Page'}],screenshots=[],views=[],screenMetrics=[];
    for(const screen of screenList){
      if(screen.id)await page.evaluate(id=>window.formaNavigate(id,false),screen.id);
      const measure={id:screen.id,name:screen.name};
      for(const [label,width,height]of [['Desktop',1280,900],['Tablet',768,1024],['Mobile',390,844]]){
        await page.setViewportSize({width,height});await page.evaluate(()=>scrollTo(0,0));
        const m=await page.evaluate(()=>{
          const root=document.querySelector('[data-forma-screen]:not([hidden])')||document.body;
          const visible=n=>!!n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden';
          const named=n=>(n.getAttribute('aria-label')||n.getAttribute('aria-labelledby')||n.textContent||n.getAttribute('alt')||'').trim();
          const controls=[...root.querySelectorAll('button,a,input,textarea,select')].filter(visible);
          const ids=[...root.querySelectorAll('[id]')].map(n=>n.id);
          const missingLabels=[...root.querySelectorAll('td')].filter(cell=>{
            const headers=[...(cell.closest('table')?.querySelectorAll('thead th')||[])];
            return visible(cell)&&headers.length&&headers.every(h=>!visible(h))&&!cell.dataset.label?.trim()&&getComputedStyle(cell,'::before').content==='""';
          }).length;
          return {overflow:document.documentElement.scrollWidth>innerWidth+2,height:document.documentElement.scrollHeight,missingLabels,
            unnamedControls:controls.filter(n=>['INPUT','TEXTAREA','SELECT'].includes(n.tagName)?!n.labels?.length&&!n.getAttribute('aria-label')&&!n.getAttribute('aria-labelledby'):!named(n)).length,
            duplicateIds:ids.filter((id,i)=>ids.indexOf(id)!==i).length,
            brokenTargets:[...root.querySelectorAll('[data-action]')].filter(n=>{if(n.dataset.action==='navigate')return ![...document.querySelectorAll('[data-forma-screen]')].some(s=>s.dataset.formaScreen===n.dataset.target);return !ids.includes(n.dataset.target);}).length,
            inactiveButtons:controls.filter(n=>n.tagName==='BUTTON'&&!n.disabled&&!n.dataset.action&&!n.closest('form')&&!n.dataset.formaRuntime).length};
        });
        measure[label.toLowerCase()]=m;
        screenshots.push((await page.screenshot({fullPage:false})).toString('base64'));views.push(`${screen.name} / ${label} ${width} × ${height}, top`);
        if(label==='Mobile'&&m.height>height){await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));screenshots.push((await page.screenshot({fullPage:false})).toString('base64'));views.push(`${screen.name} / Mobile ${width} × ${height}, bottom (middle scroll positions may be omitted)`);}
      }
      screenMetrics.push(measure);
    }
    // Printing explicitly includes every screen. Preview-only visibility does not
    // silently reduce a multi-screen handoff to its current screen.
    await page.addStyleTag({content:'@media print{[data-forma-screen][hidden],[data-forma-screen]{display:block!important;break-after:page;min-height:0!important}[data-forma-screen]:last-of-type{break-after:auto}}'});
    await page.setViewportSize({width:1280,height:900});
    const pdf=await page.pdf({format:'A4',printBackground:true,margin:{top:'12mm',right:'12mm',bottom:'12mm',left:'12mm'}});
    return {screenshots,views,pdf:pdf.toString('base64'),pageCount:screenshots.length,basis:'browser preview; every screen at desktop, tablet and mobile top/bottom (not every scroll position or interaction state)',metrics:{screenCount:screenList.length,screenMetrics,horizontalOverflow:screenMetrics.some(m=>m.desktop.overflow),tabletHorizontalOverflow:screenMetrics.some(m=>m.tablet.overflow),mobileHorizontalOverflow:screenMetrics.some(m=>m.mobile.overflow),mobileMissingLabels:screenMetrics.reduce((n,m)=>n+m.mobile.missingLabels,0),unnamedControls:screenMetrics.reduce((n,m)=>n+Math.max(m.desktop.unnamedControls,m.tablet.unnamedControls,m.mobile.unnamedControls),0),brokenTargets:screenMetrics.reduce((n,m)=>n+m.desktop.brokenTargets,0),inactiveButtons:screenMetrics.reduce((n,m)=>n+m.desktop.inactiveButtons,0),duplicateIds:screenMetrics.reduce((n,m)=>n+m.desktop.duplicateIds,0),height:screenMetrics[0].desktop.height,errors}};
  }finally{clearTimeout(timer);await browser.close();}
}
module.exports={browserRender};
