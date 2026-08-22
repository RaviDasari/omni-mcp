import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Check, Copy, Keyboard, TerminalSquare } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useConfig } from "@/hooks/useConfig";
import { fetchCliServers, fetchHealth, setServerCliEnabled } from "@/lib/api";
import type { CliServerSummary, HealthPayload } from "@/lib/types";

export default function CliPage() {
  const { config, setConfig, loading, error } = useConfig();
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [summaries, setSummaries] = useState<CliServerSummary[]>([]);
  const [pageError, setPageError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextHealth, cli] = await Promise.all([fetchHealth(), fetchCliServers()]);
      setHealth(nextHealth);
      setSummaries(cli.servers);
      setPageError(null);
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Failed to load CLI status");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const summaryByName = useMemo(
    () => new Map(summaries.map((summary) => [summary.name, summary])),
    [summaries],
  );

  const toggle = async (name: string, enabled: boolean) => {
    setToggling(name);
    setPageError(null);
    try {
      const result = await setServerCliEnabled(name, enabled);
      setConfig(result.config);
      setHealth(result.health);
      await refresh();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Failed to update CLI access");
    } finally {
      setToggling(null);
    }
  };

  const copy = async (id: string, command: string) => {
    await navigator.clipboard.writeText(command);
    setCopied(id);
    window.setTimeout(() => setCopied((current) => current === id ? null : current), 1500);
  };

  return (
    <div>
      <div className="mb-8 flex items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent-primary)]/10">
          <Keyboard className="h-7 w-7 text-[var(--accent-primary)]" />
        </div>
        <div>
          <h2 className="text-3xl font-bold text-foreground">CLI</h2>
          <p className="text-muted-foreground">
            Expose selected managed MCP servers through the omni-mcp command line
          </p>
        </div>
      </div>

      <Alert className="mb-6">
        <TerminalSquare className="h-4 w-4" />
        <AlertDescription>
          The gateway must be running. CLI access is local, bypasses profiles, and can invoke
          side-effecting tools. Enable only servers you trust.
        </AlertDescription>
      </Alert>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-[var(--accent-primary)]" />
            Teach Cursor and Claude
          </CardTitle>
          <CardDescription>
            Install the bundled agent skill so coding agents discover tools narrowly, inspect
            runtime help, and use machine-readable CLI output.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2">
            <code className="min-w-0 flex-1 overflow-x-auto text-xs">
              omni-mcp cli install-skill
            </code>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void copy("install-skill", "omni-mcp cli install-skill")}
              aria-label="Copy agent skill installation command"
            >
              {copied === "install-skill"
                ? <Check className="h-4 w-4" />
                : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Installs user-wide skills for both Cursor and Claude. Start a new agent session
            afterward.
          </p>
        </CardContent>
      </Card>

      {error || pageError ? (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{error ?? pageError}</AlertDescription>
        </Alert>
      ) : null}

      {loading || !config ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {Object.entries(config.servers).map(([name, server]) => {
            const cliEnabled = server.cli?.enabled === true;
            const serverHealth = health?.servers[name];
            const summary = summaryByName.get(name);
            const status = serverHealth?.status ?? "unknown";
            return (
              <Card key={name}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <CardTitle className="flex flex-wrap items-center gap-2">
                        {name}
                        <Badge variant="secondary">{server.type}</Badge>
                        <Badge variant={status === "connected" ? "default" : "outline"}>
                          {status}
                        </Badge>
                      </CardTitle>
                      <CardDescription className="mt-2">
                        {cliEnabled
                          ? `${summary?.toolCount ?? 0} tools available`
                          : "Not exposed to the CLI"}
                      </CardDescription>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-muted-foreground">
                      CLI
                      <Switch
                        checked={cliEnabled}
                        disabled={toggling === name}
                        onCheckedChange={(enabled) => void toggle(name, enabled)}
                        aria-label={`${cliEnabled ? "Disable" : "Enable"} CLI access for ${name}`}
                      />
                    </label>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2">
                    <code className="min-w-0 flex-1 overflow-x-auto text-xs">
                      omni-mcp cli {name} --list
                    </code>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={!cliEnabled}
                      onClick={() => void copy(name, `omni-mcp cli ${name} --list`)}
                      aria-label={`Copy CLI command for ${name}`}
                    >
                      {copied === name
                        ? <Check className="h-4 w-4" />
                        : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
