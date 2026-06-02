import Link from "next/link";
import { Code2 } from "lucide-react";

const githubUrl = process.env.NEXT_PUBLIC_OMNICODE_GITHUB_URL || "https://github.com/weemadscotsman/omnicode";

export function Footer() {
  return (
    <footer className="border-t border-white/10 bg-slate-950 py-12 text-slate-400">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-4 sm:px-6 md:flex-row lg:px-8">
        <div className="flex items-center gap-2 text-slate-300">
          <Code2 className="h-5 w-5 text-cyan-300" />
          <span className="font-semibold tracking-tight">OmniCode</span>
        </div>
        <div className="text-sm">Built for agents, documented for humans.</div>
        <div className="flex gap-6 text-sm">
          {githubUrl ? <Link href={githubUrl} className="transition-colors hover:text-white">GitHub</Link> : null}
          <Link href="/download" className="transition-colors hover:text-white">Download</Link>
          <Link href="/#benchmark" className="transition-colors hover:text-white">Proof</Link>
        </div>
      </div>
    </footer>
  );
}
