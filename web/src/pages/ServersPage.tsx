import { useState } from "react";
import { Cable, Copy, LayoutGrid, List, Plus, Trash2, Wand2, Wrench } from "lucide-react";
import { Link } from "react-router-dom";
import { useConfig } from "@/hooks/useConfig";
import {
  applyProfileTools,
  deleteServer,
  fetchServerTools,
  putProfile,
  putServer,
  setProfileToolEnabled,
  setServerEnabled,
  setServerToolEnabled,
} from "@/lib/api";
import type { HttpServerConfig, McpTool, ServerConfig, StdioServerConfig } from "@/lib/types";
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
  disabledTools: string[];
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
  disabledTools: [],
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
      disabledTools: server.disabledTools ?? [],
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
    disabledTools: server.disabledTools ?? [],
  };
}

function toServerConfig(form: ServerForm): ServerConfig {
  if (form.type === "http") {
    const server: HttpServerConfig = {
      type: "http",
      enabled: form.enabled,
      cli: { enabled: form.cliEnabled },
      disabledTools: form.disabledTools,
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
    disabledTools: form.disabledTools,
    command: form.command,
    args: form.args.split(/\s+/).filter(Boolean),
  };
  const env = parseEnv(form.env);
  if (env) server.env = env;
  return server;
}

// Docs for other clients wrap a server in {"mcpServers": {"name": {...}}} (or
// "servers" for VS Code), so accept that shape on paste and keep the name.
function unwrapServerEntry(parsed: unknown): { name?: string; server: Record<string, unknown> } {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Server JSON must be an object");
  }
  const record = parsed as Record<string, unknown>;
  const wrapper = record.mcpServers ?? record.servers;
  if (!wrapper || typeof wrapper !== "object" || Array.isArray(wrapper)) {
    return { server: record };
  }
  const entries = Object.entries(wrapper as Record<string, unknown>);
  if (entries.length !== 1) {
    throw new Error("Paste a single server entry");
  }
  const [name, server] = entries[0];
  if (!server || typeof server !== "object" || Array.isArray(server)) {
    throw new Error(`Server "${name}" must be an object`);
  }
  return { name, server: server as Record<string, unknown> };
}

