const { scanRepositoryWithStats } = require('./dist/engine/scanner');
const { indexProject } = require('./dist/tools/index_project');
const p = 'E:/god folder/02_ACTIVE_PROJECTS/PVX_BLOCKCHAIN';
const s = scanRepositoryWithStats(p);
console.log('scan: candidates', s.stats.indexedCandidates, 'oversizedSkipped', s.stats.oversizedSkipped, 'scanMs', s.stats.scanMs);
(async()=>{ const t=Date.now(); const r=await indexProject(p); console.log('INDEX', Date.now()-t,'ms →', JSON.stringify({files:r.totalIndexedFiles,syms:r.symbolsExtracted})); })();
