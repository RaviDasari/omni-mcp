import { Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import Navbar from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { fetchHealth } from "@/lib/api";

export default function AppLayout() {
  const [version, setVersion] = useState<string>();

  useEffect(() => {
    void fetchHealth()
      .then((h) => setVersion(h.version))
      .catch(() => undefined);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 flex flex-col overflow-x-clip">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full flex-1 min-w-0">
        <Outlet />
      </main>
      <Footer version={version} />
    </div>
  );
}
