'use strict';
const S = require('./schema.cjs');

function prepareImport(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    S.fail('Choose a Forma artifact JSON export.');
  if (Buffer.byteLength(JSON.stringify(input.artifact) || '') > 1000000)
    S.fail('Forma artifact JSON must be at most 1 MB.');
  let artifact, references;
  try {
    artifact = S.artifact(input.artifact);
    references = S.references(input.references);
  } catch (error) {
    if (error instanceof TypeError) S.fail('Invalid artifact or reference structure. Choose a Forma JSON export.');
    throw error;
  }
  const indices = artifact.kind === 'web'
    ? [...S.webScreens(artifact).map(s => s.html).join('\n').matchAll(/\{\{reference:([01])\}\}/g)].map(match => Number(match[1]))
    : (artifact.slides || artifact.blocks).map(item => item.imageIndex).filter(index => index != null);
  for (const index of new Set(indices)) {
    if (!references[index])
      S.fail(`Reference image ${index + 1} is required. Attach the original images in their original order.`);
  }
  const sourceBrief = S.str(input.sourceBrief, 'Original brief', 24000).trim();
  return { artifact, references, sourceBrief: sourceBrief || 'Imported Forma JSON. Original brief not supplied.' };
}

module.exports = { prepareImport };
