"use client";

import { motion } from "motion/react";
import { Users, Bot, Code2, Database, FileSearch } from "lucide-react";

const audiences = [
  {
    icon: Bot,
    title: "AI coding agents",
    desc: "Start from a compact repo brief, then load only the tool schema and code context needed for the next action."
  },
  {
    icon: Code2,
    title: "MCP client users",
    desc: "Use compressed mode by default: health, compact tool catalog, one-schema lookup, secure invocation, and session resume."
  },
  {
    icon: Users,
    title: "Large-repo maintainers",
    desc: "Run byte-exact benchmarks, account for every file, and keep anomalies visible instead of hiding skipped artifacts."
  },
  {
    icon: Database,
    title: "Token-budget owners",
    desc: "Use the audited benchmark path: measured source bytes versus measured MCP payload bytes, with modeled rows excluded."
  },
  {
    icon: FileSearch,
    title: "Repo safety reviewers",
    desc: "Separate what OmniCode can see from what it cannot. Repair output is a Markdown handoff, not automatic code mutation."
  }
];

export function Audience() {
  return (
    <section className="bg-white py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[0.8fr_1fr] lg:items-start">
          <div>
            <div className="mb-4 inline-flex rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
              Operational fit
            </div>
            <h2 className="text-3xl font-semibold tracking-normal text-slate-950 md:text-5xl">
              Built for agents that need repo truth first.
            </h2>
            <p className="mt-5 text-lg leading-8 text-slate-600">
              OmniCode is for local codebases where token cost, file coverage, and unsafe repair
              assumptions need evidence instead of guesses.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {audiences.map((item, idx) => (
              <motion.div
                key={item.title}
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.45, delay: idx * 0.06 }}
                className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm shadow-slate-950/[0.03]"
              >
                <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700">
                  <item.icon className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-semibold text-slate-950">{item.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
