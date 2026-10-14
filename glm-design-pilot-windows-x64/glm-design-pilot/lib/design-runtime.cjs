'use strict';
// Only this application-owned script executes inside design previews and HTML exports.
// Model-produced scripts, network requests and inline event handlers remain forbidden.
function prototypeRuntime() {
  const screens = [...document.querySelectorAll('[data-forma-screen]')];
  const active = () => screens.find(s => !s.hidden) || document.body;
  const target = (id, from) => [...(from?.closest('[data-forma-screen]') || active()).querySelectorAll('[id]')].find(n => n.id === id);
  function navigate(id, focus = true) {
    const screen = screens.find(s => s.dataset.formaScreen === id);
    if (!screen) return false;
    screens.forEach(s => { s.hidden = s !== screen; });
    scrollTo(0, 0);
    if (focus) { const first = screen.querySelector('h1,h2,main'); if(first) { first.setAttribute('tabindex','-1'); first.focus({preventScroll:true}); } }
    dispatchEvent(new CustomEvent('forma:screen', { detail: id }));
    return true;
  }
  window.formaNavigate = navigate;
  const hashScreen = () => navigate(location.hash.replace(/^#screen=/, ''), false);
  addEventListener('hashchange', hashScreen);
  if (screens.length) { if(!hashScreen()) navigate(screens[0].dataset.formaScreen, false); }
  document.querySelectorAll('dialog').forEach(dialog => {
    // Every dialog has an exit even when the model forgot to generate one.
    if (!dialog.querySelector('[data-action="close"]')) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Close';
      button.setAttribute('aria-label','Close dialog'); button.dataset.formaRuntime = 'true';
      button.addEventListener('click',()=>dialog.close()); dialog.prepend(button);
    }
    dialog.addEventListener('click', e => { if(e.target === dialog) { const b=dialog.getBoundingClientRect(); if(e.clientX<b.left || e.clientX>b.right || e.clientY<b.top || e.clientY>b.bottom) dialog.close(); } });
  });
  document.addEventListener('click', e => {
    const b=e.target.closest('[data-action]'); if(!b) return;
    if(b.dataset.action === 'navigate') { e.preventDefault(); if(navigate(b.dataset.target)) location.hash='screen='+b.dataset.target; return; }
    const t=target(b.dataset.target,b); if(!t) return;
    switch(b.dataset.action) {
      case 'toggle': e.preventDefault(); t.hidden=!t.hidden; b.setAttribute('aria-expanded',String(!t.hidden)); break;
      case 'tab':
        e.preventDefault(); active().querySelectorAll('[data-panel]').forEach(p=>{ if(p.dataset.panel===b.dataset.group)p.hidden=p!==t; });
        active().querySelectorAll('[data-action="tab"]').forEach(p=>{if(p.dataset.group===b.dataset.group)p.setAttribute('aria-selected',String(p===b));}); break;
      case 'open': e.preventDefault(); if(t.tagName==='DIALOG' && !t.open)t.showModal(); break;
      case 'close': e.preventDefault(); if(t.tagName==='DIALOG')t.close(); break;
    }
  });
  document.addEventListener('input', e => {
    if(e.target.dataset.action!=='filter')return;
    const t=target(e.target.dataset.target,e.target); if(!t)return;
    let visible=0; t.querySelectorAll('[data-row]').forEach(r=>{ r.hidden=!r.textContent.toLowerCase().includes(e.target.value.toLowerCase()); if(!r.hidden)visible++; });
    let message=t.nextElementSibling;
    if(!message?.hasAttribute('data-forma-filter-status')) {message=document.createElement('p');message.setAttribute('data-forma-filter-status','');message.dataset.formaRuntime='true';message.setAttribute('role','status');t.after(message);}
    message.textContent=visible?'':'No matching results. Try another search.';
  });
  document.addEventListener('submit',e=>{e.preventDefault();let m=e.target.querySelector('[role="status"]');if(!m){m=document.createElement('p');m.setAttribute('role','status');m.dataset.formaRuntime='true';e.target.append(m);}m.textContent='Saved in this preview only. No request has been sent.';});
}
function inspectorRuntime(channel, initialScreen) {
  let designing=false, selected=null;
  const roots=[...document.querySelectorAll('[data-forma-screen]')];
  const root=()=>roots.find(n=>!n.hidden)||document.body;
  const nodes=()=>[...root().querySelectorAll('*')].filter(n=>!n.closest('[data-forma-runtime]') && !['SCRIPT','STYLE'].includes(n.tagName));
  const send=(type,data={})=>parent.postMessage({channel,type,...data},'*');
  function outline(node) { if(selected) {selected.style.outline='';selected.style.outlineOffset='';} selected=node; if(node){node.style.outline='2px solid #635bff';node.style.outlineOffset='2px';} }
  function select(node) {
    const all=nodes(), index=all.indexOf(node); if(index<0)return;
    outline(node); const s=getComputedStyle(node);
    send('selection',{index,screen:root().dataset.formaScreen||'home',tag:node.tagName.toLowerCase(),text:(node.innerText||node.textContent).slice(0,5000),leaf:[...node.children].every(n=>n.tagName==='BR'),
      styles:{color:s.color,background:s.backgroundColor,fontSize:s.fontSize,padding:s.padding,gap:s.gap,borderRadius:s.borderRadius,display:s.display,textAlign:s.textAlign},
      label:node.getAttribute('aria-label')||'',action:node.dataset.action||'',target:node.dataset.target||''});
  }
  function describe() {
    const all=nodes();
    send('layers',{screen:root().dataset.formaScreen||'home',layers:all.slice(0,600).map((n,index)=>({index,tag:n.tagName.toLowerCase(),text:(n.getAttribute('aria-label')||n.textContent||n.tagName).trim().slice(0,65),depth:Math.min(8,(()=>{let d=0,p=n.parentElement;while(p&&p!==root()){d++;p=p.parentElement;}return d;})())}))});
  }
  addEventListener('message',e=>{ if(e.source!==parent || e.data?.channel!==channel)return;
    if(e.data.type==='mode'){designing=!!e.data.designing;outline(null);document.documentElement.style.cursor=designing?'crosshair':'';}
    if(e.data.type==='select' && Number.isInteger(e.data.index))select(nodes()[e.data.index]);
    if(e.data.type==='screen' && typeof e.data.screen==='string')window.formaNavigate?.(e.data.screen,false);
  });
  document.addEventListener('click',e=>{if(!designing)return;e.preventDefault();e.stopImmediatePropagation();select(e.target);},true);
  addEventListener('forma:screen',()=>{outline(null);describe();send('screen',{screen:root().dataset.formaScreen});});
  if(initialScreen)window.formaNavigate?.(initialScreen,false);
  describe();send('ready');
}
module.exports = { INTERACTIONS: `(${prototypeRuntime.toString()})();`, inspectorScript: (channel, screen) => `(${inspectorRuntime.toString()})(${JSON.stringify(channel)},${JSON.stringify(screen)});` };
