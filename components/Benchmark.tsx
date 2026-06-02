"use client";

import { motion } from "motion/react";
import { AlertTriangle, CheckCircle2, FileText, ShieldCheck } from "lucide-react";

const rows = [
  ["Repos", "10"],
  ["Errors", "0"],
  ["Files accounted", "13,041"],
  ["Unknown files", "0"],
  ["Raw source tokens estimated", "2,957,492"],
  ["Operation baseline tokens estimated", "12,055,717"],
  ["OmniCode payload tokens estimated", "57,237"],
  ["Measured byte reduction", "99.525269%"],
  ["Reduction factor", "210.65x"]
];

export function Benchmark() {
  return (
    <section id="benchmark" className="relative overflow-hidden bg-slate-950 py-24 text-slate-50">
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(180deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:56px_56px]" />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-14 grid grid-cols-1 gap-8 lg:grid-cols-[0.8fr_1fr] lg:items-end">
          <div>
            <div className="mb-4 inline-flex rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-sm font-semibold text-cyan-100">
              Public proof line
            </div>
            <h2 className="text-3xl font-semibold tracking-normal text-white md:text-5xl">Selector-fixed byte-exact benchmark</h2>
          </div>
          <p className="text-lg leading-8 text-slate-400">
            The headline number is not a token guess. It is computed from measured source bytes and
            measured UTF-8 MCP payload bytes. The old archive-inflated aggregate was discarded.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_0.82fr]">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="rounded-lg border border-white/10 bg-white/[0.04] p-3 shadow-2xl shadow-black/30"
          >
            <div className="rounded-lg border border-slate-800 bg-slate-950">
              <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-cyan-300" />
                  <span className="font-medium text-slate-200">BENCHMARK_FINAL.md</span>
                </div>
                <span className="rounded-md bg-emerald-400/10 px-2 py-1 text-xs font-medium text-emerald-300">corrected</span>
              </div>
              <div className="divide-y divide-slate-800">
                {rows.map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[1fr_auto] gap-4 px-5 py-3 text-sm">
                    <span className="text-slate-400">{label}</span>
                    <span className="font-mono font-semibold text-white">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="space-y-4"
          >
            <div className="rounded-lg border border-emerald-300/20 bg-emerald-300/10 p-6">
              <div className="mb-3 flex items-center gap-2 text-emerald-200">
                <CheckCircle2 className="h-5 w-5" />
                <h3 className="font-semibold">What is proven</h3>
              </div>
              <p className="text-sm leading-6 text-emerald-50/80">
                Fresh selector-fixed rerun: ten repos, zero errors, zero unknown files, measured
                byte reduction of 99.525269 percent, and a 210.65x reduction factor.
              </p>
            </div>
            <div className="rounded-lg border border-amber-300/20 bg-amber-300/10 p-6">
              <div className="mb-3 flex items-center gap-2 text-amber-200">
                <AlertTriangle className="h-5 w-5" />
                <h3 className="font-semibold">What is not claimed</h3>
              </div>
              <p className="text-sm leading-6 text-amber-50/80">
                OmniCode does not claim full semantic understanding of every repo, all languages as
                native parsers, runtime ref resolution, or automatic code repair.
              </p>
            </div>
            <div className="rounded-lg border border-cyan-300/20 bg-cyan-300/10 p-6">
              <div className="mb-3 flex items-center gap-2 text-cyan-200">
                <ShieldCheck className="h-5 w-5" />
                <h3 className="font-semibold">Why the lower number matters</h3>
              </div>
              <p className="text-sm leading-6 text-cyan-50/80">
                The inflated archive result was thrown away. The public number is lower, measured,
                and reproducible from the methodology docs.
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
