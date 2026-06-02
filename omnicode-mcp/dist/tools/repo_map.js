"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.repoMap = repoMap;
const db_1 = require("../store/db");
const manifest_scanner_1 = require("../engine/manifest_scanner");
const ocap_1 = require("../engine/ocap");
async function repoMap(repoPath, format = 'auto') {
    const db = (0, db_1.initDb)(repoPath);
    try {
        const files = db.prepare(`
      SELECT f.id, f.path, f.lang, COUNT(s.id) as symbol_count
      FROM files f
      LEFT JOIN symbols s ON s.file_id = f.id
      GROUP BY f.id
      ORDER BY f.path ASC
    `).all();
        if (files.length === 0) {
            return { result: "Repository not indexed or empty." };
        }
        const resolvedFormat = (0, ocap_1.resolveOcapFormat)(format, files.length);
        if (resolvedFormat === 'ocap') {
            const ocap = (0, ocap_1.makeOcapBuilder)('repo_map', ['path', 'lang', 'symbols']);
            for (const f of files) {
                const relPath = f.path.replace(repoPath, '');
                const lang = f.lang || '';
                const pathId = ocap.intern('path', relPath);
                const langId = lang ? ocap.intern('lang', lang) : 0;
                ocap.push([pathId, langId, f.symbol_count]);
            }
            ocap.setFooter('files', files.length);
            return { result: ocap.toText() };
        }
        let formatted = "Repository Map:\n";
        for (const f of files) {
            const relPath = f.path.replace(repoPath, '');
            formatted += `- ${relPath} (${f.symbol_count} symbols)\n`;
        }
        if (formatted.length > 20000) {
            formatted = formatted.substring(0, 20000) + "\n... (truncated)";
        }
        const scan = (0, manifest_scanner_1.scanRepoManifests)(repoPath);
        formatted += `\n\nProject Manifests & Boundaries:\n${(0, manifest_scanner_1.summarizeManifestScan)(scan, repoPath)}\n`;
        return { result: formatted };
    }
    finally {
        db.close();
    }
}
