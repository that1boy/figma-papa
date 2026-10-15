'use strict';
// Bundled families are latin-subset variable woff2 files in assets/fonts (SIL OFL, see OFL.txt).
// weight is the real wght axis range of the file; heading/tracking tune headings set in that family.
const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const SERIF = "Georgia, Cambria, 'Times New Roman', Times, serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";
const font = (file, category, fallback, office, weight, heading = 650, tracking = -0.02) => ({ file, category, fallback, office, weight, heading, tracking });
const FONTS = Object.freeze({
  'Inter': font('inter-latin-wght-normal.woff2', 'sans', SANS, 'Segoe UI', '100 900', 650, -0.022),
  'Manrope': font('manrope-latin-wght-normal.woff2', 'sans', SANS, 'Segoe UI', '200 800', 700, -0.02),
  'Space Grotesk': font('space-grotesk-latin-wght-normal.woff2', 'display', SANS, 'Arial', '300 700', 600, -0.025),
  'IBM Plex Sans': font('ibm-plex-sans-latin-wght-normal.woff2', 'sans', SANS, 'Arial', '100 700', 600, -0.01),
  'Source Serif 4': font('source-serif-4-latin-wght-normal.woff2', 'serif', SERIF, 'Georgia', '200 900', 600, -0.01),
  'Fraunces': font('fraunces-latin-wght-normal.woff2', 'serif', SERIF, 'Georgia', '100 900', 600, -0.015),
  'JetBrains Mono': font('jetbrains-mono-latin-wght-normal.woff2', 'mono', MONO, 'Consolas', '100 800', 600, -0.02),
  'DM Sans': font('dm-sans-latin-wght-normal.woff2', 'sans', SANS, 'Segoe UI', '100 1000', 650, -0.02),
  'Plus Jakarta Sans': font('plus-jakarta-sans-latin-wght-normal.woff2', 'sans', SANS, 'Segoe UI', '200 800', 700, -0.02),
  'Outfit': font('outfit-latin-wght-normal.woff2', 'display', SANS, 'Arial', '100 900', 600, -0.015),
  'DM Serif Display': font('dm-serif-display-latin-400-normal.woff2', 'display', SERIF, 'Georgia', '400', 400, -0.005),
  'Arial': { system: true, category: 'sans', fallback: 'Helvetica, sans-serif', office: 'Arial', heading: 700, tracking: -0.01 },
  'Segoe UI': { system: true, category: 'sans', fallback: SANS, office: 'Segoe UI', heading: 650, tracking: -0.01 },
  'Georgia': { system: true, category: 'serif', fallback: SERIF, office: 'Georgia', heading: 700, tracking: -0.005 },
  'Verdana': { system: true, category: 'sans', fallback: 'Tahoma, sans-serif', office: 'Verdana', heading: 700, tracking: -0.01 },
  'Trebuchet MS': { system: true, category: 'sans', fallback: 'Tahoma, sans-serif', office: 'Trebuchet MS', heading: 700, tracking: -0.01 },
});
const p = (id, name, description, mood, tokens) => ({ id, name, description, mood, tokens: Object.freeze({ name, preset: id, ...tokens }) });
const LIGHT = { success: '#15803d', warning: '#b45309', danger: '#dc2626' };
// Every preset passes WCAG AA: text and muted on background/surface, on-accent text on accent (see test/kit.test.cjs).
const PRESETS = Object.freeze([
  p('neutral', 'Neutral SaaS', 'Crisp, quiet product UI on Inter with an indigo accent. The safe default for apps and dashboards.', ['clean', 'product', 'saas', 'dashboard'],
    { accent: '#4f46e5', accent2: '#0891b2', background: '#fafafa', surface: '#ffffff', text: '#18181b', muted: '#5f5f69', border: '#e4e4e7', ...LIGHT,
      headingFont: 'Inter', bodyFont: 'Inter', monoFont: 'JetBrains Mono', radius: 8, spacing: 8, density: 'comfortable', shadow: 'soft', typeScale: 1.25 }),
  p('editorial', 'Editorial Serif', 'Warm paper, Fraunces headlines and Source Serif text. For publications, reports, essays and storytelling.', ['editorial', 'serif', 'reading', 'magazine'],
    { accent: '#a63d1c', accent2: '#2f5d50', background: '#f7f3ea', surface: '#fffcf5', text: '#1f1a14', muted: '#665b4f', border: '#e3dacb', success: '#2f6b3a', warning: '#a15c07', danger: '#b42318',
      headingFont: 'Fraunces', bodyFont: 'Source Serif 4', monoFont: 'JetBrains Mono', radius: 4, spacing: 8, density: 'comfortable', shadow: 'none', typeScale: 1.333 }),
  p('midnight', 'Midnight Console', 'Dark, dense developer console with a luminous periwinkle accent and mono details.', ['dark', 'developer', 'console', 'technical'],
    { accent: '#8b93ff', accent2: '#2dd4bf', background: '#0b0d12', surface: '#13161d', text: '#e7e9ee', muted: '#9ba2b2', border: '#272c37', success: '#34d399', warning: '#fbbf24', danger: '#f87171',
      headingFont: 'Inter', bodyFont: 'Inter', monoFont: 'JetBrains Mono', radius: 6, spacing: 8, density: 'compact', shadow: 'crisp', typeScale: 1.2 }),
  p('warm', 'Warm Minimal', 'Soft stone neutrals, generous space and a clay accent on Manrope. Calm consumer and lifestyle products.', ['warm', 'minimal', 'calm', 'consumer'],
    { accent: '#b4532a', accent2: '#5b7a3a', background: '#faf8f5', surface: '#ffffff', text: '#1c1917', muted: '#6b635b', border: '#ebe5dd', success: '#3f7a2e', warning: '#a3580a', danger: '#c0362c',
      headingFont: 'Manrope', bodyFont: 'Manrope', monoFont: 'JetBrains Mono', radius: 12, spacing: 8, density: 'spacious', shadow: 'soft', typeScale: 1.25 }),
  p('bold', 'Bold Launch', 'High-energy marketing: Space Grotesk display type, Outfit text, saturated violet with a coral spark.', ['bold', 'marketing', 'launch', 'startup'],
    { accent: '#6d28d9', accent2: '#e11d48', background: '#fbfaff', surface: '#ffffff', text: '#120d24', muted: '#5a5470', border: '#e6e2f2', ...LIGHT,
      headingFont: 'Space Grotesk', bodyFont: 'Outfit', monoFont: 'JetBrains Mono', radius: 14, spacing: 8, density: 'spacious', shadow: 'medium', typeScale: 1.333 }),
  p('enterprise', 'Enterprise Dense', 'Information-dense IBM Plex Sans layout with square corners and a strong blue. Admin, ops and data tools.', ['enterprise', 'dense', 'admin', 'data'],
    { accent: '#0f62fe', accent2: '#8a3ffc', background: '#f2f4f8', surface: '#ffffff', text: '#161616', muted: '#525a66', border: '#d8dde5', success: '#198038', warning: '#a15c00', danger: '#da1e28',
      headingFont: 'IBM Plex Sans', bodyFont: 'IBM Plex Sans', monoFont: 'JetBrains Mono', radius: 4, spacing: 8, density: 'compact', shadow: 'crisp', typeScale: 1.2 }),
  p('fintech', 'Trust Blue', 'Reassuring fintech look: deep navy text, confident blue and teal on DM Sans with soft depth.', ['fintech', 'trust', 'banking', 'finance'],
    { accent: '#1456d8', accent2: '#0f8b80', background: '#f5f8fc', surface: '#ffffff', text: '#0b1b33', muted: '#4f5e77', border: '#dce4ef', success: '#0f7a4f', warning: '#a65b00', danger: '#c8322b',
      headingFont: 'DM Sans', bodyFont: 'DM Sans', monoFont: 'JetBrains Mono', radius: 10, spacing: 8, density: 'comfortable', shadow: 'soft', typeScale: 1.25 }),
  p('friendly', 'Soft Friendly', 'Rounded, approachable Plus Jakarta Sans with a berry accent and sunny highlights. Education, community, health.', ['friendly', 'rounded', 'playful', 'community'],
    { accent: '#c0266d', accent2: '#2563eb', background: '#fdf9fb', surface: '#ffffff', text: '#24152b', muted: '#675a6d', border: '#f0e4ec', success: '#16803c', warning: '#a85d00', danger: '#cf2a2a',
      headingFont: 'Plus Jakarta Sans', bodyFont: 'Plus Jakarta Sans', monoFont: 'JetBrains Mono', radius: 16, spacing: 8, density: 'spacious', shadow: 'soft', typeScale: 1.25 }),
  p('luxury', 'Noir Luxe', 'Ivory, ink and antique gold. DM Serif Display headlines over Inter, hairline borders and wide spacing.', ['luxury', 'premium', 'fashion', 'hospitality'],
    { accent: '#1c1814', accent2: '#9a7432', background: '#f6f2eb', surface: '#fffdf9', text: '#1c1814', muted: '#675e53', border: '#e2d9cc', success: '#3d6b40', warning: '#97600d', danger: '#a8322a',
      headingFont: 'DM Serif Display', bodyFont: 'Inter', monoFont: 'JetBrains Mono', radius: 2, spacing: 8, density: 'spacious', shadow: 'none', typeScale: 1.414 }),
  p('civic', 'Civic Accessible', 'High-contrast public-service style: near-black text, strong borders, clear blue links, big targets.', ['accessible', 'government', 'high-contrast', 'public'],
    { accent: '#1d5fa8', accent2: '#00703c', background: '#f8f8f7', surface: '#ffffff', text: '#0b0c0c', muted: '#484f53', border: '#b1b4b6', success: '#00703c', warning: '#9a4a00', danger: '#c2321a',
      headingFont: 'Source Serif 4', bodyFont: 'IBM Plex Sans', monoFont: 'JetBrains Mono', radius: 2, spacing: 8, density: 'spacious', shadow: 'none', typeScale: 1.25 }),
]);
const DEFAULT_PRESET = 'neutral';
function preset(id) { return PRESETS.find(x => x.id === id) || null; }
module.exports = { FONTS, PRESETS, DEFAULT_PRESET, preset };
