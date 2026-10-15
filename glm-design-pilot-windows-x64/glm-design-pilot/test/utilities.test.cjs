'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { utilityCSS, classifyClasses, collectClasses, UTILITY_REFERENCE, escapeClass, PALETTE, SEMANTIC_COLORS } = require('../lib/utilities.cjs');
const css = (...c) => utilityCSS(c);
const supported = (c) => classifyClasses([c]).supported.length === 1;
const media = (q, ...rules) => `@media ${q}{\n${rules.join('\n')}\n}`;

const EXACT = {
  // spacing, negatives, auto
  'p-4': '.p-4{padding:1rem}',
  'p-0': '.p-0{padding:0px}',
  'px-2.5': '.px-2\\.5{padding-left:0.625rem;padding-right:0.625rem}',
  'py-px': '.py-px{padding-top:1px;padding-bottom:1px}',
  'ps-3': '.ps-3{padding-inline-start:0.75rem}',
  'm-0.5': '.m-0\\.5{margin:0.125rem}',
  'mx-auto': '.mx-auto{margin-left:auto;margin-right:auto}',
  'mt-96': '.mt-96{margin-top:24rem}',
  '-mt-2': '.-mt-2{margin-top:-0.5rem}',
  '-mx-px': '.-mx-px{margin-left:-1px;margin-right:-1px}',
  '-mt-[18px]': '.-mt-\\[18px\\]{margin-top:-18px}',
  '-mt-[var(--gap)]': '.-mt-\\[var\\(--gap\\)\\]{margin-top:calc(var(--gap) * -1)}',
  'gap-x-6': '.gap-x-6{column-gap:1.5rem}',
  'gap-3.5': '.gap-3\\.5{gap:0.875rem}',
  // sizing and fractions
  'w-1/2': '.w-1\\/2{width:50%}',
  'w-1/3': '.w-1\\/3{width:33.333333%}',
  'w-2/3': '.w-2\\/3{width:66.666667%}',
  'w-11/12': '.w-11\\/12{width:91.666667%}',
  'basis-5/12': '.basis-5\\/12{flex-basis:41.666667%}',
  'w-full': '.w-full{width:100%}',
  'w-screen': '.w-screen{width:100vw}',
  'h-screen': '.h-screen{height:100vh}',
  'min-h-dvh': '.min-h-dvh{min-height:100dvh}',
  'w-fit': '.w-fit{width:fit-content}',
  'size-4': '.size-4{width:1rem;height:1rem}',
  'max-w-prose': '.max-w-prose{max-width:65ch}',
  'max-w-7xl': '.max-w-7xl{max-width:80rem}',
  'max-w-screen-md': '.max-w-screen-md{max-width:768px}',
  'min-w-0': '.min-w-0{min-width:0px}',
  'w-[42rem]': '.w-\\[42rem\\]{width:42rem}',
  'h-[33.5%]': '.h-\\[33\\.5\\%\\]{height:33.5%}',
  // position
  'inset-0': '.inset-0{inset:0px}',
  'inset-x-4': '.inset-x-4{left:1rem;right:1rem}',
  '-top-1/2': '.-top-1\\/2{top:-50%}',
  '-inset-full': '.-inset-full{inset:-100%}',
  'top-[var(--header-h)]': '.top-\\[var\\(--header-h\\)\\]{top:var(--header-h)}',
  'start-0': '.start-0{inset-inline-start:0px}',
  'z-50': '.z-50{z-index:50}',
  '-z-10': '.-z-10{z-index:-10}',
  'z-[60]': '.z-\\[60\\]{z-index:60}',
  'order-last': '.order-last{order:9999}',
  'order-first': '.order-first{order:-9999}',
  // flex and grid
  'flex': '.flex{display:flex}',
  'hidden': '.hidden{display:none}',
  'grid-cols-3': '.grid-cols-3{grid-template-columns:repeat(3, minmax(0, 1fr))}',
  'grid-rows-2': '.grid-rows-2{grid-template-rows:repeat(2, minmax(0, 1fr))}',
  'col-span-full': '.col-span-full{grid-column:1 / -1}',
  'col-span-2': '.col-span-2{grid-column:span 2 / span 2}',
  'row-span-3': '.row-span-3{grid-row:span 3 / span 3}',
  'col-start-2': '.col-start-2{grid-column-start:2}',
  'auto-rows-fr': '.auto-rows-fr{grid-auto-rows:minmax(0, 1fr)}',
  'flex-1': '.flex-1{flex:1 1 0%}',
  'flex-none': '.flex-none{flex:none}',
  'grow': '.grow{flex-grow:1}',
  'shrink-0': '.shrink-0{flex-shrink:0}',
  'flex-col': '.flex-col{flex-direction:column}',
  'items-center': '.items-center{align-items:center}',
  'justify-between': '.justify-between{justify-content:space-between}',
  'content-between': '.content-between{align-content:space-between}',
  'self-end': '.self-end{align-self:flex-end}',
  'place-items-center': '.place-items-center{place-items:center}',
  'place-self-start': '.place-self-start{place-self:start}',
  'justify-self-end': '.justify-self-end{justify-self:end}',
  // typography
  'text-xs': '.text-xs{font-size:0.75rem;line-height:1rem}',
  'text-base': '.text-base{font-size:1rem;line-height:1.5rem}',
  'text-2xl': '.text-2xl{font-size:1.5rem;line-height:2rem}',
  'text-5xl': '.text-5xl{font-size:3rem;line-height:1}',
  'text-9xl': '.text-9xl{font-size:8rem;line-height:1}',
  'text-sm/6': '.text-sm\\/6{font-size:0.875rem;line-height:1.5rem}',
  'text-lg/[1.4]': '.text-lg\\/\\[1\\.4\\]{font-size:1.125rem;line-height:1.4}',
  'text-[22px]': '.text-\\[22px\\]{font-size:22px}',
  'font-semibold': '.font-semibold{font-weight:600}',
  'font-[650]': '.font-\\[650\\]{font-weight:650}',
  'font-heading': '.font-heading{font-family:var(--font-heading, var(--font, ui-sans-serif, system-ui, sans-serif))}',
  'leading-tight': '.leading-tight{line-height:1.25}',
  'leading-7': '.leading-7{line-height:1.75rem}',
  'leading-[1.4]': '.leading-\\[1\\.4\\]{line-height:1.4}',
  'tracking-tight': '.tracking-tight{letter-spacing:-0.025em}',
  'tracking-widest': '.tracking-widest{letter-spacing:0.1em}',
  'tracking-[0.2em]': '.tracking-\\[0\\.2em\\]{letter-spacing:0.2em}',
  'text-center': '.text-center{text-align:center}',
  'uppercase': '.uppercase{text-transform:uppercase}',
  'tabular-nums': '.tabular-nums{font-variant-numeric:tabular-nums}',
  'truncate': '.truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  'line-clamp-3': '.line-clamp-3{overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3}',
  'whitespace-nowrap': '.whitespace-nowrap{white-space:nowrap}',
  'break-words': '.break-words{overflow-wrap:break-word}',
  // colours
  'bg-accent': '.bg-accent{background-color:var(--accent)}',
  'bg-surface': '.bg-surface{background-color:var(--surface)}',
  'text-muted': '.text-muted{color:var(--muted)}',
  'text-on-accent': '.text-on-accent{color:var(--on-accent)}',
  'text-accent-2': '.text-accent-2{color:var(--accent-2)}',
  'bg-accent/10': '.bg-accent\\/10{background-color:color-mix(in oklab, var(--accent) 10%, transparent)}',
  'bg-white/80': '.bg-white\\/80{background-color:color-mix(in oklab, #fff 80%, transparent)}',
  'text-slate-500': '.text-slate-500{color:#64748b}',
  'bg-blue-950': '.bg-blue-950{background-color:#172554}',
  'bg-[#0f766e]': '.bg-\\[\\#0f766e\\]{background-color:#0f766e}',
  'bg-[#0f766e]/50': '.bg-\\[\\#0f766e\\]\\/50{background-color:color-mix(in oklab, #0f766e 50%, transparent)}',
  'bg-red-500/[0.35]': '.bg-red-500\\/\\[0\\.35\\]{background-color:color-mix(in oklab, #ef4444 35%, transparent)}',
  'text-[var(--brand)]': '.text-\\[var\\(--brand\\)\\]{color:var(--brand)}',
  'text-current': '.text-current{color:currentColor}',
  'fill-current': '.fill-current{fill:currentColor}',
  'stroke-2': '.stroke-2{stroke-width:2}',
  'decoration-accent': '.decoration-accent{text-decoration-color:var(--accent)}',
  'placeholder-slate-400': '.placeholder-slate-400::placeholder{color:#94a3b8}',
  'caret-accent': '.caret-accent{caret-color:var(--accent)}',
  // effects
  'rounded': '.rounded{border-radius:var(--radius, 0.25rem)}',
  'rounded-lg': '.rounded-lg{border-radius:var(--radius-lg, 0.5rem)}',
  'rounded-2xl': '.rounded-2xl{border-radius:calc(var(--radius-lg, 0.5rem) * 2)}',
  'rounded-full': '.rounded-full{border-radius:9999px}',
  'rounded-none': '.rounded-none{border-radius:0px}',
  'rounded-t-xl': '.rounded-t-xl{border-top-left-radius:calc(var(--radius-lg, 0.5rem) * 1.5);border-top-right-radius:calc(var(--radius-lg, 0.5rem) * 1.5)}',
  'rounded-[12px]': '.rounded-\\[12px\\]{border-radius:12px}',
  'opacity-50': '.opacity-50{opacity:0.5}',
  'opacity-5': '.opacity-5{opacity:0.05}',
  'opacity-[.35]': '.opacity-\\[\\.35\\]{opacity:.35}',
  'outline-none': '.outline-none{outline:2px solid transparent;outline-offset:2px}',
  'aspect-video': '.aspect-video{aspect-ratio:16 / 9}',
  'aspect-square': '.aspect-square{aspect-ratio:1 / 1}',
  'aspect-[4/3]': '.aspect-\\[4\\/3\\]{aspect-ratio:4 / 3}',
  'object-cover': '.object-cover{object-fit:cover}',
  'overflow-x-auto': '.overflow-x-auto{overflow-x:auto}',
  'overflow-hidden': '.overflow-hidden{overflow:hidden}',
  'transition-colors': '.transition-colors{transition-property:color, background-color, border-color, text-decoration-color, fill, stroke;transition-timing-function:cubic-bezier(0.4, 0, 0.2, 1);transition-duration:150ms}',
  'duration-200': '.duration-200{transition-duration:200ms}',
  'delay-[250ms]': '.delay-\\[250ms\\]{transition-delay:250ms}',
  'ease-out': '.ease-out{transition-timing-function:cubic-bezier(0, 0, 0.2, 1)}',
  'backdrop-blur': '.backdrop-blur{-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}',
  // interactivity
  'cursor-pointer': '.cursor-pointer{cursor:pointer}',
  'cursor-not-allowed': '.cursor-not-allowed{cursor:not-allowed}',
  'select-none': '.select-none{-webkit-user-select:none;user-select:none}',
  'pointer-events-none': '.pointer-events-none{pointer-events:none}',
  'invisible': '.invisible{visibility:hidden}',
  'visible': '.visible{visibility:visible}',
  'p-[18px]': '.p-\\[18px\\]{padding:18px}',
  'p-[var(--pad)]': '.p-\\[var\\(--pad\\)\\]{padding:var(--pad)}',
  'z-[var(--z)]': '.z-\\[var\\(--z\\)\\]{z-index:var(--z)}',
  'text-[length:var(--size)]': '.text-\\[length\\:var\\(--size\\)\\]{font-size:var(--size)}',
};

