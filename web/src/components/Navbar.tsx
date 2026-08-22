import { NavLink } from "react-router-dom";
import { Activity, Cable, KeyRound, ListFilter, Menu, Shield, Terminal, Wrench } from "lucide-react";
import ThemeToggle from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const links = [
  { to: "/", label: "Overview", icon: Activity, end: true },
  { to: "/servers", label: "Servers", icon: Cable },
  { to: "/profiles", label: "Profiles", icon: Shield },
  { to: "/tokens", label: "Tokens", icon: KeyRound },
  { to: "/logs", label: "Logs", icon: ListFilter },
  { to: "/playground", label: "Playground", icon: Wrench },
  { to: "/ide", label: "IDE", icon: Terminal },
];

export default function Navbar() {
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
              <p className="text-xs text-muted-foreground hidden sm:block">Local MCP gateway</p>
            </div>
          </NavLink>

          <nav className="flex items-center gap-4 sm:gap-6 shrink-0">
            {links.map((link) => (
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
            <ThemeToggle />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
                  <Menu className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 lg:hidden">
                {links.map((link) => (
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
