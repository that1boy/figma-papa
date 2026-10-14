'use strict';
const { pageHTML } = require('./presentation.cjs');
const { webScreens } = require('./schema.cjs');
// Small, standards-compliant stored ZIP writer. No new installation is required.
function crc32(bytes) { let crc=0xffffffff; for(const byte of bytes){crc^=byte;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0; }
function zip(files) {
  const local=[], central=[]; let offset=0;
  for(const [name,value] of Object.entries(files)) {
    const filename=Buffer.from(name), bytes=Buffer.isBuffer(value)?value:Buffer.from(value), crc=crc32(bytes);
    const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(0x21,12);h.writeUInt32LE(crc,14);h.writeUInt32LE(bytes.length,18);h.writeUInt32LE(bytes.length,22);h.writeUInt16LE(filename.length,26);
    local.push(h,filename,bytes);
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(0x21,14);c.writeUInt32LE(crc,16);c.writeUInt32LE(bytes.length,20);c.writeUInt32LE(bytes.length,24);c.writeUInt16LE(filename.length,28);c.writeUInt32LE(offset,42);central.push(c,filename);
    offset+=h.length+filename.length+bytes.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22),count=Object.keys(files).length;
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(count,8);end.writeUInt16LE(count,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
function handoff(project, revision, notes=[], history=null) {
  const a=revision.artifact, screens=webScreens(a);
  const files={
    'index.html':pageHTML(a,project.references),
    'artifact.json':JSON.stringify(a,null,2),
    'styles.css':a.css,
    'design-system.json':JSON.stringify(a.designSystem || a.theme,null,2),
    'README.md':`# ${a.title}\n\nOpen index.html in a browser. It is a self-contained clickable prototype. Navigation, tabs, search, dialogs and local form confirmation work offline. No backend, authentication, payment processing, remote API or data persistence is implemented.\n\n## Continue editing\nImport artifact.json into Forma and attach images from references in numbered order. This file contains the selected revision, not complete project history. Screens use shared styles.css; their original markup is in screens/. The standalone HTML embeds styles, reference images and the trusted interaction runtime.\n\n## Engineering handoff\nImplement the real application in your chosen framework using the semantic markup and design tokens as a specification. Replace simulated interactions with tested application logic. Validate accessibility and all responsive states. This is not a React/Flutter/native-app source build.\n\n## Origin\nRevision: ${revision.id}\nOrigin: ${revision.origin}\nModel mode: ${revision.metrics.mode}\nModel: ${revision.metrics.model || 'Not recorded for this revision'}\n\n## Screens\n${screens.map(s=>`- ${s.name} (${s.id})`).join('\n')}\n\n## Original brief / selected request\n${history ? history.briefs.map(b=>b.prompt).join("\n\n")+(history.omitted ? `\n\n${history.omitted} intermediate briefs exceeded the context limit.` : "") : revision.prompt}\n\n## Review notes for this revision\n${notes.map(n=>`- [${n.resolved?'resolved':'open'}] ${n.screen || 'Project'} / ${n.target || 'General'}: ${n.text}`).join('\n')||'No notes recorded.'}\n\n## Recorded checks\n${JSON.stringify(revision.metrics,null,2)}\n`,
  };
  for(const s of screens)files[`screens/${s.id}.html`]=s.html;
  project.references.forEach((r,i)=>{files[`references/${i+1}.${r.data.startsWith('data:image/png')?'png':'jpg'}`]=Buffer.from(r.data.split(',')[1],'base64');});
  return zip(files);
}
module.exports={zip,handoff};