test('representative classes produce exact Tailwind-compatible CSS', () => {
  for (const [cls, expected] of Object.entries(EXACT)) assert.equal(css(cls), expected, cls);
});

test('variants: pseudo classes, group, peer, aria, placeholder, important and dark', () => {
  assert.equal(css('hover:bg-slate-100'), '.hover\\:bg-slate-100:hover{background-color:#f1f5f9}');
  assert.equal(css('focus-visible:outline-none'), '.focus-visible\\:outline-none:focus-visible{outline:2px solid transparent;outline-offset:2px}');
  assert.equal(css('active:bg-accent-strong'), '.active\\:bg-accent-strong:active{background-color:var(--accent-strong)}');
  assert.equal(css('disabled:opacity-50'), '.disabled\\:opacity-50:disabled{opacity:0.5}');
  assert.equal(css('first:mt-0'), '.first\\:mt-0:first-child{margin-top:0px}');
  assert.equal(css('last:pb-0'), '.last\\:pb-0:last-child{padding-bottom:0px}');
  assert.equal(css('odd:bg-surface'), '.odd\\:bg-surface:nth-child(odd){background-color:var(--surface)}');
  assert.equal(css('even:bg-slate-50'), '.even\\:bg-slate-50:nth-child(even){background-color:#f8fafc}');
  assert.equal(css('group-hover:text-accent'), '.group:hover .group-hover\\:text-accent{color:var(--accent)}');
  assert.equal(css('peer-checked:bg-accent'), '.peer:checked ~ .peer-checked\\:bg-accent{background-color:var(--accent)}');
  assert.equal(css('aria-selected:font-semibold'), '.aria-selected\\:font-semibold[aria-selected=true]{font-weight:600}');
  assert.equal(css('placeholder:text-muted'), '.placeholder\\:text-muted::placeholder{color:var(--muted)}');
  assert.equal(css('focus:placeholder:text-text'), '.focus\\:placeholder\\:text-text:focus::placeholder{color:var(--text)}');
  assert.equal(css('hover:focus:underline'), '.hover\\:focus\\:underline:hover:focus{text-decoration-line:underline}');
  assert.equal(css('!p-4'), '.\\!p-4{padding:1rem !important}');
  assert.equal(css('md:!-mt-2'), media('(min-width: 768px)', '.md\\:\\!-mt-2{margin-top:-0.5rem !important}'));
  assert.equal(css('md:grid-cols-3'), media('(min-width: 768px)', '.md\\:grid-cols-3{grid-template-columns:repeat(3, minmax(0, 1fr))}'));
  assert.equal(css('md:hover:bg-accent/10'), media('(min-width: 768px)', '.md\\:hover\\:bg-accent\\/10:hover{background-color:color-mix(in oklab, var(--accent) 10%, transparent)}'));
  assert.equal(css('2xl:p-4'), media('(min-width: 1536px)', '.\\32 xl\\:p-4{padding:1rem}'));
  assert.equal(css('motion-reduce:transition-none'), media('(prefers-reduced-motion: reduce)', '.motion-reduce\\:transition-none{transition-property:none}'));
  assert.equal(css('lg:motion-safe:hover:underline'), media('(min-width: 1024px) and (prefers-reduced-motion: no-preference)', '.lg\\:motion-safe\\:hover\\:underline:hover{text-decoration-line:underline}'));
  assert.equal(css('print:hidden'), media('print', '.print\\:hidden{display:none}'));
  assert.equal(css('group-hover:placeholder:text-accent'), '.group:hover .group-hover\\:placeholder\\:text-accent::placeholder{color:var(--accent)}');
  // dark: is valid but intentionally emits nothing
  assert.equal(css('dark:bg-black', 'md:dark:text-white'), '');
  assert.deepEqual(classifyClasses(['dark:bg-black', 'dark:no-such-thing']), { supported: ['dark:bg-black'], unknown: ['dark:no-such-thing'] });
  for (const bad of ['foo:p-4', 'sm:md:p-4', 'hover:hover:p-4', 'placeholder:space-y-2', 'placeholder:placeholder-accent', 'md:container', 'hover:group', ':p-4', 'p-4:', 'md::p-4', 'max-sm:p-4', '!group', '-!mt-2', 'p-4!'])
    assert.equal(supported(bad), false, bad);
  assert.equal(supported('group'), true);
  assert.equal(supported('peer'), true);
  assert.equal(css('group', 'peer'), '');
});

test('ordering follows Tailwind: base, then variants, then breakpoints in order; plugin order inside each', () => {
  const out = css('xl:p-10', 'md:p-8', 'focus:p-7', 'hover:p-6', 'p-4', 'lg:p-9', 'sm:p-2', '2xl:p-12', 'md:hover:p-1');
  const at = (s) => { const i = out.indexOf(s); assert.ok(i >= 0, s); return i; };
  const seq = ['.p-4{', '.hover\\:p-6:hover', '.focus\\:p-7:focus', '(min-width: 640px)', '(min-width: 768px)', '.md\\:p-8{', '.md\\:hover\\:p-1:hover', '(min-width: 1024px)', '(min-width: 1280px)', '(min-width: 1536px)'];
  for (let i = 1; i < seq.length; i++) assert.ok(at(seq[i - 1]) < at(seq[i]), `${seq[i - 1]} before ${seq[i]}`);
  assert.equal(out.match(/@media \(min-width: 768px\)/g).length, 1, 'one block per breakpoint');
  const before = (a, b) => { const o = css(b, a); assert.ok(o.indexOf('.' + escapeClass(a) + '{') < o.indexOf('.' + escapeClass(b) + '{'), `${a} before ${b}`); };
  before('p-4', 'px-2');
  before('px-2', 'pl-1');
  before('m-4', 'mt-2');
  before('inset-0', 'top-2');
  before('text-lg', 'leading-tight');
  before('font-sans', 'text-lg');
  before('flex-1', 'grow-0');
  before('size-4', 'h-6');
  before('truncate', 'whitespace-normal');
  before('line-clamp-2', 'block');
  before('rounded-lg', 'rounded-t-none');
  before('border', 'border-t-0');
  before('border-2', 'border-accent');
  before('shadow-md', 'shadow-accent/20');
  before('ring-2', 'ring-accent');
  before('bg-accent', 'from-accent');
  const v = css('disabled:opacity-50', 'group-hover:opacity-75', 'hover:opacity-100', 'focus:opacity-90');
  assert.ok(v.indexOf('hover\\:opacity-100') < v.indexOf('focus\\:opacity-90'));
  assert.ok(v.indexOf('focus\\:opacity-90') < v.indexOf('disabled\\:opacity-50'));
  assert.ok(v.indexOf('disabled\\:opacity-50') < v.indexOf('group-hover\\:opacity-75'));
});

