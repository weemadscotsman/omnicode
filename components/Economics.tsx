"use client";

import { motion } from "motion/react";

const sweepRows = [
  ["304", "Projects queued", "loose detection over E:/god folder, depth two"],
  ["76,003", "Files accounted mid-run", "zero unknown files at the captured checkpoint"],
  ["99.772405%", "Measured byte reduction mid-run", "439.38x factor at 173 completed projects"]
];

export function Economics() {
  return (
    <section id="cost-analysis" className="bg-white py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-slate-200 bg-slate-950 p-4 shadow-2xl shadow-slate-950/10">
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-8 md:p-10">
            <div className="grid grid-cols-1 gap-10 lg:grid-cols-[0.75fr_1fr] lg:items-center">
              <div>
                <div className="mb-4 inline-flex rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-sm font-semibold text-cyan-100">
                  Hostile local sweep
                </div>
                <h2 className="text-3xl font-semibold tracking-normal text-white md:text-5xl">Built to audit messy drives one repo at a time.</h2>
                <p className="mt-5 text-lg leading-8 text-slate-400">
                  The E-drive sweep is the rough test range: hundreds of folders, each benchmarked
                  separately, with cache deletion after every repo.
                </p>
                <p className="mt-5 text-sm leading-6 text-slate-500">
                  Sweep numbers are operational proof, not the launch headline until the full run
                  finishes. The public benchmark headline remains the selector-fixed ten-repo run.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4">
                {sweepRows.map(([value, label, sub], idx) => (
                  <motion.div
                    key={label}
                    initial={{ opacity: 0, y: 16 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: idx * 0.08 }}
                    className="grid grid-cols-[auto_1fr] gap-5 rounded-lg border border-slate-800 bg-white/[0.04] p-5"
                  >
                    <div className="min-w-32 font-mono text-3xl font-semibold text-cyan-200">{value}</div>
                    <div>
                      <div className="font-semibold text-white">{label}</div>
                      <p className="mt-1 text-sm leading-6 text-slate-400">{sub}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
