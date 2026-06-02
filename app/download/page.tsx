"use client";

import { motion } from "motion/react";
import { Box, Check, Clipboard, Github, Key, Terminal } from "lucide-react";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";

const githubUrl = process.env.NEXT_PUBLIC_OMNICODE_GITHUB_URL || "https://github.com/weemadscotsman/omnicode";
const installCommand = "npm install && npm run build && node dist/cli.js doctor";

export default function DownloadPage() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <Navbar />
      <main className="flex-1 py-16">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <div className="mb-12 text-center">
            <motion.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 text-4xl font-bold text-slate-950"
            >
              Install OmniCode RC locally
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="mx-auto max-w-2xl text-lg leading-8 text-slate-600"
            >
              Current release candidate install is source-based. That is honest: prebuilt native
              platform packages are still a release gap, and the site should not pretend otherwise.
            </motion.p>
          </div>

          <div className="mx-auto mb-8 max-w-3xl overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="relative overflow-hidden bg-slate-950 p-8 text-white">
              <div className="absolute right-0 top-0 flex gap-4 p-8 opacity-5">
                <Box className="h-48 w-48" />
              </div>
              <div className="relative z-10">
                <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-white">
                  <Terminal className="h-3.5 w-3.5" />
                  Source RC install
                </div>
                <h2 className="mb-4 text-3xl font-bold">Build, doctor, then wire MCP</h2>
                <p className="mb-6 max-w-md text-sm leading-6 text-slate-300">
                  Clone or download the repo, install dependencies, build the server, and run the
                  doctor check before adding it to Codex, Claude, Cursor, or another MCP client.
                </p>

                <div className="overflow-x-auto rounded-lg border border-white/10 bg-black/40 p-4 font-mono text-sm text-blue-300">
                  <div className="flex w-full items-center justify-between gap-4">
                    <span>{installCommand}</span>
                    <button
                      onClick={() => navigator.clipboard.writeText(installCommand)}
                      className="rounded bg-white/10 px-3 py-1 text-xs text-slate-300 transition-colors hover:text-white"
                    >
                      <Clipboard className="mr-1 inline h-3.5 w-3.5" />
                      Copy
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-8">
              <h3 className="mb-6 text-lg font-semibold text-slate-950">Get the code</h3>

              <div className="mb-8 flex flex-col items-center gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:flex-row">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white">
                  <Github className="h-6 w-6 text-slate-700" />
                </div>
                <div className="flex-1">
                  <h4 className="font-semibold text-slate-950">GitHub repository</h4>
                  <p className="text-sm text-slate-500">
                    Public source repo for the OmniCode RC.
                  </p>
                </div>
                <Link
                  href={githubUrl}
                  className="shrink-0 rounded-lg bg-slate-950 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800"
                >
                  Open GitHub
                </Link>
              </div>

              <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
                <div>
                  <h4 className="mb-4 flex items-center gap-2 font-semibold text-slate-950">
                    <Check className="h-5 w-5 text-emerald-500" /> What to verify
                  </h4>
                  <ul className="space-y-3 text-sm leading-6 text-slate-600">
                    <li>Run `node dist/cli.js doctor` after build.</li>
                    <li>Use `omnicode mcp-config` to print client config.</li>
                    <li>Start sessions with `session_resume_brief`.</li>
                    <li>Use `omnicode sweep` for large local project audits.</li>
                  </ul>
                </div>
                <div>
                  <h4 className="mb-4 flex items-center gap-2 font-semibold text-slate-950">
                    <Key className="h-5 w-5 text-blue-500" /> Honest security posture
                  </h4>
                  <ul className="space-y-3 text-sm leading-6 text-slate-600">
                    <li>Local stdio MCP server; no hosted cloud service in this RC.</li>
                    <li>Compressed tool mode by default.</li>
                    <li>RBAC, sandbox checks, audit, redaction, and local project memory.</li>
                    <li>No automatic source mutation; repair output is Markdown handoff only.</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
