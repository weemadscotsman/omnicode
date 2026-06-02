"use client";

import { motion } from "motion/react";
import { BookOpenCheck, PackageCheck } from "lucide-react";

const productLists = [
  {
    icon: PackageCheck,
    title: "OmniCode MCP",
    items: [
      "Compressed MCP mode with lazy schema loading",
      "Session resume brief for fresh agent sessions",
      "Repo map, file outline, symbol search, exact snippets, and file context",
      "Resolution ledger, blindspot reports, and advisory repair handoffs",
      "Sweep runner for large local project audits with cache cleanup"
    ]
  },
  {
    icon: BookOpenCheck,
    title: "Proof bundle",
    items: [
      "Benchmark final with corrected byte-exact numbers",
      "Methodology explaining exact bytes vs estimated tokens",
      "Anomalies file explaining scary values and skipped artifacts",
      "Claims and limits so the site does not overpromise",
      "User guide, agent install guide, and security model"
    ]
  }
];

export function Products() {
  return (
    <section className="bg-slate-50 py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto mb-16 max-w-3xl text-center">
          <div className="mx-auto mb-4 inline-flex rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
            Release candidate
          </div>
          <h2 className="text-3xl font-semibold tracking-normal text-slate-950 md:text-5xl">What ships in the RC</h2>
          <p className="mt-4 text-lg leading-8 text-slate-600">
            The public package leads with the working repo-trust layer and the proof bundle. Extra
            products can wait until they exist.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          {productLists.map((product, idx) => (
            <motion.div
              key={product.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: idx * 0.08 }}
              className="rounded-lg border border-slate-200 bg-white p-8 shadow-sm shadow-slate-950/[0.04]"
            >
              <div className="mb-8 flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-800">
                  <product.icon className="h-6 w-6" />
                </div>
                <div>
                  <div className="text-sm font-semibold uppercase tracking-wider text-slate-400">Included</div>
                  <h3 className="text-2xl font-semibold text-slate-950">{product.title}</h3>
                </div>
              </div>
              <ul className="space-y-4 text-sm leading-6 text-slate-700">
                {product.items.map((item) => (
                  <li key={item} className="flex gap-3">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-500" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
