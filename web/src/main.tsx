import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import AppLayout from "@/components/AppLayout";
import OverviewPage from "@/pages/OverviewPage";
import ServersPage from "@/pages/ServersPage";
import ProfilesPage from "@/pages/ProfilesPage";
import TokensPage from "@/pages/TokensPage";
import IdePage from "@/pages/IdePage";
import LogsPage from "@/pages/LogsPage";
import PlaygroundPage from "@/pages/PlaygroundPage";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem>
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/servers" element={<ServersPage />} />
            <Route path="/profiles" element={<ProfilesPage />} />
            <Route path="/tokens" element={<TokensPage />} />
            <Route path="/ide" element={<IdePage />} />
            <Route path="/logs" element={<LogsPage />} />
            <Route path="/playground" element={<PlaygroundPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);
