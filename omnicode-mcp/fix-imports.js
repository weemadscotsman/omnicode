import fs from 'fs';
import path from 'path';

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      walk(path.join(dir, entry.name));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      const full = path.join(dir, entry.name);
      let content = fs.readFileSync(full, 'utf8');
      content = content.replace(/from '(\.\.?[^']*)';?/g, "from '$1.js';");
      content = content.replace(/\.js\.js/g, '.js');
      fs.writeFileSync(full, content);
    }
  }
}
walk('./omnicode-mcp/src');
console.log('Fixed imports');