// Snippets copied from other clients usually omit our discriminator.
function withInferredType(server: Record<string, unknown>): Record<string, unknown> {
  if (server.type === "stdio" || server.type === "http") return server;
  const { type: _discarded, ...rest } = server;
  if (typeof rest.url === "string") return { type: "http", ...rest };
  if (typeof rest.command === "string") return { type: "stdio", ...rest };
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
  const [toolsServer, setToolsServer] = useState<string | null>(null);
  const [tools, setTools] = useState<McpTool[]>([]);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolsQuery, setToolsQuery] = useState("");
  const [toolsProfile, setToolsProfile] = useState("default");
  const [newProfileName, setNewProfileName] = useState("");
  const [applyTargets, setApplyTargets] = useState<string[]>([]);

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
        const { server: unwrapped } = unwrapServerEntry(JSON.parse(jsonValue));
        server = withInferredType(unwrapped) as unknown as ServerConfig;
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
      const { name, server } = unwrapServerEntry(JSON.parse(jsonValue));
      const parsed = withInferredType(server) as unknown as ServerConfig;
      if (parsed.type !== "stdio" && parsed.type !== "http") {
        throw new Error('Server type must be "stdio" or "http"');
      }
      setForm(serverToForm(form.name || (name ?? ""), parsed));
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

  // Pretty-prints, and unwraps a pasted {"mcpServers": {...}} block so the
  // editor always holds the single server object the API expects.
  const formatJson = () => {
    try {
      const { name, server } = unwrapServerEntry(JSON.parse(jsonValue));
      setJsonValue(JSON.stringify(withInferredType(server), null, 2));
      if (name && !form.name.trim() && !editing) {
        setForm((current) => ({ ...current, name }));
      }
      setFormError(null);
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

  const openTools = async (name: string) => {
    setToolsServer(name);
    setTools([]);
    setToolsQuery("");
    setToolsProfile(config?.defaultProfile ?? "default");
    setNewProfileName("");
    setApplyTargets([]);
    setToolsLoading(true);
    setFormError(null);
    try {
      const result = await fetchServerTools(name);
      setTools(result.tools);
    } catch (err) {
      const configuredNames = new Set([
        ...(config?.servers[name]?.disabledTools ?? []),
        ...Object.values(config?.profiles ?? {}).flatMap(
          (profile) => profile.denyTools?.[name] ?? [],
        ),
      ]);
      setTools([...configuredNames].map((toolName) => ({
        name: toolName,
        enabled: !(config?.servers[name]?.disabledTools ?? []).includes(toolName),
      })));
      setFormError(err instanceof Error ? err.message : "Failed to list tools");
    } finally {
      setToolsLoading(false);
    }
  };

  const toggleGlobalTool = async (toolName: string, enabled: boolean) => {
    if (!toolsServer) return;
    try {
      const result = await setServerToolEnabled(toolsServer, toolName, enabled);
      setConfig(result.config);
      setTools((current) =>
        current.map((tool) => tool.name === toolName ? { ...tool, enabled } : tool),
      );
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to update tool");
    }
  };

  const toggleProfileTool = async (toolName: string, enabled: boolean) => {
    if (!toolsServer) return;
    try {
      const result = await setProfileToolEnabled(toolsProfile, toolsServer, toolName, enabled);
      setConfig(result.config);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to update profile tool");
    }
  };

  const saveToolsAsProfile = async () => {
    if (!config || !toolsServer || !newProfileName.trim()) return;
    const source = config.profiles[toolsProfile];
    const allow = source
      ? source.allow.includes("*") || source.allow.includes(toolsServer)
        ? [...source.allow]
        : [...source.allow, toolsServer]
      : [toolsServer];
    try {
      const result = await putProfile(newProfileName.trim(), {
        allow,
        denyTools: structuredClone(source?.denyTools ?? {}),
      });
      setConfig(result.config);
      setToolsProfile(newProfileName.trim());
      setNewProfileName("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create profile");
    }
  };

  const applyToolsToProfiles = async () => {
    if (!toolsServer || applyTargets.length === 0) return;
    try {
      const result = await applyProfileTools(toolsProfile, toolsServer, applyTargets);
      setConfig(result.config);
      setApplyTargets([]);
      if (result.skipped.length > 0) {
        setFormError(`Skipped profiles that do not allow ${toolsServer}: ${result.skipped.join(", ")}`);
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to apply tool policy");
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
                    {(server.disabledTools?.length ?? 0) > 0 ? (
                      <Badge variant="destructive">{server.disabledTools!.length} tools off</Badge>
                    ) : null}
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
                  <Button variant="outline" size="sm" onClick={() => void openTools(name)}>
                    <Wrench className="h-4 w-4" />
                    Tools
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

      <Dialog open={Boolean(toolsServer)} onOpenChange={(next) => !next && setToolsServer(null)}>
        <DialogContent className="max-h-[90vh] w-[95vw] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Tool access — {toolsServer}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Global switches affect MCP, Playground, and CLI. Profile switches affect MCP clients
            unless another profile on the Token grants the tool.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label htmlFor="tool-search">Search tools</Label>
              <Input
                id="tool-search"
                value={toolsQuery}
                onChange={(event) => setToolsQuery(event.target.value)}
                placeholder="Tool name or description"
              />
            </div>
            <div className="grid gap-1">
              <Label>Profile policy</Label>
              <Select value={toolsProfile} onValueChange={setToolsProfile}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {config ? Object.keys(config.profiles).map((name) => (
                    <SelectItem key={name} value={name}>{name}</SelectItem>
                  )) : null}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2 rounded-md border p-3">
            <div className="grid grid-cols-[1fr_auto_auto] gap-4 text-xs font-medium text-muted-foreground">
              <span>Tool</span>
              <span>Global</span>
              <span>{toolsProfile}</span>
            </div>
            {toolsLoading ? <p className="text-sm text-muted-foreground">Loading tools…</p> : null}
            {!toolsLoading && tools.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Enable and connect the server to list tools. Configured disabled names remain in
                the server and profile JSON.
              </p>
            ) : null}
            {tools
              .filter((tool) => {
                const query = toolsQuery.trim().toLowerCase();
                return !query ||
                  tool.name.toLowerCase().includes(query) ||
                  tool.description?.toLowerCase().includes(query);
              })
              .map((tool) => {
                const profileDenied = Boolean(
                  config?.profiles[toolsProfile]?.denyTools?.[toolsServer ?? ""]?.includes(tool.name),
                );
                return (
                  <div key={tool.name} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-t pt-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{tool.name}</p>
                      {tool.description ? (
                        <p className="line-clamp-1 text-xs text-muted-foreground">{tool.description}</p>
                      ) : null}
                    </div>
                    <Switch
                      checked={tool.enabled !== false}
                      onCheckedChange={(enabled) => void toggleGlobalTool(tool.name, enabled)}
                      aria-label={`Globally ${tool.enabled === false ? "enable" : "disable"} ${tool.name}`}
                    />
                    <Switch
                      checked={!profileDenied}
                      onCheckedChange={(enabled) => void toggleProfileTool(tool.name, enabled)}
                      aria-label={`${profileDenied ? "Enable" : "Disable"} ${tool.name} for ${toolsProfile}`}
                    />
                  </div>
                );
              })}
          </div>
          <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="new-profile">Save policy as new profile</Label>
              <div className="flex gap-2">
                <Input
                  id="new-profile"
                  value={newProfileName}
                  onChange={(event) => setNewProfileName(event.target.value)}
                  placeholder="profile-name"
                />
                <Button
                  variant="outline"
                  disabled={!newProfileName.trim()}
                  onClick={() => void saveToolsAsProfile()}
                >
                  Save
                </Button>
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Apply this server policy to profiles</Label>
              <div className="flex flex-wrap gap-2">
                {config ? Object.keys(config.profiles)
                  .filter((name) => name !== toolsProfile)
                  .map((name) => (
                    <Button
                      key={name}
                      type="button"
                      size="sm"
                      variant={applyTargets.includes(name) ? "default" : "outline"}
                      onClick={() =>
                        setApplyTargets((current) =>
                          current.includes(name)
                            ? current.filter((item) => item !== name)
                            : [...current, name],
                        )
                      }
                    >
                      {name}
                    </Button>
                  )) : null}
              </div>
              <Button
                variant="outline"
                disabled={applyTargets.length === 0}
                onClick={() => void applyToolsToProfiles()}
              >
                Apply
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
            <div className="flex items-center justify-between gap-2">
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
                <Button type="button" size="sm" variant="outline" onClick={formatJson}>
                  <Wand2 className="h-4 w-4" />
                  Format
                </Button>
              ) : null}
            </div>

            {editorMode === "json" ? (
              <div className="grid gap-1">
                <Label htmlFor="server-json">Server configuration</Label>
                <JsonEditor
                  id="server-json"
                  value={jsonValue}
                  onValueChange={setJsonValue}
                  minRows={26}
                  containerClassName="min-h-[50vh] max-h-[65vh] resize-y"
                />
                <p className="text-xs text-muted-foreground">
                  Enter one server object. A pasted <code>mcpServers</code> block is unwrapped on
                  Format or Save. The server name is set separately above.
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
