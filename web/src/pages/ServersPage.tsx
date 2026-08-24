import { useState } from "react";
import { Cable, Copy, LayoutGrid, List, Plus, Trash2, Wrench } from "lucide-react";
import { Link } from "react-router-dom";
import { useConfig } from "@/hooks/useConfig";
import { deleteServer, putServer, setServerEnabled } from "@/lib/api";
import type { HttpServerConfig, ServerConfig, StdioServerConfig } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { JsonEditor } from "@/components/ui/json-editor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

interface ServerForm {
  name: string;
  type: "stdio" | "http";
  command: string;
  args: string;
  env: string;
  url: string;
  authToken: string;
  enabled: boolean;
  cliEnabled: boolean;
}

const emptyForm: ServerForm = {
  name: "",
  type: "stdio",
  command: "npx",
  args: "-y @modelcontextprotocol/server-filesystem .",
  env: "",
  url: "",
  authToken: "",
  enabled: true,
  cliEnabled: false,
};

function parseEnv(text: string): Record<string, string> | undefined {
  const env: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return Object.keys(env).length ? env : undefined;
}

function envToText(env?: Record<string, string>): string {
  if (!env) return "";
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

function serverToForm(name: string, server: ServerConfig): ServerForm {
  if (server.type === "stdio") {
    return {
      name,
      type: "stdio",
      command: server.command,
      args: (server.args ?? []).join(" "),
      env: envToText(server.env),
      url: "",
      authToken: "",
      enabled: server.enabled !== false,
      cliEnabled: server.cli?.enabled === true,
    };
  }

  return {
    name,
    type: "http",
    command: "",
    args: "",
    env: "",
    url: server.url,
    authToken: server.auth?.token ?? "",
    enabled: server.enabled !== false,
    cliEnabled: server.cli?.enabled === true,
  };
}

function toServerConfig(form: ServerForm): ServerConfig {
  if (form.type === "http") {
    const server: HttpServerConfig = {
      type: "http",
      enabled: form.enabled,
      cli: { enabled: form.cliEnabled },
      url: form.url,
    };
    if (form.authToken) {
      server.auth = { type: "jwt", token: form.authToken };
    }
    return server;
  }
  const server: StdioServerConfig = {
    type: "stdio",
    enabled: form.enabled,
    cli: { enabled: form.cliEnabled },
    command: form.command,
    args: form.args.split(/\s+/).filter(Boolean),
  };
  const env = parseEnv(form.env);
  if (env) server.env = env;
  return server;
}

export default function ServersPage() {
  const { config, setConfig, error, loading } = useConfig();
  const [formError, setFormError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<ServerForm>(emptyForm);
  const [toggling, setToggling] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<"ui" | "json">("ui");
  const [jsonValue, setJsonValue] = useState("");
  const [viewMode, setViewMode] = useState<"tiles" | "list">("tiles");

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setEditorMode("ui");
    setJsonValue(JSON.stringify(toServerConfig(emptyForm), null, 2));
    setFormError(null);
    setOpen(true);
  };

  const openEdit = (name: string, server: ServerConfig) => {
    setEditing(name);
    setForm(serverToForm(name, server));
    setEditorMode("ui");
    setJsonValue(JSON.stringify(server, null, 2));
    setFormError(null);
    setOpen(true);
  };

  const openClone = (name: string, server: ServerConfig) => {
    const baseName = `${name}-copy`;
    let cloneName = baseName;
    let suffix = 2;
    while (config?.servers[cloneName]) {
      cloneName = `${baseName}-${suffix}`;
      suffix += 1;
    }
    setEditing(null);
    setForm(serverToForm(cloneName, structuredClone(server)));
    setEditorMode("json");
    setJsonValue(JSON.stringify(server, null, 2));
    setFormError(null);
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) {
      setFormError("Name is required");
      return;
    }
    try {
      let server: ServerConfig;
      if (editorMode === "json") {
        const parsed = JSON.parse(jsonValue) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("Server JSON must be an object");
        }
        server = parsed as ServerConfig;
      } else {
        server = toServerConfig(form);
      }
      const result = await putServer(form.name.trim(), server);
      setConfig(result.config);
      setOpen(false);
    } catch (err) {
      setFormError(
        err instanceof SyntaxError
          ? `Invalid JSON: ${err.message}`
          : err instanceof Error
            ? err.message
            : "Save failed",
      );
    }
  };

  const changeEditorMode = (mode: "ui" | "json") => {
    if (mode === editorMode) return;

    if (mode === "json") {
      setJsonValue(JSON.stringify(toServerConfig(form), null, 2));
      setFormError(null);
      setEditorMode("json");
      return;
    }

    try {
      const parsed = JSON.parse(jsonValue) as ServerConfig;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Server JSON must be an object");
      }
      if (parsed.type !== "stdio" && parsed.type !== "http") {
        throw new Error('Server type must be "stdio" or "http"');
      }
      setForm(serverToForm(form.name, parsed));
      setFormError(null);
      setEditorMode("ui");
    } catch (err) {
      setFormError(
        err instanceof SyntaxError
          ? `Invalid JSON: ${err.message}`
          : err instanceof Error
            ? err.message
            : "Invalid server JSON",
      );
    }
  };

  const remove = async (name: string) => {
    if (!window.confirm(`Remove server "${name}"?`)) return;
    try {
      const result = await deleteServer(name);
      setConfig(result.config);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const toggleServer = async (name: string, enabled: boolean) => {
    setToggling(name);
    setFormError(null);
    try {
      const result = await setServerEnabled(name, enabled);
      setConfig(result.config);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to update server");
    } finally {
      setToggling(null);
    }
  };

  return (
    <div>
      <div className="mb-8 flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-[var(--accent-primary)]/10 flex items-center justify-center">
            <Cable className="h-7 w-7 text-[var(--accent-primary)]" />
          </div>
          <div>
            <h2 className="text-3xl font-bold text-foreground">Servers</h2>
            <p className="text-muted-foreground">Add, edit, or remove upstream MCP servers</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border p-1" aria-label="Server view">
            <Button
              variant={viewMode === "tiles" ? "secondary" : "ghost"}
              size="icon"
              className="h-7 w-7"
              onClick={() => setViewMode("tiles")}
              aria-label="Tile view"
              title="Tile view"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="icon"
              className="h-7 w-7"
              onClick={() => setViewMode("list")}
              aria-label="List view"
              title="List view"
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Add server</span>
          </Button>
        </div>
      </div>

      {error || formError ? (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{error ?? formError}</AlertDescription>
        </Alert>
      ) : null}

      {loading || !config ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <div className={viewMode === "tiles" ? "grid gap-4 md:grid-cols-2" : "grid gap-3"}>
          {Object.entries(config.servers).map(([name, server]) => (
            <Card key={name} className={viewMode === "list" ? "md:flex md:items-center" : ""}>
              <CardHeader
                className={
                  viewMode === "list"
                    ? "flex flex-1 flex-row items-start justify-between space-y-0 md:items-center"
                    : "flex flex-row items-start justify-between space-y-0"
                }
              >
                <div>
                  <CardTitle className="flex items-center gap-2">
                    {name}
                    <Badge variant="secondary">{server.type}</Badge>
                    {server.enabled === false ? <Badge variant="outline">disabled</Badge> : null}
                  </CardTitle>
                  <CardDescription className="mt-1 break-all">
                    {server.type === "stdio"
                      ? `${server.command} ${(server.args ?? []).join(" ")}`
                      : server.url}
                  </CardDescription>
                </div>
                {viewMode === "tiles" ? (
                  <Button variant="ghost" size="icon" onClick={() => void remove(name)} aria-label={`Remove ${name}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </CardHeader>
              <CardContent
                className={
                  viewMode === "list"
                    ? "flex flex-wrap items-center justify-end gap-3 md:py-4"
                    : "flex flex-wrap items-center justify-between gap-4"
                }
              >
                {server.type === "stdio" && server.env ? (
                  <p className={viewMode === "list" ? "hidden text-xs text-muted-foreground xl:block" : "text-xs text-muted-foreground"}>
                    Env: {Object.keys(server.env).join(", ")} (values hidden)
                  </p>
                ) : (
                  <span />
                )}
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    Enabled
                    <Switch
                      checked={server.enabled !== false}
                      disabled={toggling === name}
                      onCheckedChange={(enabled) => void toggleServer(name, enabled)}
                      aria-label={`${server.enabled === false ? "Enable" : "Disable"} ${name} globally`}
                    />
                  </label>
                  <Button variant="outline" size="sm" asChild>
                    <Link to={`/playground?server=${encodeURIComponent(name)}`}>
                      <Wrench className="h-4 w-4" />
                      Test
                    </Link>
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openClone(name, server)}>
                    <Copy className="h-4 w-4" />
                    Clone
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openEdit(name, server)}>
                    Edit
                  </Button>
                  {viewMode === "list" ? (
                    <Button variant="ghost" size="icon" onClick={() => void remove(name)} aria-label={`Remove ${name}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className={
            editorMode === "json"
              ? "max-h-[90vh] w-[95vw] max-w-4xl overflow-y-auto"
              : "max-h-[90vh] w-[95vw] max-w-2xl overflow-y-auto"
          }
        >
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing}` : "Add server"}</DialogTitle>
          </DialogHeader>
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          <div className="grid gap-3 py-2">
            <div className="grid gap-1">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={form.name}
                disabled={Boolean(editing)}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="flex rounded-md border p-1 w-fit">
              <Button
                type="button"
                size="sm"
                variant={editorMode === "ui" ? "secondary" : "ghost"}
                onClick={() => changeEditorMode("ui")}
              >
                Form
              </Button>
              <Button
                type="button"
                size="sm"
                variant={editorMode === "json" ? "secondary" : "ghost"}
                onClick={() => changeEditorMode("json")}
              >
                JSON
              </Button>
            </div>

            {editorMode === "json" ? (
              <div className="grid gap-1">
                <Label htmlFor="server-json">Server configuration</Label>
                <JsonEditor
                  id="server-json"
                  value={jsonValue}
                  onValueChange={setJsonValue}
                  minRows={18}
                  containerClassName="max-h-[55vh]"
                />
                <p className="text-xs text-muted-foreground">
                  Enter one server object. The server name is set separately above.
                </p>
              </div>
            ) : (
              <>
                <div className="grid gap-1">
                  <Label>Type</Label>
                  <Select
                    value={form.type}
                    onValueChange={(value) => setForm({ ...form, type: value as "stdio" | "http" })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="stdio">stdio</SelectItem>
                      <SelectItem value="http">http</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.type === "stdio" ? (
                  <>
                    <div className="grid gap-1">
                      <Label htmlFor="command">Command</Label>
                      <Input
                        id="command"
                        value={form.command}
                        onChange={(e) => setForm({ ...form, command: e.target.value })}
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor="args">Args</Label>
                      <Input
                        id="args"
                        value={form.args}
                        onChange={(e) => setForm({ ...form, args: e.target.value })}
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor="env">Env (KEY=value per line). Prefer $NAME references managed on the Secrets page.</Label>
                      <Textarea
                        id="env"
                        value={form.env}
                        onChange={(e) => setForm({ ...form, env: e.target.value })}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="grid gap-1">
                      <Label htmlFor="url">URL</Label>
                      <Input id="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor="jwt">JWT (use $NAME from Secrets; leave ******** to keep a literal)</Label>
                      <Input
                        id="jwt"
                        value={form.authToken}
                        onChange={(e) => setForm({ ...form, authToken: e.target.value })}
                      />
                    </div>
                  </>
                )}
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void save()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
