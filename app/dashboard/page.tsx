"use client";

import { useState } from "react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { RefreshCw, Binary, Box } from "lucide-react";
import { DependencyGraph } from "@/components/DependencyGraph";

export default function Dashboard() {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchError, setSearchError] = useState("");

  const [indexStatus, setIndexStatus] = useState("");
  const [indexProgress, setIndexProgress] = useState<{ current: number, total: number } | null>(null);
  
  const [capsule, setCapsule] = useState<any>(null);

  const [repoPath, setRepoPath] = useState("");

  const [apiKey, setApiKey] = useState("");
  const [authUser, setAuthUser] = useState<{ user: string; role: string } | null>(null);
  const [authError, setAuthError] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || "Login failed");
        setAuthUser(null);
      } else {
        setAuthUser({ user: data.user, role: data.role });
        setApiKey("");
      }
    } catch {
      setAuthError("Login request failed");
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setSearchError("");
    setCapsule(null);
    try {
      const res = await fetch("/api/mcp/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery, path: repoPath.trim() || undefined })
      });
      const data = await res.json();
      if (!res.ok) {
        setSearchError(data.error);
        setSearchResults([]);
      } else {
        setSearchResults(data.results);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleIndexRepo = () => {
    setIndexStatus("Connecting to Tree-sitter Indexer...");
    setIndexProgress({ current: 0, total: 100 });
    
    const qs = repoPath.trim() ? `?path=${encodeURIComponent(repoPath.trim())}` : "";
    const eventSource = new EventSource(`/api/mcp/index${qs}`);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.error) {
        setIndexStatus(`Error: ${data.error}`);
        setIndexProgress(null);
        eventSource.close();
      } else if (data.done) {
        setIndexStatus(`Tree-sitter Graph Built: Extracted ${data.result.symbolsExtracted} symbols. scanned ${data.result.scannedFiles} files.`);
        setIndexProgress(null);
        eventSource.close();
      } else if (data.progress !== undefined) {
        setIndexStatus("Running AST Indexer...");
        setIndexProgress({ current: data.progress, total: data.total });
      }
    };

    eventSource.onerror = () => {
      setIndexStatus("Failed to contact engine.");
      setIndexProgress(null);
      eventSource.close();
    };
  };

  const fetchCapsule = async (symbolId: string) => {
    try {
      const res = await fetch("/api/mcp/capsule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbolId, path: repoPath.trim() || undefined })
      });
      const data = await res.json();
      if (res.ok) { setCapsule(data.capsule); }
    } catch(err) {}
  };

  return (
    <div className="flex flex-col min-h-screen bg-slate-950 text-slate-300">
      <Navbar />
      <main className="flex-1 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="mb-8 border-b border-slate-800 pb-8 flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-white mb-2 flex items-center gap-3">
                <Box className="w-8 h-8 text-blue-500" />
                OmniCode Cockpit
              </h1>
              <p className="text-slate-400 max-w-2xl text-sm">
                Real-time AST visualization. Query the Symbol Graph and preview code retrieval capsules.
              </p>
            </div>
            <div className="shrink-0 w-64 text-right">
               <button onClick={handleIndexRepo} className="bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg text-sm px-4 py-2.5 transition-colors flex items-center justify-end gap-2 ml-auto">
                  <RefreshCw className="w-4 h-4" />
                  <span>Rebuild Symbol Graph</span>
               </button>
               {indexStatus && (
                  <div className="text-xs text-slate-400 mt-2">
                    {indexStatus}
                  </div>
               )}
               {indexProgress && indexProgress.total > 0 && (
                 <div className="w-full bg-slate-800 rounded-full h-1.5 mt-2 overflow-hidden flex">
                    <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-300" style={{ width: `${(indexProgress.current / indexProgress.total) * 100}%` }}></div>
                 </div>
               )}
            </div>
          </div>

          <div className="mb-6">
            {authUser ? (
              <div className="flex items-center gap-3 text-xs">
                <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-950/60 border border-emerald-800 text-emerald-300">
                  ● Authenticated as <span className="font-mono">{authUser.user}</span>
                  <span className="px-1.5 py-0.5 rounded bg-emerald-900 text-emerald-200 uppercase">{authUser.role}</span>
                </span>
              </div>
            ) : (
              <form onSubmit={handleLogin} className="flex items-center gap-3">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Enter API key to authenticate (RBAC + audit active)"
                  className="bg-slate-950 border border-slate-800 text-white text-xs rounded-lg block w-96 px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <button type="submit" className="text-white bg-blue-600 hover:bg-blue-700 font-medium rounded-lg text-xs px-4 py-2 transition">Authenticate</button>
                {authError && <span className="text-xs text-rose-500">{authError}</span>}
              </form>
            )}
          </div>

          <div className="mb-6">
            <label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wider">Target Repository Path</label>
            <input
              type="text"
              value={repoPath}
              onChange={(e) => setRepoPath(e.target.value)}
              placeholder="Leave empty to index this app's own folder"
              className="bg-slate-950 border border-slate-800 text-white text-xs rounded-lg block w-full px-3 py-2 focus:ring-blue-500 focus:border-blue-500 font-mono"
            />
          </div>

          <div className="grid grid-cols-1 gap-6">
            <div className="lg:col-span-1">
              <div className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden flex flex-col h-[650px]">
                <div className="p-6 flex-1 flex gap-6 h-full overflow-hidden">
                      <div className="flex-1 flex flex-col h-full overflow-hidden">
                        <form onSubmit={handleSearch} className="flex gap-3 mb-4 shrink-0">
                          <div className="relative flex-1">
                            <Binary className="absolute inset-y-0 left-3 top-2.5 w-4 h-4 text-slate-500" />
                            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="bg-slate-950 border border-slate-800 text-white text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full pl-10 p-2.5" placeholder="Query the AST... (e.g. 'Button', 'index', 'Hero')" />
                          </div>
                          <button type="submit" className="text-white bg-slate-800 hover:bg-slate-700 font-medium rounded-lg text-sm px-5 py-2.5 transition">Query</button>
                        </form>
                        {searchError && <div className="text-xs text-rose-500 mb-4">{searchError}</div>}
                        <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                          {searchResults.length > 0 ? (
                            <div className="space-y-2">
                              {searchResults.map((res) => (
                                <div key={res.id} onClick={() => fetchCapsule(res.id)} className="p-3 bg-slate-950 border border-slate-800 rounded-lg hover:border-blue-500/50 cursor-pointer transition-colors group">
                                  <div className="flex justify-between items-start mb-2">
                                    <span className="font-mono text-blue-400 font-medium group-hover:text-blue-300">{res.name}</span>
                                    <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded uppercase">{res.kind}</span>
                                  </div>
                                  <div className="flex justify-between items-end">
                                    <span className="text-xs text-slate-500 truncate max-w-[250px]">{res.file}:{res.line}</span>
                                    <span className="text-[10px] text-slate-400">Score: {res.goopScore}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="h-full flex items-center justify-center text-slate-600 text-sm">No results. Run the indexer or change your query.</div>
                          )}
                        </div>
                      </div>

                      {/* Capsule Panel */}
                      <div className="w-1/2 bg-slate-950 border border-slate-800 rounded-xl flex flex-col h-full overflow-hidden">
                        <div className="bg-slate-900 border-b border-slate-800 px-4 py-2 shrink-0 flex justify-between items-center">
                          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Context Capsule</span>
                          {capsule && <span className="text-[10px] text-emerald-500">Confidence: {capsule.confidenceScore}%</span>}
                        </div>
                        <div className="p-4 flex-1 overflow-y-auto custom-scrollbar">
                          {capsule ? (
                            <div className="space-y-4">
                              <div>
                                <div className="flex justify-between items-center mb-1">
                                  <span className="text-lg font-mono text-white">{capsule.target}</span>
                                </div>
                              </div>
                              
                              <div>
                                <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Dependency Graph</span>
                                <div className="mt-1">
                                  <DependencyGraph capsule={capsule} />
                                </div>
                              </div>

                              <div>
                                <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Exact Source Fragment</span>
                                <pre className="mt-1 bg-slate-900 border border-slate-800 rounded p-3 text-xs text-slate-300 font-mono overflow-x-auto">
                                  {capsule.exactSource}
                                </pre>
                              </div>

                              {capsule.callersInfo && capsule.callersInfo.length > 0 && (
                                <div>
                                  <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Known Dependents</span>
                                  <ul className="mt-1 space-y-1">
                                    {capsule.callersInfo.map((c: any, i: number) => (
                                      <li key={i} className="text-xs font-mono text-slate-400">→ {c.name} <span className="text-slate-600">({c.file})</span></li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="h-full flex items-center justify-center text-slate-700 text-xs text-center p-6">
                              Select a symbol from the Symbol Graph to generate an exact codebase context capsule.
                            </div>
                          )}
                        </div>
                      </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
