"use client";

import { motion } from "motion/react";
import { Database, FileWarning, LockKeyhole, Workflow } from "lucide-react";

const steps = [
  {
    icon: Database,
    title: "Index locally",
    desc: "Tree-sitter/fallback parsing, SQLite graph storage, import/call edges, and per-file resolution state."
  },
  {
    icon: LockKeyhole,
    title: "Expose less",
    desc: "Compressed MCP mode shows five public tools. Schemas load only when the agent asks for one."
  },
  {
    icon: FileWarning,
    title: "Report uncertainty",
    desc: "Blindspots, runtime refs, unsupported artifacts, and parse quality are surfaced instead of hidden."
  },
  {
    icon: Workflow,
    title: "Handoff safely",
    desc: "No Spaghett writes Markdown repair handoffs. It does not mutate source code by itself."
  }
];

export function Architecture() {
  return (
    <section id="how-it-works" className="bg-slate-50 py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto mb-16 max-w-3xl text-center">
          <div className="mx-auto mb-4 inline-flex rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
            Agent control loop
          </div>
          <h2 className="text-3xl font-semibold tracking-normal text-slate-950 md:text-5xl">Scan. Brief. Retrieve. Govern.</h2>
          <p className="mt-4 text-lg leading-8 text-slate-600">
            The point is not a louder search box. The point is making agent sessions cheaper,
            clearer, and less reckless.
          </p>
        </div>

        <div className="relative">
          <div className="absolute left-0 right-0 top-10 hidden h-px bg-slate-200 lg:block" />
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, idx) => (
              <motion.div
                key={step.title}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: idx * 0.08 }}
                className="relative rounded-lg border border-slate-200 bg-white p-6 shadow-sm shadow-slate-950/[0.03]"
              >
                <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-lg border border-cyan-200 bg-cyan-50 text-cyan-700">
                  <step.icon className="h-5 w-5" />
                </div>
                <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Step {idx + 1}</div>
                <h3 className="text-lg font-semibold text-slate-950">{step.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
