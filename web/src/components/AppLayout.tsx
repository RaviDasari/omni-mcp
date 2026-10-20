import { Outlet } from "react-router-dom";
import Navbar from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { ConfigIssuesBanner } from "@/components/ConfigIssuesBanner";
import { useHealth } from "@/hooks/useHealth";

export default function AppLayout() {
  const { health } = useHealth();
  const version = health?.version;

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 flex flex-col overflow-x-clip">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full flex-1 min-w-0">
        <ConfigIssuesBanner health={health} />
        <Outlet />
      </main>
      <Footer version={version} />
    </div>
  );
}
