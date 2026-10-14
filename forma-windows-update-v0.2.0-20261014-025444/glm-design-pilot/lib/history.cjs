'use strict';

// Follow the selected revision's branch, including manual edits and restores.
function initializeHistory(db) {
  if (db.prepare('PRAGMA table_info(revisions)').all().some((c) => c.name === 'parent_id')) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('ALTER TABLE revisions ADD COLUMN parent_id TEXT');
    const previous = new Map(), known = new Map();
    const update = db.prepare('UPDATE revisions SET parent_id=? WHERE id=?');
    for (const r of db.prepare('SELECT rowid,* FROM revisions ORDER BY rowid').all()) {
      const job = db.prepare('SELECT base_id FROM jobs WHERE result_id=? AND project_id=?').get(r.id, r.project_id);
      const restored = r.origin === 'restore' ? /^Restored revision (.+)$/.exec(r.prompt)?.[1] : null;
      const candidate = restored || job?.base_id || (r.origin === 'manual' ? previous.get(r.project_id) : null);
      if (candidate && known.get(candidate) === r.project_id) update.run(candidate, r.id);
      known.set(r.id, r.project_id);
      previous.set(r.project_id, r.id);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function briefHistory(db, projectId, revisionId, limit = 96000) {
  const seen = new Set(), rows = [];
  let next = revisionId;
  while (next && !seen.has(next)) {
    seen.add(next);
    const r = db.prepare('SELECT id,parent_id,prompt,origin,artifact FROM revisions WHERE id=? AND project_id=?').get(next, projectId);
    if (!r) break;
    if (['glm', 'demo', 'import', 'copy', 'template'].includes(r.origin)) rows.unshift({ revisionId: r.id, prompt: r.prompt });
    if (r.origin === 'manual') {
      const parent = db.prepare('SELECT artifact FROM revisions WHERE id=? AND project_id=?').get(r.parent_id, projectId);
      if (parent) {
        const changes = changedFields(JSON.parse(parent.artifact), JSON.parse(r.artifact));
        if (changes.length) rows.unshift({ revisionId: r.id, prompt: `User manual edits (preserve these changed fields unless a later request changes them): ${JSON.stringify(changes)}` });
      }
    }
    next = r.parent_id;
  }
  // Keep the original brief intact, plus the most recent contiguous instructions.
  const kept = rows.length ? [rows[0]] : [];
  let size = rows[0]?.prompt.length || 0;
  for (let i = rows.length - 1; i > 0; i--) {
    if (size + rows[i].prompt.length > limit) break;
    kept.splice(1, 0, rows[i]);
    size += rows[i].prompt.length;
  }
  return { briefs: kept, omitted: rows.length - kept.length };
}

function changedFields(before, after, path = '') {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length)
    return after.flatMap((value, index) => changedFields(before[index], value, `${path}[${index}]`));
  if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(key => changedFields(before[key], after[key], path ? `${path}.${key}` : key));
  }
  return [{ field: path, ...(after === undefined ? { removed: true } : { value: after }) }];
}

module.exports = { initializeHistory, briefHistory };
