import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omnicode-semantic-'));
const dbDir = path.join(root, 'db');
const repo = path.join(root, 'repo');
process.env.OMNICODE_DB_DIR = dbDir;
process.env.OMNICODE_EMBEDDING_MODEL_DIR = path.join(root, 'missing-model');

fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'semantic-fixture' }));
fs.writeFileSync(path.join(repo, 'src', 'sql.ts'), `
export class SqlConnWorker {
  acquire() {
    return "socket";
  }
}
`);
fs.writeFileSync(path.join(repo, 'src', 'ui.ts'), `
export class RenderPanel {
  paint() {
    return "screen";
  }
}
`);

const { indexProject } = await import('../dist/tools/index_project.js');
const { searchSymbols } = await import('../dist/tools/search_symbols.js');
const { setSemanticEmbeddingProviderForTests } = await import('../dist/engine/embeddings.js');

function vector(values) {
  const out = new Float32Array(values);
  let norm = 0;
  for (const value of out) norm += value * value;
  norm = Math.sqrt(norm);
  for (let i = 0; i < out.length; i++) out[i] = norm ? out[i] / norm : out[i];
  return out;
}

setSemanticEmbeddingProviderForTests({
  modelId: 'test-semantic-provider',
  async embed(text) {
    const lower = text.toLowerCase();
    if (lower.includes('database') || lower.includes('connection') || lower.includes('pooling') || lower.includes('sqlconnworker') || lower.includes('sql')) {
      return vector([1, 0, 0]);
    }
    if (lower.includes('render') || lower.includes('panel') || lower.includes('screen')) {
      return vector([0, 1, 0]);
    }
    return vector([0, 0, 1]);
  },
});

await indexProject(repo, undefined, { workers: 0, force: true });

const semanticResult = await searchSymbols(repo, 'database connection pooling', 3);
assert.match(semanticResult.result, /SqlConnWorker/, 'semantic-only query should find SqlConnWorker');
assert.match(semanticResult.result, /channels: .*similarity/, 'semantic provider should light up similarity channel');
assert.ok(
  semanticResult.result.indexOf('SqlConnWorker') < semanticResult.result.indexOf('RenderPanel') || !semanticResult.result.includes('RenderPanel'),
  'semantic match should rank SqlConnWorker above RenderPanel'
);

setSemanticEmbeddingProviderForTests(null);
process.env.OMNICODE_DISABLE_SEMANTIC_EMBEDDINGS = '1';
const fallbackResult = await searchSymbols(repo, 'RenderPanel', 3);
assert.match(fallbackResult.result, /RenderPanel/, 'search should still work when semantic provider is absent');
assert.doesNotMatch(fallbackResult.result, /channels: .*similarity/, 'missing semantic model must keep similarity channel dark');
delete process.env.OMNICODE_DISABLE_SEMANTIC_EMBEDDINGS;

fs.rmSync(root, { recursive: true, force: true });
console.log('semantic channel tests passed');
