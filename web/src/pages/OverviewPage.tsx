import { useEffect, useState } from "react";
import { Activity, RefreshCw, Server } from "lucide-react";
import { fetchHealth, postReload, setServerEnabled } from "@/lib/api";
import type { HealthPayload } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "connected") return "default";
  if (status === "error") return "destructive";
  return "secondary";
}

export default function OverviewPage() {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  const load = async () => {
    try {
      setError(null);
      setHealth(await fetchHealth());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load health");
    }
  };

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(id);
  }, []);

  const connected = health
    ? Object.values(health.servers).filter((s) => s.status === "connected").length
    : 0;
  const total = health ? Object.keys(health.servers).length : 0;

  const toggleServer = async (name: string, enabled: boolean) => {
    setToggling(name);
    setError(null);
    try {
      const result = await setServerEnabled(name, enabled);
      setHealth(result.health);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update server");
    } finally {
      setToggling(null);
    }
  };

  return (
    <div>
      <div className="mb-8 flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-[var(--accent-primary)]/10 flex items-center justify-center">
            <Activity className="h-7 w-7 text-[var(--accent-primary)]" />
          </div>
          <div>
            <h2 className="text-3xl font-bold text-foreground">Overview</h2>
            <p className="text-muted-foreground">Gateway status and connected MCP servers</p>
          </div>
        </div>
        <Button
          variant="outline"
          disabled={reloading}
          onClick={() => {
            void (async () => {
              setReloading(true);
              try {
                await postReload();
                await load();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Reload failed");
              } finally {
                setReloading(false);
              }
            })();
          }}
        >
          <RefreshCw className={`h-4 w-4 ${reloading ? "animate-spin" : ""}`} />
          Reload config
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {health ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3 mb-8">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Listening</CardTitle>
                <CardDescription>
                  http://{health.host}:{health.port}
                </CardDescription>
              </CardHeader>
              <CardContent className="text-2xl font-semibold">{health.status}</CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Uptime</CardTitle>
                <CardDescription>v{health.version}</CardDescription>
              </CardHeader>
              <CardContent className="text-2xl font-semibold">{formatUptime(health.uptime)}</CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Servers</CardTitle>
                <CardDescription>Default profile: {health.defaultProfile}</CardDescription>
              </CardHeader>
              <CardContent className="text-2xl font-semibold">
                {connected}/{total} connected
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-4 w-4" />
                Server health
              </CardTitle>
              <CardDescription>{health.configPath ?? "Config path unknown"}</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Transport</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Restarts</TableHead>
                    <TableHead className="text-right">Enabled</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(health.servers).map(([name, info]) => (
                    <TableRow key={name}>
                      <TableCell className="font-medium">{name}</TableCell>
                      <TableCell>{info.transport}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(info.status)}>{info.status}</Badge>
                      </TableCell>
                      <TableCell>{info.restarts}</TableCell>
                      <TableCell className="text-right">
                        <Switch
                          checked={info.enabled}
                          disabled={toggling === name}
                          onCheckedChange={(enabled) => void toggleServer(name, enabled)}
                          aria-label={`${info.enabled ? "Disable" : "Enable"} ${name} globally`}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : (
        <p className="text-muted-foreground">Loading…</p>
      )}
    </div>
  );
}
