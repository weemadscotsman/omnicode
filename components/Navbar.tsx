"use client";

import Link from "next/link";
import { Code2, Github } from "lucide-react";

const githubUrl = process.env.NEXT_PUBLIC_OMNICODE_GITHUB_URL || "https://github.com/weemadscotsman/omnicode";

export function Navbar() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/10 bg-slate-950/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2">
          <div className="rounded-lg border border-cyan-300/20 bg-cyan-300/10 p-1.5">
            <Code2 className="h-5 w-5 text-cyan-300" />
          </div>
          <span className="text-lg font-semibold tracking-normal text-white">OmniCode</span>
        </Link>
        <nav className="hidden items-center gap-7 text-sm font-medium text-slate-300 md:flex">
          <Link href="/#benchmark" className="transition-colors hover:text-cyan-200">Benchmark</Link>
          <Link href="/#how-it-works" className="transition-colors hover:text-cyan-200">How it works</Link>
          <Link href="/#cost-analysis" className="transition-colors hover:text-cyan-200">Sweep</Link>
          <Link href="/dashboard" className="transition-colors hover:text-cyan-200">Dashboard</Link>
        </nav>
        <div className="flex items-center gap-3">
          {githubUrl ? (
            <Link href={githubUrl} className="hidden items-center gap-2 text-sm font-medium text-slate-300 hover:text-cyan-200 sm:flex">
              <Github className="h-4 w-4" />
              GitHub
            </Link>
          ) : null}
          <Link href="/download" className="rounded-lg bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-200">
            Download RC
          </Link>
        </div>
      </div>
    </header>
  );
}
