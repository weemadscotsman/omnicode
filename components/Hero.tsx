"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, FileCheck, Github, LockKeyhole, Terminal } from "lucide-react";

const githubUrl = process.env.NEXT_PUBLIC_OMNICODE_GITHUB_URL || "https://github.com/weemadscotsman/omnicode";

const packetRows = [
  ["tool mode", "compressed", "5 public tools"],
  ["repo state", "accounted", "13,041 files"],
  ["unknown files", "zero", "proof run"],
  ["repair mode", "handoff", "no mutation"]
];

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-slate-950 pt-24 pb-20 text-white">
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(180deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:48px_48px]" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/60 to-transparent" />

      <div className="relative mx-auto grid max-w-7xl grid-cols-1 items-center gap-14 px-4 sm:px-6 lg:grid-cols-[1fr_0.86fr] lg:px-8">
        <div>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="mb-8 inline-flex items-center gap-2 rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-sm font-medium text-cyan-100"
          >
            <Terminal className="h-4 w-4 text-cyan-300" />
            <span>OmniCode v2 RC - local-first MCP repo trust layer</span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="max-w-5xl text-5xl font-semibold tracking-normal text-white md:text-7xl"
          >
            Make AI agents start with repo truth.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2 }}
            className="mt-6 max-w-3xl text-lg leading-8 text-slate-300 md:text-xl"
          >
            OmniCode turns local codebases into a compact MCP trust layer: measured byte reduction,
            zero-unknown file accounting, blindspot reporting, session resume briefs, and advisory
            repair handoffs.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.3 }}
            className="mt-10 flex flex-col gap-4 sm:flex-row"
          >
            <Link
              href="/download"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-300 px-6 py-4 text-base font-semibold text-slate-950 shadow-lg shadow-cyan-950/40 transition-colors hover:bg-cyan-200"
            >
              Download RC
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/#benchmark"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 px-6 py-4 text-base font-semibold text-white transition-colors hover:bg-white/10"
            >
              <FileCheck className="h-4 w-4" />
              View proof
            </Link>
            <Link
              href={githubUrl}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 px-6 py-4 text-base font-semibold text-white transition-colors hover:bg-white/10"
            >
              <Github className="h-4 w-4" />
              GitHub
            </Link>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.45 }}
            className="mt-12 grid max-w-4xl grid-cols-1 gap-3 text-sm text-slate-300 sm:grid-cols-3"
          >
            {["Compressed MCP by default", "Markdown handoffs only", "Claims and limits documented"].map((item) => (
              <div key={item} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-cyan-300" />
                <span>{item}</span>
              </div>
            ))}
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.2 }}
          className="relative"
        >
          <div className="rounded-lg border border-white/15 bg-white/[0.06] p-3 shadow-2xl shadow-black/40 backdrop-blur">
            <div className="rounded-lg border border-slate-800 bg-slate-950">
              <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                  <LockKeyhole className="h-4 w-4 text-cyan-300" />
                  session_resume_brief
                </div>
                <span className="rounded-md bg-emerald-400/10 px-2 py-1 text-xs font-medium text-emerald-300">trusted packet</span>
              </div>

              <div className="grid grid-cols-2 border-b border-slate-800">
                <div className="border-r border-slate-800 p-5">
                  <div className="text-xs uppercase tracking-wider text-slate-500">Measured reduction</div>
                  <div className="mt-2 text-3xl font-semibold text-white">99.525269%</div>
                </div>
                <div className="p-5">
                  <div className="text-xs uppercase tracking-wider text-slate-500">Reduction factor</div>
                  <div className="mt-2 text-3xl font-semibold text-white">210.65x</div>
                </div>
              </div>

              <div className="divide-y divide-slate-800">
                {packetRows.map(([label, value, note]) => (
                  <div key={label} className="grid grid-cols-[1fr_auto] gap-4 px-5 py-4 text-sm">
                    <div>
                      <div className="font-medium text-slate-200">{label}</div>
                      <div className="mt-1 text-xs text-slate-500">{note}</div>
                    </div>
                    <div className="font-mono text-cyan-200">{value}</div>
                  </div>
                ))}
              </div>

              <div className="border-t border-slate-800 bg-slate-900/60 p-5">
                <div className="mb-3 text-xs uppercase tracking-wider text-slate-500">Next action</div>
                <div className="rounded-lg border border-cyan-300/20 bg-cyan-300/10 p-4 font-mono text-sm leading-6 text-cyan-100">
                  call get_tool_schema only for the tool needed next
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
