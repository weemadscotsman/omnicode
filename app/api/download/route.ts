import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { getIdentity } from '@/lib/auth';
import { logAudit } from '@/lib/audit';

const archiver = require('archiver') as typeof import('archiver');

export async function GET(req: NextRequest) {
  // The source bundle is no longer anonymously downloadable — require an
  // authenticated identity (any role) and record it.
  const id = getIdentity(req);
  if (!id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const mcpDir = path.resolve('./omnicode-mcp');
  if (!fs.existsSync(mcpDir)) {
    return NextResponse.json({ error: 'Source directory not found' }, { status: 404 });
  }

  await logAudit({ user: id.user, role: id.role, action: 'download:mcp', details: 'Downloaded omnicode-mcp source bundle.', outcome: 'success' });

  const archive = archiver('zip', { zlib: { level: 9 } });
  const stream = new ReadableStream({
    start(controller) {
      archive.on('data', (chunk) => controller.enqueue(chunk));
      archive.on('end', () => controller.close());
      archive.on('error', (err) => controller.error(err));

      archive.glob('**/*', {
        cwd: mcpDir,
        ignore: ['node_modules/**', 'dist/**', 'build/**'],
      }, { prefix: 'omnicode-mcp' });

      archive.finalize();
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="omnicode-mcp.zip"',
    },
  });
}
