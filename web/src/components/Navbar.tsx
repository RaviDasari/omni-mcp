import { NavLink, useLocation } from "react-router-dom";
import {
  Activity,
  Cable,
  EllipsisVertical,
  KeyRound,
  Keyboard,
  ListFilter,
  Menu,
  Shield,
  ShieldCheck,
  Terminal,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import ThemeToggle from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

const primaryLinks: NavItem[] = [
  { to: "/", label: "Overview", icon: Activity, end: true },
  { to: "/servers", label: "MCP Servers", icon: Cable },
  { to: "/cli", label: "CLI", icon: Keyboard },
];

const secondaryLinks: NavItem[] = [
  { to: "/logs", label: "Logs", icon: ListFilter },
  { to: "/playground", label: "Playground", icon: Wrench },
  { to: "/tokens", label: "Tokens", icon: KeyRound },
  { to: "/secrets", label: "Secrets", icon: ShieldCheck },
  { to: "/profiles", label: "Profiles", icon: Shield },
  { to: "/ide", label: "IDE", icon: Terminal },
];

export default function Navbar() {
  const location = useLocation();
  const allLinks = [...primaryLinks, ...secondaryLinks];
  const secondaryActive = secondaryLinks.some((link) => location.pathname === link.to);

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <NavLink to="/" className="flex items-center gap-3 group shrink-0">
            <div className="w-10 h-10 bg-gradient-to-br from-[var(--accent-primary)] to-[var(--highlight)] rounded-xl flex items-center justify-center shadow-lg group-hover:shadow-xl transition-shadow">
              <Cable className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">omni-mcp</h1>
              <p className="text-xs text-muted-foreground hidden sm:block">Local MCP Gateway &amp; Server Manager</p>
            </div>
          </NavLink>

          <nav className="flex items-center gap-4 sm:gap-6 shrink-0">
            {primaryLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  [
                    "text-sm font-medium transition-colors hidden lg:flex items-center gap-1",
                    isActive
                      ? "text-[var(--accent-primary)]"
                      : "text-muted-foreground hover:text-[var(--accent-primary)]",
                  ].join(" ")
                }
              >
                <link.icon className="h-4 w-4" />
                {link.label}
              </NavLink>
            ))}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={[
                    "hidden lg:inline-flex",
                    secondaryActive ? "text-[var(--accent-primary)]" : "text-muted-foreground",
                  ].join(" ")}
                  aria-label="Open more navigation"
                >
                  <EllipsisVertical className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {secondaryLinks.map((link) => (
                  <DropdownMenuItem key={link.to} asChild>
                    <NavLink
                      to={link.to}
                      className={({ isActive }) =>
                        [
                          "flex items-center gap-2 cursor-pointer w-full",
                          isActive ? "text-[var(--accent-primary)]" : "",
                        ].join(" ")
                      }
                    >
                      <link.icon className="h-4 w-4" />
                      {link.label}
                    </NavLink>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <ThemeToggle />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
                  <Menu className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 lg:hidden">
                {allLinks.map((link) => (
                  <DropdownMenuItem key={link.to} asChild>
                    <NavLink
                      to={link.to}
                      end={link.end}
                      className={({ isActive }) =>
                        [
                          "flex items-center gap-2 cursor-pointer w-full",
                          isActive ? "text-[var(--accent-primary)]" : "",
                        ].join(" ")
                      }
                    >
                      <link.icon className="h-4 w-4" />
                      {link.label}
                    </NavLink>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>
        </div>
      </div>
    </header>
  );
}