test('bare kit component names defer to the kit; variant and important forms still generate', () => {
  for (const c of ['container', 'sr-only', 'table', 'list-item']) { assert.equal(css(c), '', c); assert.ok(supported(c), c); }
  let kit = [];
  try { kit = require('../lib/kit.cjs').KIT_CLASSES; } catch {}
  for (const c of kit) assert.equal(css(c), '', c);
  assert.equal(css('md:sr-only'), media('(min-width: 768px)', '.md\\:sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0, 0, 0, 0);clip-path:inset(50%);white-space:nowrap;border-width:0}'));
  assert.equal(css('md:not-sr-only'), media('(min-width: 768px)', '.md\\:not-sr-only{position:static;width:auto;height:auto;padding:0;margin:0;overflow:visible;clip:auto;clip-path:none;white-space:normal}'));
  assert.equal(css('md:table'), media('(min-width: 768px)', '.md\\:table{display:table}'));
  assert.equal(css('table-row'), '.table-row{display:table-row}');
  // !container: Tailwind's centred container, emitted before all utilities so they can override it
  const out = css('max-w-4xl', '!container');
  assert.ok(out.startsWith('.\\!container{width:100% !important;margin-right:auto !important;margin-left:auto !important}\n@media (min-width: 640px){\n.\\!container{max-width:640px !important}\n}'));
  assert.ok(out.endsWith('.max-w-4xl{max-width:56rem}'));
  assert.equal(out.match(/\.\\!container\{max-width/g).length, 5);
  assert.equal(supported('md:container'), false);
});

test('output is deterministic and de-duplicated regardless of input order', () => {
  const list = ['p-4', 'md:grid-cols-3', 'hover:bg-slate-100', 'bg-accent/10', 'space-y-4', 'border', 'ring-2', 'w-1/2', '-mt-2', 'lg:flex', 'text-sm', 'font-medium', 'animate-spin', 'from-accent', 'container'];
  const ref = utilityCSS(list);
  for (let n = 0; n < 8; n++) {
    const shuffled = [...list, ...list].sort(() => Math.random() - 0.5);
    assert.equal(utilityCSS(shuffled), ref);
    assert.equal(utilityCSS(new Set(shuffled)), ref);
  }
  assert.equal(utilityCSS(Array(1000).fill('p-4')), '.p-4{padding:1rem}');
  assert.equal(utilityCSS('p-4  m-2\np-4'), '.m-2{margin:0.5rem}\n.p-4{padding:1rem}');
  assert.equal(utilityCSS([]), '');
  assert.equal(utilityCSS(null), '');
  assert.equal(utilityCSS([42, null, {}, 'p-1']), '.p-1{padding:0.25rem}');
});

test('space-x/y and divide-x/y use the Tailwind child selectors', () => {
  const C = ' > :not([hidden]) ~ :not([hidden])';
  assert.equal(css('space-y-4'), `.space-y-4${C}{--tw-space-y-reverse:0;margin-top:calc(1rem * calc(1 - var(--tw-space-y-reverse)));margin-bottom:calc(1rem * var(--tw-space-y-reverse))}`);
  assert.equal(css('space-x-2'), `.space-x-2${C}{--tw-space-x-reverse:0;margin-right:calc(0.5rem * var(--tw-space-x-reverse));margin-left:calc(0.5rem * calc(1 - var(--tw-space-x-reverse)))}`);
  assert.match(css('-space-x-2'), /margin-left:calc\(-0\.5rem \* calc/);
  assert.equal(css('space-x-reverse'), `.space-x-reverse${C}{--tw-space-x-reverse:1}`);
  assert.equal(css('hover:space-x-1').split('{')[0], `.hover\\:space-x-1:hover${C}`);
  assert.equal(css('group-hover:space-y-1').split('{')[0], `.group:hover .group-hover\\:space-y-1${C}`);
  assert.equal(css('md:space-y-0'), media('(min-width: 768px)', `.md\\:space-y-0${C}{--tw-space-y-reverse:0;margin-top:calc(0px * calc(1 - var(--tw-space-y-reverse)));margin-bottom:calc(0px * var(--tw-space-y-reverse))}`));
  const d = css('divide-y', 'divide-border', 'divide-x-2', 'divide-dashed');
  assert.ok(d.includes(`.divide-y${C}{--tw-divide-y-reverse:0;border-top-width:calc(1px * calc(1 - var(--tw-divide-y-reverse)));border-bottom-width:calc(1px * var(--tw-divide-y-reverse));border-top-style:var(--tw-border-style, solid);border-bottom-style:var(--tw-border-style, solid)}`));
  assert.ok(d.includes(`.divide-x-2${C}{--tw-divide-x-reverse:0;border-right-width:calc(2px * var(--tw-divide-x-reverse));border-left-width:calc(2px * calc(1 - var(--tw-divide-x-reverse)));border-right-style:var(--tw-border-style, solid);border-left-style:var(--tw-border-style, solid)}`));
  assert.ok(d.includes(`.divide-border${C}{border-color:var(--border)}`));
  assert.ok(d.includes(`.divide-dashed${C}{--tw-border-style:dashed;border-style:dashed}`));
  assert.ok(d.startsWith(`@layer forma-preflight{:where(.divide-border${C},.divide-dashed${C},.divide-x-2${C},.divide-y${C}){--tw-border-style:solid;border-width:0;border-style:solid;border-color:var(--border, #e5e7eb)}`));
});

test('border utilities carry a layered preflight reset scoped to the elements that use them', () => {
  const out = css('border', 'hover:border-accent', 'p-4');
  assert.equal(out.split('\n')[0], '@layer forma-preflight{:where(.border,.hover\\:border-accent){--tw-border-style:solid;border-width:0;border-style:solid;border-color:var(--border, #e5e7eb)}:where(hr){border-top-width:1px}}');
  assert.ok(out.includes('.border{border-width:1px;border-style:var(--tw-border-style, solid)}'));
  assert.ok(out.includes('.hover\\:border-accent:hover{border-color:var(--accent)}'));
  assert.equal(css('border-x-2'), '@layer forma-preflight{:where(.border-x-2){--tw-border-style:solid;border-width:0;border-style:solid;border-color:var(--border, #e5e7eb)}:where(hr){border-top-width:1px}}\n.border-x-2{border-left-width:2px;border-right-width:2px;border-left-style:var(--tw-border-style, solid);border-right-style:var(--tw-border-style, solid)}');
  assert.ok(css('border-t').endsWith('.border-t{border-top-width:1px;border-top-style:var(--tw-border-style, solid)}'));
  assert.ok(css('border-0').endsWith('.border-0{border-width:0px;border-style:var(--tw-border-style, solid)}'));
  // a later border-style utility still wins over the solid set by width utilities
  const ds = css('border-dashed', 'border-2');
  assert.ok(ds.indexOf('.border-2{') < ds.indexOf('.border-dashed{'));
  assert.ok(css('border-t-accent/40').endsWith('.border-t-accent\\/40{border-top-color:color-mix(in oklab, var(--accent) 40%, transparent)}'));
  assert.ok(css('border-[3px]').endsWith('.border-\\[3px\\]{border-width:3px;border-style:var(--tw-border-style, solid)}'));
  assert.ok(css('border-[var(--line)]').endsWith('.border-\\[var\\(--line\\)\\]{border-color:var(--line)}'));
  assert.ok(css('border-dashed').endsWith('.border-dashed{--tw-border-style:dashed;border-style:dashed}'));
  assert.doesNotMatch(css('p-4', 'rounded-lg', 'shadow'), /:where|@layer/);
});

test('ring, shadow, transform and gradient utilities compose through --tw variables', () => {
  const ring = css('ring-2', 'ring-accent/40', 'ring-offset-2', 'ring-offset-surface');
  assert.ok(ring.startsWith('*,::before,::after{--tw-ring-inset: ;--tw-ring-offset-width:0px;'));
  assert.ok(ring.includes('.ring-2{--tw-ring-offset-shadow:var(--tw-ring-inset) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color);--tw-ring-shadow:var(--tw-ring-inset) 0 0 0 calc(2px + var(--tw-ring-offset-width)) var(--tw-ring-color);box-shadow:var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow, 0 0 #0000)}'));
  assert.ok(ring.includes('.ring-accent\\/40{--tw-ring-color:color-mix(in oklab, var(--accent) 40%, transparent)}'));
  assert.ok(ring.includes('.ring-offset-2{--tw-ring-offset-width:2px}'));
  assert.ok(ring.includes('.ring-offset-surface{--tw-ring-offset-color:var(--surface)}'));
  assert.ok(css('ring').includes('calc(3px + var(--tw-ring-offset-width))'));
  const sh = css('shadow-md');
  assert.ok(sh.endsWith('.shadow-md{--tw-shadow:0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);--tw-shadow-colored:0 4px 6px -1px var(--tw-shadow-color), 0 2px 4px -2px var(--tw-shadow-color);box-shadow:var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow)}'));
  for (const s of ['shadow-sm', 'shadow', 'shadow-lg', 'shadow-xl', 'shadow-2xl', 'shadow-inner', 'shadow-none']) assert.ok(supported(s), s);
  assert.ok(css('shadow-inner').includes('--tw-shadow:inset 0 2px 4px 0 rgb(0 0 0 / 0.05)'));
  assert.ok(css('shadow-accent/20').endsWith('.shadow-accent\\/20{--tw-shadow-color:color-mix(in oklab, var(--accent) 20%, transparent);--tw-shadow:var(--tw-shadow-colored)}'));
  const tf = css('-translate-y-1', 'hover:scale-105', 'rotate-45', '-translate-x-1/2');
  assert.ok(tf.startsWith('*,::before,::after{--tw-translate-x:0;--tw-translate-y:0;--tw-rotate:0;--tw-skew-x:0;--tw-skew-y:0;--tw-scale-x:1;--tw-scale-y:1;}'));
  assert.ok(tf.includes('.-translate-y-1{--tw-translate-y:-0.25rem;transform:translate(var(--tw-translate-x), var(--tw-translate-y)) rotate(var(--tw-rotate))'));
  assert.ok(tf.includes('.-translate-x-1\\/2{--tw-translate-x:-50%;'));
  assert.ok(tf.includes('.hover\\:scale-105:hover{--tw-scale-x:1.05;--tw-scale-y:1.05;'));
  const g = css('bg-gradient-to-r', 'from-accent', 'via-surface/50', 'to-accent-2');
  assert.ok(g.startsWith('*,::before,::after{--tw-gradient-from-position: ;--tw-gradient-via-position: ;--tw-gradient-to-position: ;}'));
  assert.ok(g.includes('.bg-gradient-to-r{background-image:linear-gradient(to right, var(--tw-gradient-stops))}'));
  assert.ok(g.includes('.from-accent{--tw-gradient-from:var(--accent) var(--tw-gradient-from-position);--tw-gradient-to:transparent var(--tw-gradient-to-position);--tw-gradient-stops:var(--tw-gradient-from), var(--tw-gradient-to)}'));
  assert.ok(g.includes('.via-surface\\/50{--tw-gradient-to:transparent var(--tw-gradient-to-position);--tw-gradient-stops:var(--tw-gradient-from), color-mix(in oklab, var(--surface) 50%, transparent) var(--tw-gradient-via-position), var(--tw-gradient-to)}'));
  assert.ok(g.includes('.to-accent-2{--tw-gradient-to:var(--accent-2) var(--tw-gradient-to-position)}'));
  assert.doesNotMatch(css('p-4', 'bg-accent'), /\*,::before/);
});

test('animations emit their keyframes once', () => {
  const out = css('animate-spin', 'md:animate-spin', 'animate-pulse');
  assert.equal(out.match(/@keyframes spin/g).length, 1);
  assert.equal(out.match(/@keyframes pulse/g).length, 1);
  assert.ok(out.includes('.animate-spin{animation:spin 1s linear infinite}'));
  assert.equal(supported('animate-wiggle'), false);
});

test('colour palette is the full Tailwind default palette 50-950 with real values', () => {
  const fams = ['slate', 'gray', 'zinc', 'neutral', 'stone', 'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose'];
  assert.deepEqual(Object.keys(PALETTE), fams);
  for (const f of fams) {
    assert.deepEqual(Object.keys(PALETTE[f]), ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950']);
    for (const h of Object.values(PALETTE[f])) assert.match(h, /^#[0-9a-f]{6}$/);
  }
  const spot = { 'slate-50': '#f8fafc', 'gray-900': '#111827', 'zinc-500': '#71717a', 'red-600': '#dc2626', 'amber-400': '#fbbf24', 'emerald-500': '#10b981', 'sky-950': '#082f49', 'blue-500': '#3b82f6', 'indigo-600': '#4f46e5', 'violet-700': '#6d28d9', 'rose-950': '#4c0519', 'neutral-950': '#0a0a0a', 'stone-200': '#e7e5e4', 'teal-700': '#0f766e' };
  for (const [k, hex] of Object.entries(spot)) assert.equal(css('bg-' + k), `.bg-${k}{background-color:${hex}}`);
  for (const t of SEMANTIC_COLORS) for (const p of ['bg', 'text', 'border', 'ring', 'fill', 'stroke', 'divide', 'outline', 'from', 'to', 'placeholder', 'decoration', 'shadow'])
    assert.ok(supported(`${p}-${t}`) && supported(`${p}-${t}/50`), `${p}-${t}`);
  assert.equal(css('text-text'), '.text-text{color:var(--text)}');
  assert.equal(css('border-black/5').split('\n').pop(), '.border-black\\/5{border-color:color-mix(in oklab, #000 5%, transparent)}');
  assert.equal(css('bg-transparent'), '.bg-transparent{background-color:transparent}');
  for (const bad of ['bg-slate-150', 'bg-slate-1000', 'bg-slate', 'bg-red', 'bg-accent-3', 'bg-accent/7', 'bg-accent/101', 'bg-accent/[1.5]', 'bg-accent/[120%]', 'bg-inherit/50', 'bg-accent/', 'text-constructor', 'bg-__proto__', 'bg-toString-500', 'bg-[red]', 'bg-[#12345]', 'bg-[#ggg]'])
    assert.equal(supported(bad), false, bad);
  assert.ok(supported('bg-accent/[0.15]') && supported('bg-accent/[15%]'));
});

test('grid-cols arbitrary values accept only a strict track grammar', () => {
  const ok = {
    'grid-cols-[repeat(auto-fit,minmax(16rem,1fr))]': 'repeat(auto-fit, minmax(16rem, 1fr))',
    'grid-cols-[repeat(auto-fill,minmax(min(100%,14rem),1fr))]': 'repeat(auto-fill, minmax(min(100%, 14rem), 1fr))',
    'grid-cols-[200px_1fr]': '200px 1fr',
    'grid-cols-[minmax(0,1fr)_320px]': 'minmax(0, 1fr) 320px',
    'grid-cols-[repeat(3,minmax(0,_1fr))]': 'repeat(3, minmax(0, 1fr))',
    'grid-rows-[auto_1fr_auto]': 'auto 1fr auto',
    'grid-cols-[var(--cols)]': 'var(--cols)',
    'grid-cols-[fit-content(20ch)_1fr]': 'fit-content(20ch) 1fr',
    'md:grid-cols-[16rem_minmax(0,1fr)]': '16rem minmax(0, 1fr)',
    'grid-cols-[repeat(auto-fit,minmax(clamp(10rem,30%,20rem),1fr))]': 'repeat(auto-fit, minmax(clamp(10rem, 30%, 20rem), 1fr))',
  };
  for (const [cls, v] of Object.entries(ok)) assert.ok(css(cls).includes(`{grid-template-${cls.includes('rows') ? 'rows' : 'columns'}:${v}}`), cls);
  for (const bad of ['grid-cols-[repeat(auto-fit,url(x))]', 'grid-cols-[1fr;color:red]', 'grid-cols-[repeat(0,1fr)]', 'grid-cols-[repeat(101,1fr)]', 'grid-cols-[repeat(auto-fit,minmax(16rem,1fr)]',
    'grid-cols-[calc(100%-1rem)_1fr]', 'grid-cols-[1fr_]', 'grid-cols-[_1fr]', 'grid-cols-[expression(alert(1))]', 'grid-cols-[minmax(1fr)]', 'grid-cols-[repeat(auto-fit)]', 'grid-cols-[red]',
    'grid-cols-[1fr__1fr]', 'grid-cols-[repeat(2,repeat(2,1fr))]', 'grid-cols-[]', 'grid-cols-13', 'grid-cols-0', 'grid-cols-[min(1px)]', 'grid-cols-[var(--a,1fr)]',
    'grid-cols-[minmax(1fr,2fr)]', 'grid-cols-[clamp(1rem,2rem)]', 'grid-cols-[min(1rem,2rem,3rem,4rem)]'])
    assert.equal(supported(bad), false, bad);
});

test('arbitrary values allow only lengths, percentages, numbers, #hex and var(--name)', () => {
  const hostile = ['p-[url(x)]', 'bg-[url(https://x.test/a.png)]', "bg-['red']", 'bg-["red"]', 'p-[1px;color:red]', 'p-[1px}body{color:red]', 'w-[calc(100%-2rem)]', 'p-[\\31px]',
    'text-[<script>]', 'bg-[@import]', 'w-[expression(alert(1))]', 'p-[var(--x,10px)]', 'p-[var(--)]', 'p-[var(--1x)]', 'p-[10]', 'p-[1e3px]', 'text-[length:url(x)]', 'bg-[color:url(x)]',
    '[mask-type:luminance]', '[color:red]', 'p-[18px', 'p-18px]', 'w-[--x]', 'bg-[rgb(0,0,0)]', 'bg-[hsl(0_0%_0%)]', 'p-[18PX]', 'p-[18px_2px]', 'opacity-[var(--o)]/50', 'p-[ 1px]',
    'w-[1px]]', 'w-[[1px]', 'top-[var(--url)]', 'h-[100vh-4rem]', 'z-[1.5]', 'col-span-[0]', 'rotate-[45px]', 'duration-[fast]', 'font-[bold]', 'aspect-[16/9/2]'];
  for (const c of hostile) assert.equal(supported(c), false, c);
  assert.equal(utilityCSS(hostile), '');
  for (const c of ['p-[0]', 'p-[.5rem]', 'm-[-4px]', 'w-[37.5%]', 'h-[50vh]', 'max-w-[72ch]', 'min-h-[100dvh]', 'rotate-[17deg]', 'duration-[0.3s]', 'opacity-[0.9]', 'leading-[22px]', 'aspect-[1.5]', 'bg-[#abc]', 'bg-[#abcd]', 'bg-[#AABBCCDD]', 'text-[color:var(--x)]'])
    assert.ok(supported(c), c);
});

test('injection attempts in class names never produce harmful CSS', () => {
  const html = `<div class="x}body{background:red} p-4"></div><div class='a{} b"c bg-accent/10'></div><p class="</style><script>alert(1)</script>"></p>
    <i class="md:p-[1px;}body{color:red] bg-[url(javascript:alert(1))] w-[expression(1)] p-[1px]/*x*/ [background:url(x)] hover:bg-[#fff;color:red] p-4\\;x"></i>
    <b class="@import a{} &#x7d;body&#x7b;color:red p-[18px]"></b>`;
  const classes = collectClasses(html);
  const out = utilityCSS(classes);
  assert.equal(out, '.bg-accent\\/10{background-color:color-mix(in oklab, var(--accent) 10%, transparent)}\n.p-4{padding:1rem}\n.p-\\[18px\\]{padding:18px}');
  for (const bad of ['<', '>', '"', "'", 'url(', '@import', 'expression', 'body', 'red', 'javascript', '/*', ';}']) assert.ok(!out.includes(bad), bad);
  const { unknown } = classifyClasses(classes);
  assert.ok(unknown.includes('x}body{background:red}') && unknown.includes('}body{color:red') && unknown.includes('</style><script>alert(1)</script>'));
  // every generated selector is a single escaped class (no unescaped specials, balanced braces)
  const many = [...Object.keys(EXACT), 'md:hover:bg-accent/10', 'grid-cols-[repeat(auto-fit,minmax(16rem,1fr))]', '2xl:p-4', '!font-bold', 'group-hover:text-accent', 'space-y-4'];
  const all = utilityCSS(many);
  assert.equal((all.match(/\{/g) || []).length, (all.match(/\}/g) || []).length);
  for (const c of many) assert.ok(all.includes('.' + escapeClass(c)), c);
  // very long or non-ASCII classes are ignored
  assert.equal(supported('p-4'.padEnd(200, 'x')), false);
  assert.equal(supported('p-４'), false);
  assert.equal(supported('p-4\u0000'), false);
});

test('fuzz: random and mutated class names keep the stylesheet well formed', () => {
  let seed = 0x5eed;
  const rnd = (n) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789-_:/.[]%#(),!{};<>@"\'`\\ *&=+~$^|?\u0000é';
  const base = [...Object.keys(EXACT), 'md:hover:bg-accent/10', 'grid-cols-[repeat(auto-fit,minmax(16rem,1fr))]', 'space-y-4', 'divide-y', 'ring-2', 'from-accent', 'container', 'group-hover:text-accent'];
  const list = [];
  for (let i = 0; i < 6000; i++) {
    if (i % 2) { let c = ''; const n = 1 + rnd(30); for (let k = 0; k < n; k++) c += chars[rnd(chars.length)]; list.push(c); continue; }
    const b = base[rnd(base.length)].split(''), m = 1 + rnd(3);
    for (let k = 0; k < m; k++) { const at = rnd(b.length + 1), op = rnd(3), ch = chars[rnd(chars.length)]; if (op === 0) b.splice(at, 0, ch); else if (op === 1) b.splice(at, 1); else b[at] = ch; }
    list.push(b.join(''));
  }
  const out = utilityCSS(list);
  assert.equal((out.match(/\{/g) || []).length, (out.match(/\}/g) || []).length);
  for (const line of out.split('\n')) {
    if (line === '}' || /^@media [^{}]+\{$/.test(line) || /^@keyframes [a-z]+\{/.test(line)) continue;
    if (line.startsWith('@layer forma-preflight{')) { assert.match(line, /^@layer forma-preflight\{:where\([^{}<>"'`@]+\)\{--tw-border-style:solid;border-width:0;border-style:solid;border-color:var\(--border, #e5e7eb\)\}:where\(hr\)\{border-top-width:1px\}\}$/); continue; }
    const i = line.indexOf('{'), body = line.slice(i + 1, -1);
    assert.ok(i > 0 && line.endsWith('}'), line);
    assert.doesNotMatch(body, /[{}<>"'`\\@]|url\(|\/\*|expression/i, line);
    for (const d of body.split(';').filter(Boolean)) assert.match(d, /^-{0,2}[a-z][a-z-]*: ?[^:;]*$/, line);
  }
  assert.doesNotMatch(out, /<|\/\*|url\(|expression/i);
  let kit = [];
  try { kit = require('../lib/kit.cjs').KIT_CLASSES; } catch {}
  const deferred = new Set(['container', 'sr-only', 'table', 'list-item', ...kit]);
  for (const c of classifyClasses(list).supported) assert.ok(out.includes(escapeClass(c)) || deferred.has(c) || /^dark:|:dark:|^(group|peer)$/.test(c), c);
});

test('escapeClass implements CSS.escape for the characters Tailwind classes use', () => {
  const cases = {
    'md:grid-cols-3': 'md\\:grid-cols-3', 'w-1/2': 'w-1\\/2', 'px-2.5': 'px-2\\.5', 'p-[18px]': 'p-\\[18px\\]', 'w-[50%]': 'w-\\[50\\%\\]', 'bg-[#fff]': 'bg-\\[\\#fff\\]',
    'grid-cols-[repeat(2,1fr)]': 'grid-cols-\\[repeat\\(2\\,1fr\\)\\]', '!p-4': '\\!p-4', '2xl:p-4': '\\32 xl\\:p-4', '-mt-2': '-mt-2', '-': '\\-', '-1': '-\\31 ', '_x': '_x', 'a\u0001': 'a\\1 ', 'é': 'é', 'a\u0000': 'a\uFFFD',
  };
  for (const [k, v] of Object.entries(cases)) assert.equal(escapeClass(k), v, k);
});

test('collectClasses parses class attributes robustly', () => {
  const html = `<div class="p-4  md:grid-cols-3\n\tbg-accent/10"><span class='hover:bg-slate-100 w-1/2'></span><p CLASS=text-lg>x</p>
    <i class="md&#58;p-8 a&amp;b &quot;q"></i><!-- <div class="commented"> --><script>var x = '<div class="scripted">'</script><style>.x{}</style>
    <svg class="size-4" viewBox="0 0 1 1"><path class="fill-current" d="M0 0"/></svg><div data-class="nope" class=""></div><img class=w-full alt="">
    <input class="placeholder:text-muted" placeholder="class=&quot;fake&quot;"><textarea class="resize-none"><b class="inside-textarea"></b></textarea></div>`;
  const got = collectClasses(html);
  for (const c of ['p-4', 'md:grid-cols-3', 'bg-accent/10', 'hover:bg-slate-100', 'w-1/2', 'text-lg', 'md:p-8', 'a&b', '"q', 'size-4', 'fill-current', 'w-full', 'placeholder:text-muted', 'resize-none'])
    assert.ok(got.has(c), c);
  for (const c of ['commented', 'scripted', 'nope', 'fake', 'inside-textarea', '']) assert.ok(!got.has(c), c);
  assert.deepEqual([...collectClasses(['<a class="x y">', '<b class="y z">'])], ['x', 'y', 'z']);
  for (const x of [null, undefined, 42, {}, '']) assert.equal(collectClasses(x).size, 0);
  assert.equal(collectClasses('<div class="unterminated p-4').size, 0, 'an unterminated tag is not an element');
});

test('classifyClasses splits supported from unknown, keeps input order and de-duplicates', () => {
  const r = classifyClasses(['p-4', 'card', 'btn-primary', 'md:grid-cols-3', 'p-4', 'foo', 'bg-accent/10', 'card']);
  assert.deepEqual(r, { supported: ['p-4', 'md:grid-cols-3', 'bg-accent/10'], unknown: ['card', 'btn-primary', 'foo'] });
  assert.deepEqual(classifyClasses(['p-4', 'card', 'btn'], new Set(['card'])), { supported: ['p-4', 'card'], unknown: ['btn'] });
  assert.deepEqual(classifyClasses('p-4 nope'), { supported: ['p-4'], unknown: ['nope'] });
  assert.deepEqual(classifyClasses(new Set(['m-auto', 'x'])), { supported: ['m-auto'], unknown: ['x'] });
  assert.deepEqual(classifyClasses(null), { supported: [], unknown: [] });
  for (const bad of ['-p-4', '-bg-accent', '-m-auto', '-z-auto', '-order-first', '-mt-[-2px]', 'p-13', 'p-0.25', 'w-1/7', 'top-1/5', 'text-10xl', 'font-heavy', 'rounded-4xl', 'shadow-3xl', 'z-5', 'opacity-7', 'line-clamp-7', 'P-4', 'flex-2', 'grid-col-3'])
    assert.equal(supported(bad), false, bad);
});

test('every family named in the spec is supported', () => {
  const sample = `block inline-block inline flex inline-flex grid inline-grid contents hidden flow-root static fixed absolute relative sticky inset-0 inset-x-0 inset-y-0 top-0 right-0 bottom-0 left-0 -left-2 start-4 end-4
    z-0 z-10 z-auto order-1 order-none col-auto col-span-1 col-span-12 col-start-1 col-end-13 row-auto row-span-1 row-span-full row-start-2 row-end-3 grid-cols-1 grid-cols-12 grid-rows-1 grid-rows-12 grid-flow-col grid-flow-row-dense auto-cols-fr auto-rows-min
    gap-0 gap-px gap-x-4 gap-y-8 space-x-4 space-y-2 -space-y-px divide-x divide-y divide-x-0 divide-y-4 divide-y-reverse divide-slate-200 p-0 px-4 py-2 pt-1 pr-2 pb-3 pl-4 ps-2 pe-2 m-0 mx-auto my-8 mt-4 mr-2 mb-6 ml-1 ms-2 me-2 -ml-px
    w-0 w-px w-auto w-1/4 w-full w-screen w-min w-max w-fit h-0 h-full h-screen h-svh h-dvh h-fit size-full size-10 min-w-0 min-w-full min-w-fit min-h-0 min-h-screen min-h-full max-w-none max-w-xs max-w-7xl max-w-full max-w-prose max-w-screen-2xl max-h-96 max-h-screen max-h-none
    text-xs text-sm text-base text-lg text-xl text-2xl text-3xl text-4xl text-5xl text-6xl text-7xl text-8xl text-9xl font-thin font-extralight font-light font-normal font-medium font-semibold font-bold font-extrabold font-black font-sans font-serif font-mono font-display
    leading-none leading-snug leading-normal leading-relaxed leading-loose leading-3 leading-10 tracking-tighter tracking-normal tracking-wide tracking-wider text-left text-right text-justify text-start text-end truncate text-ellipsis line-clamp-1 line-clamp-6 line-clamp-none
    uppercase lowercase capitalize normal-case italic not-italic underline overline line-through no-underline underline-offset-4 decoration-2 whitespace-normal whitespace-pre whitespace-pre-line whitespace-pre-wrap whitespace-break-spaces break-normal break-all break-keep text-balance text-pretty antialiased
    list-none list-disc list-decimal list-inside align-middle bg-accent text-muted border-border bg-surface text-on-accent bg-background text-text border-accent-2 bg-success text-warning text-danger bg-accent-soft text-accent-strong bg-white bg-black bg-transparent text-current
    fill-accent stroke-current ring-accent border border-0 border-2 border-4 border-8 border-x border-y border-t border-r border-b border-l border-s border-e border-solid border-dashed border-dotted border-none border-collapse border-separate
    rounded-none rounded-sm rounded rounded-md rounded-lg rounded-xl rounded-2xl rounded-3xl rounded-full rounded-t-lg rounded-b-none rounded-l-md rounded-r-md rounded-s-lg rounded-e-lg rounded-tl-lg rounded-br-xl rounded-ss-md
    shadow-sm shadow shadow-md shadow-lg shadow-xl shadow-2xl shadow-inner shadow-none ring ring-0 ring-1 ring-2 ring-4 ring-8 ring-inset ring-offset-0 ring-offset-2 ring-offset-white outline outline-2 outline-offset-2 outline-accent outline-dashed
    opacity-0 opacity-25 opacity-100 overflow-auto overflow-clip overflow-visible overflow-scroll overflow-y-auto overflow-x-hidden overscroll-contain object-contain object-fill object-none object-scale-down object-center object-top aspect-auto
    transition transition-all transition-opacity transition-shadow transition-transform transition-none duration-75 duration-1000 delay-150 ease-linear ease-in ease-in-out translate-x-4 translate-y-full -translate-y-1/2 rotate-90 -rotate-3 scale-95 scale-x-100 skew-x-3 origin-center transform transform-gpu transform-none
    cursor-auto cursor-default cursor-wait cursor-text cursor-move cursor-grab select-text select-all select-auto pointer-events-auto resize resize-none appearance-none visible invisible collapse isolate float-right clear-both box-border box-content
    flex-row flex-row-reverse flex-col-reverse flex-wrap flex-nowrap flex-auto flex-initial grow-0 shrink basis-0 basis-1/2 basis-full basis-auto justify-start justify-end justify-center justify-around justify-evenly justify-stretch justify-items-center
    items-start items-end items-baseline items-stretch content-center content-start content-around self-auto self-start self-center self-stretch self-baseline place-content-center place-content-between place-items-start place-self-center justify-self-auto
    sr-only not-sr-only container group peer bg-gradient-to-br from-slate-50 via-white to-accent/5 bg-none bg-cover bg-center bg-no-repeat indent-4 columns-2 table-fixed blur backdrop-blur-md grayscale accent-accent tabular-nums slashed-zero`;
  const { unknown } = classifyClasses(sample);
  assert.deepEqual(unknown, []);
});

test('UTILITY_REFERENCE is a compact prompt naming the families and semantic colours', () => {
  assert.equal(typeof UTILITY_REFERENCE, 'string');
  assert.ok(UTILITY_REFERENCE.length <= 2400, `${UTILITY_REFERENCE.length} chars`);
  for (const s of ['bg-accent/10', 'text-muted', 'border-border', 'text-on-accent', 'surface', 'md:', 'hover:', 'group-hover:', 'grid-cols-[repeat(auto-fit,minmax(16rem,1fr))]', 'var(--name)', 'dark:', 'space-y-', 'line-clamp'])
    assert.ok(UTILITY_REFERENCE.includes(s), s);
  // every concrete example class in the reference is real
  const examples = UTILITY_REFERENCE.split(/\s+/).map((t) => t.replace(/^\(+/, '').replace(/[),.]+$/, ''))
    .filter((t) => /^!?-?[a-z][a-z0-9]*-/.test(t) && /[\d[/]/.test(t) && !/[…*]|:$/.test(t) && !SEMANTIC_COLORS.includes(t));
  assert.ok(examples.length >= 15, String(examples.length));
  assert.deepEqual(examples.filter((c) => !supported(c)), []);
});

test('review: every colour variable the kit defines is a usable token', () => {
  let vars = [];
  try { const k = require('../lib/kit.cjs'); vars = k.tokensCSS(k.normalizeTokens({})).match(/--[a-z0-9-]+(?=:)/g).map((v) => v.slice(2)); } catch {}
  for (const t of ['surface-2', 'border-strong', 'info', 'success-soft', 'success-strong', 'warning-soft', 'warning-strong', 'danger-soft', 'danger-strong', 'info-soft', 'info-strong', 'on-danger', 'accent-hover', 'chart-1', 'chart-6']) {
    assert.ok(SEMANTIC_COLORS.includes(t), t);
    if (vars.length) assert.ok(vars.includes(t), `kit defines --${t}`);
  }
  assert.equal(css('bg-surface-2'), '.bg-surface-2{background-color:var(--surface-2)}');
  assert.equal(css('text-danger-strong'), '.text-danger-strong{color:var(--danger-strong)}');
  assert.equal(css('bg-info-soft/50'), '.bg-info-soft\\/50{background-color:color-mix(in oklab, var(--info-soft) 50%, transparent)}');
  assert.equal(css('fill-chart-3'), '.fill-chart-3{fill:var(--chart-3)}');
  assert.ok(css('border-border-strong').endsWith('.border-border-strong{border-color:var(--border-strong)}'));
  assert.ok(css('border-t-info').endsWith('.border-t-info{border-top-color:var(--info)}'));
  for (const bad of ['bg-surface-3', 'bg-chart-7', 'text-info-medium', 'border-strong', 'bg-glow']) assert.equal(supported(bad), false, bad);
});

test('review: not-sr-only undoes clip-path too, so kit sr-only skip links appear on focus', () => {
  assert.ok(css('focus:not-sr-only').includes('clip:auto;clip-path:none;'));
  assert.ok(css('md:sr-only').includes('clip:rect(0, 0, 0, 0);clip-path:inset(50%);'));
});

test('review: arbitrary values the browser would drop are unknown, not silently "supported"', () => {
  // negative values only where CSS accepts them
  for (const bad of ['p-[-4px]', 'px-[-1rem]', 'w-[-10px]', 'h-[-1px]', 'size-[-2px]', 'min-w-[-1px]', 'max-w-[-1px]', 'basis-[-1px]', 'gap-[-2px]', 'gap-x-[-1px]', 'text-[-12px]', 'text-sm/[-1]',
    'leading-[-1]', 'rounded-[-4px]', 'rounded-t-[-1px]', 'border-[-1px]', 'border-t-[-2px]', 'divide-y-[-1px]', 'outline-[-1px]', 'decoration-[-1px]', 'stroke-[-1]', 'blur-[-2px]',
    'backdrop-blur-[-1px]', 'grow-[-1]', 'shrink-[-1]', 'line-clamp-[0]', 'line-clamp-[-2]', 'columns-[0]', 'columns-[-1rem]', 'col-start-[0]', 'row-end-[0]',
    // percentages only where CSS accepts them
    'border-[50%]', 'border-t-[10%]', 'divide-x-[10%]', 'outline-[10%]', 'outline-offset-[10%]', 'ring-[50%]', 'ring-offset-[10%]', 'tracking-[10%]', 'blur-[10%]', 'backdrop-blur-[5%]',
    'columns-[50%]', 'border-[percentage:50%]'])
    assert.equal(supported(bad), false, bad);
  for (const ok of ['rounded-[50%]', 'text-[120%]', 'w-[50%]', 'leading-[150%]', 'indent-[5%]', 'translate-x-[50%]', 'decoration-[10%]', 'underline-offset-[10%]', 'border-[length:3px]', 'ring-[3px]', 'tracking-[0.1em]'])
    assert.ok(supported(ok), ok);
  for (const ok of ['m-[-4px]', '-m-[4px]', 'top-[-10px]', 'inset-x-[-1rem]', 'tracking-[-0.02em]', 'indent-[-1em]', 'z-[-1]', 'order-[-1]', 'col-start-[-1]', 'row-end-[-2]', 'translate-x-[-10px]',
    'outline-offset-[-2px]', 'underline-offset-[-1px]', 'scale-[-1]', 'rotate-[-45deg]', 'space-x-[-4px]', 'line-clamp-[8]', 'columns-[3]', 'columns-[16rem]', 'w-[var(--w)]', 'line-clamp-[var(--n)]'])
    assert.ok(supported(ok), ok);
});

// auto-fit/auto-fill need fixed-size tracks, appear once, and only beside fixed-size tracks; no negative sizes.
// The browser test checks that Chromium agrees with both lists.
const GRID_BAD = ['repeat(auto-fit,1fr)', 'repeat(auto-fill,auto)', 'repeat(auto-fill,minmax(auto,1fr))', 'repeat(auto-fit,min-content)', 'repeat(auto-fit,fit-content(10rem))',
  'repeat(auto-fit,minmax(10rem,1fr))_auto', 'repeat(auto-fit,10rem)_repeat(auto-fill,10rem)', 'repeat(2,1fr)_repeat(auto-fit,10rem)', 'repeat(auto-fit,minmax(10rem,1fr))_1fr', '-1rem_1fr',
  'minmax(-1px,1fr)', 'repeat(3,-2rem)', 'min(1fr,2rem)', 'minmax(1fr,2fr)', 'repeat(auto-fit,minmax(1rem,1fr))_fit-content(4rem)'];
const GRID_OK = ['repeat(auto-fit,minmax(10rem,1fr))_10rem', 'repeat(auto-fit,minmax(min-content,10rem))', 'repeat(auto-fill,minmax(0,1fr))', 'repeat(auto-fit,minmax(10rem,max-content))',
  'repeat(auto-fit,minmax(min(100%,14rem),1fr))', 'repeat(3,auto)', '16rem_repeat(auto-fill,minmax(8rem,12rem))', 'auto_1fr_auto', 'fit-content(20ch)_minmax(0,1fr)', 'repeat(2,minmax(0,1fr)_2rem)',
  'clamp(10rem,30%,20rem)_1fr', 'max(10rem,20%)_repeat(auto-fit,minmax(6rem,1fr))', 'minmax(auto,1fr)_min-content'];
test('review: grid templates follow the CSS Grid validity rules', () => {
  for (const bad of GRID_BAD) assert.equal(supported(`grid-cols-[${bad}]`), false, bad);
  for (const ok of [...GRID_OK, 'repeat(auto-fit,minmax(var(--min),1fr))', 'repeat(auto-fit,var(--track))']) assert.ok(supported(`grid-cols-[${ok}]`), ok);
  // grid-auto-columns/rows take track sizes, never repeat()
  assert.equal(css('auto-rows-[minmax(4rem,auto)]'), '.auto-rows-\\[minmax\\(4rem\\,auto\\)\\]{grid-auto-rows:minmax(4rem, auto)}');
  assert.equal(css('auto-cols-[200px]'), '.auto-cols-\\[200px\\]{grid-auto-columns:200px}');
  assert.equal(css('auto-cols-[minmax(0,1fr)_auto]'), '.auto-cols-\\[minmax\\(0\\,1fr\\)_auto\\]{grid-auto-columns:minmax(0, 1fr) auto}');
  for (const bad of ['auto-cols-[repeat(2,1fr)]', 'auto-rows-3', 'auto-rows-none', 'auto-cols-[url(x)]']) assert.equal(supported(bad), false, bad);
});

test('review: border style survives responsive and state width classes; filters compose', () => {
  const out = css('border-dotted', 'md:border', 'hover:border-2');
  assert.ok(out.includes('.border-dotted{--tw-border-style:dotted;border-style:dotted}'));
  assert.ok(out.includes('.md\\:border{border-width:1px;border-style:var(--tw-border-style, solid)}'));
  assert.ok(out.includes('.hover\\:border-2:hover{border-width:2px;border-style:var(--tw-border-style, solid)}'));
  // the reset re-initialises --tw-border-style on every bordered element, so it never inherits
  assert.match(out, /^@layer forma-preflight\{:where\([^)]*\)\{--tw-border-style:solid;/);
  const f = css('blur-sm', 'grayscale', 'hover:grayscale-0');
  assert.ok(f.startsWith('*,::before,::after{--tw-blur: ;--tw-grayscale: ;}'));
  assert.ok(f.includes('.blur-sm{--tw-blur:blur(4px);filter:var(--tw-blur) var(--tw-grayscale)}'));
  assert.ok(f.includes('.grayscale{--tw-grayscale:grayscale(100%);filter:var(--tw-blur) var(--tw-grayscale)}'));
  assert.ok(f.includes('.hover\\:grayscale-0:hover{--tw-grayscale:grayscale(0);filter:var(--tw-blur) var(--tw-grayscale)}'));
  assert.equal(escapeClass(null), '');
  assert.equal(escapeClass(42), '\\34 2');
});

test('performance: 5000 distinct classes in under 200 ms', () => {
  const vars = ['', 'hover:', 'focus:', 'md:', 'lg:', 'sm:', 'xl:', '2xl:', 'md:hover:', 'group-hover:', 'disabled:', 'focus-visible:', 'lg:hover:', 'first:', 'odd:'];
  const utils = [];
  for (const k of Object.keys({ ...{ 0: 1, px: 1, 0.5: 1, 1: 1, 1.5: 1, 2: 1, 2.5: 1, 3: 1, 4: 1, 5: 1, 6: 1, 8: 1, 10: 1, 12: 1, 16: 1, 20: 1, 24: 1, 32: 1, 48: 1, 64: 1, 96: 1 } }))
    for (const p of ['p', 'px', 'py', 'pt', 'm', 'mx', 'mt', '-mt', 'gap', 'w', 'h', 'space-y', 'top', 'inset-x']) utils.push(`${p}-${k}`);
  for (const f of Object.keys(PALETTE)) for (const s of ['100', '500', '900']) for (const p of ['bg', 'text', 'border']) utils.push(`${p}-${f}-${s}`, `${p}-${f}-${s}/50`);
  const all = [];
  for (const v of vars) for (const u of utils) all.push(v + u);
  const classes = all.slice(0, 5000);
  assert.equal(new Set(classes).size, 5000);
  // Two cold-cache runs (the '!' forms are distinct, unresolved classes). The budget applies to the work
  // done on this thread (CPU time), so parallel test files competing for cores cannot make it flaky.
  const cpu = () => { const u = (process.threadCpuUsage || process.cpuUsage)(); return (u.user + u.system) / 1000; };
  const time = (f) => { const c = cpu(), w = performance.now(), r = f(); return { r, cpu: cpu() - c, wall: performance.now() - w }; };
  const a = time(() => utilityCSS(classes)), b = time(() => utilityCSS(classes.map((c) => c.replace(/([^:]+)$/, '!$1'))));
  const out = a.r, ms = Math.min(a.cpu, b.cpu);
  assert.ok(ms < 200, `${ms.toFixed(1)} ms CPU (wall ${a.wall.toFixed(1)} / ${b.wall.toFixed(1)} ms)`);
  assert.ok(out.length > 100000);
  assert.ok(classifyClasses(classes).unknown.length === 0);
  const junk = Array.from({ length: 5000 }, (_, i) => `x${i}-${'[a;b]'.repeat(i % 7)}-q:${i}`);
  const j = time(() => utilityCSS(junk));
  assert.equal(j.r, '');
  assert.ok(j.cpu < 200, `unknown classes are rejected quickly (${j.cpu.toFixed(1)} ms CPU)`);
});

let chromium = null;
try { ({ chromium } = require('playwright')); } catch {}
const exe = process.env.BROWSER_EXECUTABLE;
const browserReady = !!chromium && (exe ? fs.existsSync(exe) : (() => { try { return fs.existsSync(chromium.executablePath()); } catch { return false; } })());

test('generated CSS applies in a real Chromium', { skip: !browserReady && 'Chromium is not available', timeout: 90000 }, async () => {
  const browser = await chromium.launch({ headless: true, ...(exe ? { executablePath: exe } : {}), args: ['--disable-dev-shm-usage'] });
  try {
    const body = `<div id="grid" class="grid md:grid-cols-3 gap-4"><div>a</div><div>b</div><div>c</div></div>
      <div id="parent" class="w-[400px]"><div id="half" class="w-1/2">x</div></div>
      <div id="tint" class="bg-accent/10">t</div><div id="hov" class="hover:bg-slate-100">h</div>
      <div id="pad" class="p-[18px]"></div><div id="neg" class="-mt-2"></div>
      <div id="stack" class="space-y-4"><p id="first">a</p><p id="second">b</p><p hidden>c</p></div>
      <div id="big" class="2xl:p-4"></div><div class="group"><span id="gh" class="group-hover:text-accent">g</span></div>
      <input id="ph" class="placeholder:text-muted" placeholder="x"><div id="div" class="divide-y divide-border"><div id="d1">a</div><div id="d2">b</div></div>
      <div id="ring" class="ring-2 ring-accent shadow-md">r</div><div id="trunc" class="truncate w-[60px]">a long line of text here</div>
      <div id="imp" class="p-2 !p-6 p-8"></div><div id="tf" class="-translate-y-1 scale-105">t</div><div id="bord" class="border border-accent rounded-lg">b</div>
      <div id="clamp" class="line-clamp-2 w-[80px]">one two three four five six seven eight nine ten</div><div id="sr" class="sr-only">sr</div>
      <div id="auto" class="grid grid-cols-[repeat(auto-fit,minmax(100px,1fr))] w-[400px]"><i>1</i><i>2</i><i>3</i></div><div id="vid" class="aspect-video w-[160px]"></div>
      <div id="frac" class="flex"><div id="third" class="basis-1/3 shrink-0">x</div></div><div id="grad" class="bg-gradient-to-r from-accent to-accent-2 h-4"></div>
      <div id="inj" class="x}body{background:red} p-[1px;}body{color:red]">i</div><div id="kit" class="list-item container">k</div>
      <div id="kcard" class="card border-accent">c</div><button id="kbtn" class="border border-border">b</button><div id="bt" class="border-t">t</div><div id="dash" class="border-dashed">d</div><hr id="hr" class="border-accent">
      <a id="skip" href="#main" class="sr-only focus:not-sr-only focus:p-2">Skip to content</a><div id="dot" class="border-dotted md:border">d</div>
      <div id="outer" class="border-dashed border"><span id="inner" class="border">i</span></div><div id="filt" class="blur-sm grayscale">f</div><div id="s2" class="bg-surface-2 text-danger-strong">s</div>`;
    const classes = collectClasses(body);
    const sheet = utilityCSS(classes);
    const page = await (await browser.newContext({ viewport: { width: 1024, height: 800 } })).newPage();
    await page.setContent(`<!doctype html><html><head><style>:root{--accent:#4f46e5;--accent-2:#0891b2;--surface:#ffffff;--border:#e4e4e7;--muted:#5f5f69;--background:#fafafa;--text:#18181b;--radius:8px;--radius-lg:12px;--radius-sm:4px;--surface-2:#f4f4f5;--danger-strong:#b91c1c}body,p{margin:0}:where(.list-item){display:flex}:where(.container){max-width:300px;margin-inline:auto}:where(.sr-only){position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}:where(.card){border:1px solid #e4e4e7}:where(button){border:0}</style><style>${sheet}</style></head><body>${body}</body></html>`);
    const cs = (sel, prop, pseudo) => page.evaluate(([s, p, ps]) => getComputedStyle(document.querySelector(s), ps || null)[p], [sel, prop, pseudo]);
    assert.equal((await cs('#grid', 'gridTemplateColumns')).split(' ').length, 3, 'md:grid-cols-3 at 1024px');
    assert.equal(await cs('#half', 'width'), '200px');
    const tint = await cs('#tint', 'backgroundColor');
    assert.notEqual(tint, 'rgba(0, 0, 0, 0)');
    assert.match(tint, /\/ 0\.1\)$|, 0\.1\)$/, tint);
    assert.equal(await cs('#hov', 'backgroundColor'), 'rgba(0, 0, 0, 0)');
    await page.hover('#hov');
    assert.equal(await cs('#hov', 'backgroundColor'), 'rgb(241, 245, 249)');
    assert.equal(await cs('#pad', 'paddingTop'), '18px');
    assert.equal(await cs('#neg', 'marginTop'), '-8px');
    assert.equal(await cs('#first', 'marginTop'), '0px');
    assert.equal(await cs('#second', 'marginTop'), '16px');
    assert.equal(await cs('#big', 'paddingTop'), '0px');
    assert.equal(await cs('#gh', 'color'), 'rgb(0, 0, 0)');
    await page.hover('#gh');
    assert.equal(await cs('#gh', 'color'), 'rgb(79, 70, 229)');
    assert.equal(await cs('#ph', 'color', '::placeholder'), 'rgb(95, 95, 105)');
    assert.equal(await cs('#d1', 'borderTopWidth'), '0px');
    assert.equal(await cs('#d2', 'borderTopWidth'), '1px');
    assert.equal(await cs('#d2', 'borderTopStyle'), 'solid');
    assert.equal(await cs('#d2', 'borderTopColor'), 'rgb(228, 228, 231)');
    const ring = await cs('#ring', 'boxShadow');
    assert.match(ring, /rgb\(79, 70, 229\) 0px 0px 0px 2px/, ring);
    assert.match(ring, /rgba\(0, 0, 0, 0\.1\) 0px 4px 6px -1px/, ring);
    assert.equal(await cs('#trunc', 'textOverflow'), 'ellipsis');
    assert.equal(await cs('#trunc', 'whiteSpace'), 'nowrap');
    assert.equal(await cs('#imp', 'paddingTop'), '24px', 'important wins over later utilities');
    assert.match(await cs('#tf', 'transform'), /^matrix\(1\.05, 0, 0, 1\.05, 0, -4\)$/);
    assert.equal(await cs('#bord', 'borderTopWidth'), '1px');
    assert.equal(await cs('#bord', 'borderTopColor'), 'rgb(79, 70, 229)');
    assert.equal(await cs('#bord', 'borderTopLeftRadius'), '12px');
    assert.equal(await cs('#clamp', 'webkitLineClamp'), '2');
    assert.equal(await cs('#sr', 'position'), 'absolute');
    assert.equal(await cs('#sr', 'width'), '1px');
    assert.equal((await cs('#auto', 'gridTemplateColumns')).split(' ').length, 4, 'auto-fit makes 4 tracks of >=100px in 400px');
    assert.equal(await cs('#vid', 'height'), '90px');
    assert.match(await cs('#grad', 'backgroundImage'), /^linear-gradient\(to right, rgb\(79, 70, 229\), rgb\(8, 145, 178\)\)$/);
    assert.equal(await cs('#kit', 'display'), 'flex', 'kit :where(.list-item) is not overridden by a utility');
    assert.equal(await cs('#kit', 'maxWidth'), '300px', 'kit :where(.container) is not overridden by a utility');
    // border utilities on kit components and plain elements (the preflight reset sits in a cascade layer)
    assert.equal(await cs('#kcard', 'borderTopWidth'), '1px', 'card border-accent keeps the kit border width');
    assert.equal(await cs('#kcard', 'borderTopStyle'), 'solid');
    assert.equal(await cs('#kcard', 'borderTopColor'), 'rgb(79, 70, 229)');
    assert.equal(await cs('#kbtn', 'borderTopWidth'), '1px', 'border works on a button the kit resets with border:0');
    assert.equal(await cs('#kbtn', 'borderTopStyle'), 'solid');
    assert.equal(await cs('#kbtn', 'borderTopColor'), 'rgb(228, 228, 231)');
    assert.equal(await cs('#bt', 'borderTopWidth'), '1px');
    assert.equal(await cs('#bt', 'borderTopColor'), 'rgb(228, 228, 231)', 'default border colour is --border');
    assert.equal(await cs('#bt', 'borderBottomWidth'), '0px');
    assert.equal(await cs('#dash', 'borderTopWidth'), '0px', 'border-dashed alone draws nothing, as in Tailwind');
    assert.equal(await cs('#hr', 'borderTopWidth'), '1px');
    assert.equal(await cs('#hr', 'borderTopColor'), 'rgb(79, 70, 229)');
    // review regressions: skip link, border style kept by responsive widths, no inheritance, filters compose, kit tokens
    assert.equal(await cs('#skip', 'clipPath'), 'inset(50%)');
    await page.focus('#skip');
    assert.equal(await cs('#skip', 'clipPath'), 'none', 'focus:not-sr-only undoes the kit clip-path');
    assert.ok(await page.evaluate(() => document.querySelector('#skip').getBoundingClientRect().width > 50), 'skip link is visible when focused');
    assert.equal(await cs('#dot', 'borderTopStyle'), 'dotted', 'border-dotted md:border stays dotted');
    assert.equal(await cs('#dot', 'borderTopWidth'), '1px');
    assert.equal(await cs('#outer', 'borderTopStyle'), 'dashed');
    assert.equal(await cs('#inner', 'borderTopStyle'), 'solid', 'border style does not inherit from a dashed parent');
    assert.equal(await cs('#filt', 'filter'), 'blur(4px) grayscale(1)');
    assert.equal(await cs('#s2', 'backgroundColor'), 'rgb(244, 244, 245)');
    assert.equal(await cs('#s2', 'color'), 'rgb(185, 28, 28)');
    // the grid-template rules agree with Chromium's parser in both directions
    const tpl = (t) => t.replace(/,/g, ', ').replace(/_/g, ' ');
    assert.deepEqual(await page.evaluate((l) => l.filter((v) => !CSS.supports('grid-template-columns', v)), GRID_OK.map(tpl)), []);
    assert.deepEqual(await page.evaluate((l) => l.filter((v) => CSS.supports('grid-template-columns', v)), GRID_BAD.map(tpl)), []);
    for (const t of GRID_OK) assert.ok(css(`grid-cols-[${t}]`).includes(`{grid-template-columns:${tpl(t).replace(/, _?/g, ', ')}}`), t);
    assert.equal(await cs('body', 'backgroundColor'), 'rgba(0, 0, 0, 0)', 'injection did not style body');
    assert.equal(await cs('body', 'color'), 'rgb(0, 0, 0)');
    // narrow viewport: mobile-first base applies, md: does not
    await page.setViewportSize({ width: 600, height: 800 });
    assert.equal((await cs('#grid', 'gridTemplateColumns')).split(' ').length, 1, 'single implicit column below md');
    assert.equal(await cs('#dot', 'borderTopWidth'), '0px', 'below md the dotted border has no width');
    await page.setViewportSize({ width: 1600, height: 800 });
    assert.equal(await cs('#big', 'paddingTop'), '16px', '2xl: applies at 1600px');
    // escapeClass matches the browser's CSS.escape
    const names = ['md:grid-cols-3', 'w-1/2', 'bg-accent/10', 'p-[18px]', '-mt-2', '2xl:p-4', '!font-bold', 'grid-cols-[repeat(auto-fit,minmax(16rem,1fr))]', 'bg-[#0f766e]', 'w-[33.5%]', '-', '-1x', '1', '_a', 'a\u0001b', 'é', 'a\u0000b', '--x', 'a b'];
    assert.deepEqual(await page.evaluate((n) => n.map((x) => CSS.escape(x)), names), names.map(escapeClass));
    // every rule parses, and every literal declaration is a valid value for its property
    const wide = classifyClasses(fs.readFileSync(__filename, 'utf8').match(/[!\w:/.[\]%#(),-]+/g)).supported.filter((c) => c !== 'container');
    const big = utilityCSS(wide);
    const parsed = await page.evaluate((text) => {
      const s = new CSSStyleSheet(); s.replaceSync(text);
      const flat = (rules) => [...rules].flatMap((r) => (r instanceof CSSMediaRule ? flat(r.cssRules) : [r]));
      const layer = [...s.cssRules].find((r) => r instanceof CSSLayerBlockRule);
      return flat(s.cssRules).length + (layer && layer.cssRules.length === 2 ? 0 : 1000);
    }, big);
    const expected = big.split('\n').filter((l) => l.includes('{') && l.endsWith('}')).length;
    assert.equal(parsed, expected, 'all generated rules parse');
    const decls = [...new Set(big.split('\n').filter((l) => l.includes('{') && l.endsWith('}') && !l.startsWith('@')).flatMap((l) => l.slice(l.indexOf('{') + 1, -1).split(';')))]
      .map((d) => { const i = d.indexOf(':'); return [d.slice(0, i), d.slice(i + 1).replace(/ !important$/, '')]; })
      .filter(([p]) => p && !p.startsWith('--') && !p.startsWith('-moz-') && p !== '-webkit-backdrop-filter'); // Firefox/Safari-only prefixes
    const invalid = await page.evaluate((list) => list.filter(([p, v]) => !CSS.supports(p, v)), decls);
    assert.deepEqual(invalid, []);
    assert.ok(wide.length > 300, `checked ${wide.length} classes`);
    // sweep: every literal declaration produced for prefix x arbitrary-value combinations is valid CSS
    const prefixes = 'p mx inset top z order col-span col-start line-clamp aspect size w min-h max-w shrink grow basis translate-x rotate scale columns auto-rows gap space-x divide-x divide rounded rounded-tl border border-t bg from fill stroke indent font text leading tracking decoration underline-offset placeholder caret accent opacity shadow outline outline-offset ring ring-offset blur backdrop-blur duration delay'.split(' ');
    const vals = ['0', '-1', '1.5', '.5', '1000', '999999', '0px', '10px', '-10px', '50%', '-50%', '1rem', '-1rem', '1ch', '1dvh', '1cqw', '45deg', '1turn', '0.3s', '300ms', '#fff', '#ffff', '#ffffff80', '4/3', 'length:10px', 'length:-1px', 'color:#fff', 'number:2', 'percentage:50%'];
    const sweep = classifyClasses(prefixes.flatMap((p) => vals.flatMap((v) => [`${p}-[${v}]`, `-${p}-[${v}]`]))).supported;
    const literal = [...new Set(utilityCSS(sweep).split('\n').filter((l) => l.includes('{') && l.endsWith('}') && !/^[@*]/.test(l)).flatMap((l) => l.slice(l.indexOf('{') + 1, -1).split(';')))]
      .map((d) => { const i = d.indexOf(':'); return [d.slice(0, i), d.slice(i + 1)]; }).filter(([p, v]) => !p.startsWith('--') && p !== '-webkit-backdrop-filter' && !v.includes('var('));
    assert.ok(sweep.length > 400 && literal.length > 250, `${sweep.length} classes, ${literal.length} declarations`);
    assert.deepEqual(await page.evaluate((list) => list.filter(([p, v]) => !CSS.supports(p, v)), literal), []);
    // with the real kit stylesheet (when the kit module is present): kit tokens resolve and skip links work
    let kit = null;
    try { kit = require('../lib/kit.cjs'); } catch {}
    if (kit?.kitCSS) {
      const kbody = `<a id="skip" href="#m" class="sr-only focus:not-sr-only focus:absolute focus:p-3">Skip to content</a><main id="m"><div id="c" class="card p-0 bg-surface-2"><p id="t" class="text-danger-strong border-t border-border-strong">x</p></div></main>`;
      const kpage = await (await browser.newContext({ viewport: { width: 1024, height: 800 } })).newPage();
      await kpage.setContent(`<!doctype html><html><head><style>${kit.kitCSS(kit.normalizeTokens({}))}\n${utilityCSS(collectClasses(kbody))}</style></head><body>${kbody}</body></html>`);
      const kcs = (sel, prop) => kpage.evaluate(([s, p]) => getComputedStyle(document.querySelector(s))[p], [sel, prop]);
      await kpage.focus('#skip');
      assert.ok(await kpage.evaluate(() => { const r = document.querySelector('#skip').getBoundingClientRect(); return r.width > 50 && r.height > 10 && getComputedStyle(document.querySelector('#skip')).clipPath === 'none'; }), 'kit skip link appears on focus');
      assert.equal(await kcs('#c', 'paddingTop'), '0px');
      assert.notEqual(await kcs('#c', 'backgroundColor'), 'rgba(0, 0, 0, 0)', 'bg-surface-2 resolves');
      assert.notEqual(await kcs('#t', 'color'), 'rgb(0, 0, 0)', 'text-danger-strong resolves');
      assert.equal(await kcs('#t', 'borderTopWidth'), '1px');
      assert.notEqual(await kcs('#t', 'borderTopColor'), await kcs('#t', 'color'), 'border-border-strong resolves');
    }
  } finally { await browser.close(); }
});
