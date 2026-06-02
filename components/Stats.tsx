"use client";

import { motion } from "motion/react";
import { Activity, Database, FileCheck, ShieldCheck } from "lucide-react";

const stats = [
  {
    icon: Activity,
    value: "99.525269%",
    label: "Measured byte reduction",
    sub: "selector-fixed ten-repo rerun"
  },
  {
    icon: Database,
    value: "210.65x",
    label: "Aggregate reduction factor",
    sub: "exact bytes, modeled rows excluded"
  },
  {
    icon: FileCheck,
    value: "13,041",
    label: "Files accounted",
    sub: "zero unknown files in the proof run"
  },
  {
    icon: ShieldCheck,
    value: "0",
    label: "Unknown files",
    sub: "each file gets a named resolution state"
  }
];

export function Stats() {
  return (
    <section className="bg-slate-950 px-4 pb-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl rounded-lg border border-white/10 bg-white/[0.04] p-3 shadow-2xl shadow-black/30">
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-slate-800 bg-slate-800 md:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat, idx) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: idx * 0.08 }}
              className="bg-slate-950 p-6"
            >
              <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-300/10 text-cyan-300">
                <stat.icon className="h-5 w-5" />
              </div>
              <h3 className="text-3xl font-semibold text-white">{stat.value}</h3>
              <p className="mt-2 text-sm font-semibold text-slate-200">{stat.label}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">{stat.sub}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
