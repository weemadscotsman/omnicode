"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { ArrowRight, Check, Github } from "lucide-react";

const githubUrl = process.env.NEXT_PUBLIC_OMNICODE_GITHUB_URL || "https://github.com/weemadscotsman/omnicode";

export function Pricing() {
  return (
    <section id="pricing" className="bg-slate-950 py-24 text-slate-50">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-10 rounded-lg border border-white/10 bg-white/[0.04] p-8 shadow-2xl shadow-black/30 md:p-10 lg:grid-cols-[0.85fr_1fr] lg:items-center">
          <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <div className="mb-4 inline-flex rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-sm font-semibold text-cyan-100">
              Source RC
            </div>
            <h2 className="text-3xl font-semibold tracking-normal text-white md:text-5xl">Install the repo-trust layer, then prove it locally.</h2>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-400">
              Pricing and license terms should be finalized after packaging. For now, the honest
              CTA is source, docs, and reproducible proof.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/download" className="inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-300 px-6 py-3 font-semibold text-slate-950 hover:bg-cyan-200">
                Download RC
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href={githubUrl} className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 px-6 py-3 font-semibold text-white hover:bg-white/10">
                <Github className="h-4 w-4" />
                GitHub repo
              </Link>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.08 }}
            className="rounded-lg border border-slate-800 bg-slate-950 p-6"
          >
            <h3 className="text-xl font-semibold text-white">RC includes</h3>
            <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {[
                "local-first MCP server",
                "compressed public tool surface",
                "byte-exact benchmark tooling",
                "E-drive sweep runner",
                "claims and limits doc",
                "methodology and security docs"
              ].map((item) => (
                <li key={item} className="flex gap-3 text-sm text-slate-300">
                  <Check className="h-5 w-5 shrink-0 text-cyan-300" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
