import { Navbar } from "@/components/Navbar";
import { Hero } from "@/components/Hero";
import { Stats } from "@/components/Stats";
import { Audience } from "@/components/Audience";
import { Benchmark } from "@/components/Benchmark";
import { Economics } from "@/components/Economics";
import { Architecture } from "@/components/Architecture";
import { Products } from "@/components/Products";
import { Pricing } from "@/components/Pricing";
import { Footer } from "@/components/Footer";

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />
      <main className="flex-1">
        <Hero />
        <Stats />
        <Audience />
        <Benchmark />
        <Economics />
        <Architecture />
        <Products />
        <Pricing />
      </main>
      <Footer />
    </div>
  );
}
