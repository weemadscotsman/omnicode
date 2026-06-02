import fs from 'fs';
import path from 'path';

export async function configMap(repoPath: string) {
  // Configs are usually at root or standard paths, we don't need full syntax indexing
  const targets = [
    'package.json', 'tsconfig.json', 'next.config.ts', 'next.config.js', 'next.config.mjs',
    'vite.config.ts', 'vite.config.js', 'jest.config.js', 'jest.config.ts',
    'eslint.config.mjs', '.eslintrc.json', '.eslintrc.js',
    'docker-compose.yml', 'Dockerfile', 'Makefile', '.env.example'
  ];

  let result = "Config Map (Key configuration files detected):\n";
  let count = 0;

  for (const t of targets) {
    const p = path.join(repoPath, t);
    if (fs.existsSync(p)) {
       result += `- ${t}\n`;
       count++;
    }
  }

  if (count === 0) {
    return { result: "No standard configuration files detected." };
  }

  return { result };
}
