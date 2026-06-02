const fs = require('fs');
const path = require('path');
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.ts')) {
      let content = fs.readFileSync(full, 'utf8');
      content = content.replace(/from '(\.\.?[^']*)(\.js)';?/g, "from '$1';");
      content = content.replace(/from "(\.\.?[^"]*)(\.js)";?/g, 'from "$1";');
      fs.writeFileSync(full, content);
    }
  }
}
walk('./omnicode-mcp/src');
console.log('Fixed imports for CommonJS');
