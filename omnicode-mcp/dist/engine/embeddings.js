"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeEmbedding = computeEmbedding;
exports.getEmbeddings = getEmbeddings;
exports.cosineSimilarity = cosineSimilarity;
exports.setSemanticEmbeddingProviderForTests = setSemanticEmbeddingProviderForTests;
exports.semanticEmbeddingsAvailable = semanticEmbeddingsAvailable;
exports.getSemanticEmbedding = getSemanticEmbedding;
const VECTOR_SIZE = 384;
const DEFAULT_MODEL_ID = 'all-MiniLM-L6-v2-onnx';
function hashToken(token) {
    let hash = 2166136261;
    for (let i = 0; i < token.length; i++) {
        hash ^= token.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}
// Pure, synchronous, deterministic embedding. This is just hash-based bag-of-words
// math — no I/O, no model, no real async work. Indexing a big repo calls this once
// per symbol (17k+ on large repos); keeping it sync avoids one Promise allocation +
// microtask hop per symbol on the coordinator thread.
function computeEmbedding(text) {
    const vector = new Float32Array(VECTOR_SIZE);
    const tokens = text.toLowerCase().match(/[a-z0-9_$]+/g) || [];
    for (const token of tokens) {
        const h = hashToken(token);
        const idx = h % VECTOR_SIZE;
        vector[idx] += 1 / Math.sqrt(Math.max(token.length, 1));
    }
    let norm = 0;
    for (const value of vector)
        norm += value * value;
    norm = Math.sqrt(norm);
    if (norm > 0) {
        for (let i = 0; i < vector.length; i++)
            vector[i] /= norm;
    }
    return vector;
}
// Async wrapper kept for back-compat with any caller that awaits embeddings.
async function getEmbeddings(text) {
    return computeEmbedding(text);
}
function cosineSimilarity(a, b) {
    const len = Math.min(a.length, b.length);
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < len; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0)
        return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
let testProvider = null;
const semanticCache = new Map();
function semanticEmbeddingsDisabled() {
    return ['1', 'true', 'yes'].includes(String(process.env.OMNICODE_DISABLE_SEMANTIC_EMBEDDINGS || '').toLowerCase());
}
function setSemanticEmbeddingProviderForTests(provider) {
    testProvider = provider;
    semanticCache.clear();
}
function optionalRequire(moduleName) {
    try {
        // Keep optional native deps out of the TypeScript/runtime hot path. If the
        // package is absent, semantic retrieval simply stays dark.
        return require(moduleName);
    }
    catch {
        return null;
    }
}
function modelDirCandidates() {
    const path = require('path');
    const configured = process.env.OMNICODE_EMBEDDING_MODEL_DIR;
    const candidates = [
        configured,
        path.resolve(process.cwd(), 'models', 'all-MiniLM-L6-v2'),
        path.resolve(__dirname, '..', '..', 'models', 'all-MiniLM-L6-v2'),
    ].filter(Boolean);
    return [...new Set(candidates)];
}
function toInt64Tensor(values) {
    const out = new BigInt64Array(values.length);
    for (let i = 0; i < values.length; i++)
        out[i] = BigInt(values[i] || 0);
    return out;
}
function normalizeVector(vector) {
    let norm = 0;
    for (const value of vector)
        norm += value * value;
    norm = Math.sqrt(norm);
    if (norm > 0) {
        for (let i = 0; i < vector.length; i++)
            vector[i] /= norm;
    }
    return vector;
}
class LocalOnnxMiniLmProvider {
    modelId = DEFAULT_MODEL_ID;
    session = null;
    tokenizer = null;
    disabledReason = null;
    initPromise = null;
    async available() {
        return this.init();
    }
    async embed(text) {
        if (!(await this.init()) || !this.session || !this.tokenizer)
            return null;
        const encoded = await this.encode(text.slice(0, 2000));
        if (!encoded || encoded.inputIds.length === 0)
            return null;
        const ort = optionalRequire('onnxruntime-node');
        if (!ort)
            return null;
        const feeds = {};
        const shape = [1, encoded.inputIds.length];
        if (this.session.inputNames.includes('input_ids')) {
            feeds.input_ids = new ort.Tensor('int64', toInt64Tensor(encoded.inputIds), shape);
        }
        if (this.session.inputNames.includes('attention_mask')) {
            feeds.attention_mask = new ort.Tensor('int64', toInt64Tensor(encoded.attentionMask), shape);
        }
        if (this.session.inputNames.includes('token_type_ids')) {
            feeds.token_type_ids = new ort.Tensor('int64', toInt64Tensor(encoded.tokenTypeIds), shape);
        }
        const outputs = await this.session.run(feeds);
        const outputName = outputs.last_hidden_state
            ? 'last_hidden_state'
            : (this.session.outputNames && this.session.outputNames[0]);
        const tensor = outputs[outputName];
        if (!tensor || !tensor.data || !tensor.dims || tensor.dims.length < 3)
            return null;
        const tokenCount = Number(tensor.dims[1] || encoded.inputIds.length);
        const dims = Number(tensor.dims[2] || VECTOR_SIZE);
        const pooled = new Float32Array(dims);
        let activeTokens = 0;
        const data = tensor.data;
        for (let token = 0; token < tokenCount; token++) {
            if ((encoded.attentionMask[token] || 0) === 0)
                continue;
            activeTokens++;
            const offset = token * dims;
            for (let d = 0; d < dims; d++)
                pooled[d] += Number(data[offset + d] || 0);
        }
        if (activeTokens === 0)
            return null;
        for (let d = 0; d < dims; d++)
            pooled[d] /= activeTokens;
        return normalizeVector(pooled);
    }
    async init() {
        if (this.disabledReason)
            return false;
        if (this.session && this.tokenizer)
            return true;
        if (!this.initPromise)
            this.initPromise = this.load();
        return this.initPromise;
    }
    async load() {
        const fs = require('fs');
        const path = require('path');
        const ort = optionalRequire('onnxruntime-node');
        const tokenizers = optionalRequire('tokenizers');
        if (!ort || !tokenizers) {
            this.disabledReason = 'optional embedding dependencies missing';
            return false;
        }
        for (const dir of modelDirCandidates()) {
            const modelPath = path.join(dir, 'model.onnx');
            const tokenizerPath = path.join(dir, 'tokenizer.json');
            if (!fs.existsSync(modelPath) || !fs.existsSync(tokenizerPath))
                continue;
            const tokenizerCtor = tokenizers.Tokenizer || tokenizers.default?.Tokenizer;
            if (!tokenizerCtor || typeof tokenizerCtor.fromFile !== 'function') {
                this.disabledReason = 'tokenizers package does not expose Tokenizer.fromFile';
                return false;
            }
            this.tokenizer = await tokenizerCtor.fromFile(tokenizerPath);
            this.session = await ort.InferenceSession.create(modelPath);
            this.modelId = `${DEFAULT_MODEL_ID}:${path.resolve(dir)}`;
            return true;
        }
        this.disabledReason = 'embedding model files missing';
        return false;
    }
    async encode(text) {
        const encoded = await this.tokenizer.encode(text);
        const get = (name) => {
            const fn = encoded && encoded[name];
            if (typeof fn === 'function')
                return Array.from(fn.call(encoded)).map(Number);
            const value = encoded && encoded[name];
            return Array.isArray(value) || ArrayBuffer.isView(value) ? Array.from(value).map(Number) : null;
        };
        const inputIds = get('getIds') || get('ids');
        if (!inputIds)
            return null;
        const attentionMask = get('getAttentionMask') || get('attentionMask') || inputIds.map(() => 1);
        const tokenTypeIds = get('getTypeIds') || get('typeIds') || inputIds.map(() => 0);
        return { inputIds, attentionMask, tokenTypeIds };
    }
}
const localProvider = new LocalOnnxMiniLmProvider();
async function semanticEmbeddingsAvailable() {
    if (testProvider)
        return true;
    if (semanticEmbeddingsDisabled())
        return false;
    return localProvider.available();
}
async function getSemanticEmbedding(text) {
    const provider = testProvider || localProvider;
    if (!testProvider && semanticEmbeddingsDisabled())
        return null;
    const key = `${provider.modelId}\0${text}`;
    if (semanticCache.has(key))
        return semanticCache.get(key) || null;
    const vector = await provider.embed(text);
    semanticCache.set(key, vector);
    return vector;
}
