import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

const MODEL_DIR = process.env.OMNICODE_EMBEDDING_MODEL_DIR
  ? path.resolve(process.env.OMNICODE_EMBEDDING_MODEL_DIR)
  : path.resolve(process.cwd(), 'models', 'all-MiniLM-L6-v2');

const FILES = [
  {
    name: 'model.onnx',
    url: 'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx',
  },
  {
    name: 'tokenizer.json',
    url: 'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/tokenizer.json',
  },
];

async function downloadFile(url, outPath) {
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
    console.log(`exists ${outPath}`);
    return;
  }
  const tmpPath = `${outPath}.tmp`;
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`download failed ${response.status} ${response.statusText}: ${url}`);
  }
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(tmpPath));
  fs.renameSync(tmpPath, outPath);
  console.log(`downloaded ${outPath} (${fs.statSync(outPath).size} bytes)`);
}

fs.mkdirSync(MODEL_DIR, { recursive: true });
for (const file of FILES) {
  await downloadFile(file.url, path.join(MODEL_DIR, file.name));
}
console.log(`embedding model ready: ${MODEL_DIR}`);
