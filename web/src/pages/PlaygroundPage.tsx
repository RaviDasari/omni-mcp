import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Braces,
  CircleAlert,
  Copy,
  LoaderCircle,
  Play,
  RefreshCw,
  Search,
  Wrench,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { callServerTool, fetchServerTools } from "@/lib/api";
import type { McpTool, ServerToolCallResponse, ServerToolsResponse } from "@/lib/types";
import { useConfig } from "@/hooks/useConfig";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function schemaTemplate(schema?: Record<string, unknown>): string {
  const value = schemaValue(schema);
  return JSON.stringify(isRecord(value) ? value : {}, null, 2);
}

function schemaValue(schema?: Record<string, unknown>): unknown {
  if (!schema) return {};
  if ("default" in schema) return schema.default;
  if (Array.isArray(schema.examples) && schema.examples.length > 0) return schema.examples[0];

  if (schema.type === "object" || isRecord(schema.properties)) {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    const value: Record<string, unknown> = {};
    for (const [name, property] of Object.entries(properties)) {
      if (!isRecord(property)) continue;
      const hasExample =
        "default" in property || (Array.isArray(property.examples) && property.examples.length > 0);
      if (required.has(name) || hasExample) value[name] = schemaValue(property);
    }
    return value;
  }
  if (schema.type === "array") return [];
  if (schema.type === "boolean") return false;
  if (schema.type === "integer" || schema.type === "number") return 0;
  if (schema.type === "string") return "";
  return null;
}

function requiredFields(schema?: Record<string, unknown>): string[] {
  return Array.isArray(schema?.required) ? (schema.required as unknown[]).filter((f): f is string => typeof f === "string") : [];
}

function resultText(result: ServerToolCallResponse["result"]): string {
  return result.content
    .map((block) => block.text ?? JSON.stringify(block, null, 2))
    .join("\n\n")
    .trim();
}

export default function PlaygroundPage() {
  const { config, error: configError, loading: configLoading } = useConfig();
  const [searchParams, setSearchParams] = useSearchParams();
  const [server, setServer] = useState(searchParams.get("server") ?? "");
  const [toolsData, setToolsData] = useState<ServerToolsResponse | null>(null);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState("");
  const [selectedToolName, setSelectedToolName] = useState("");
  const [argumentsJson, setArgumentsJson] = useState("{}");
  const [callResult, setCallResult] = useState<ServerToolCallResponse | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const [calling, setCalling] = useState(false);
  const [copied, setCopied] = useState(false);

  const serverNames = useMemo(() => (config ? Object.keys(config.servers).sort() : []), [config]);

  useEffect(() => {
    if (!config || serverNames.length === 0 || serverNames.includes(server)) return;
    const firstEnabled = serverNames.find((name) => config.servers[name]?.enabled !== false);
    setServer(firstEnabled ?? serverNames[0]!);
  }, [config, server, serverNames]);

  useEffect(() => {
    if (!server) return;
    let cancelled = false;
    setToolsLoading(true);
    setToolsError(null);
    setCallResult(null);
    setCallError(null);
    void fetchServerTools(server)
      .then((data) => {
        if (cancelled) return;
        setToolsData(data);
        setSelectedToolName((current) =>
          data.tools.some((tool) => tool.name === current) ? current : (data.tools[0]?.name ?? ""),
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setToolsData(null);
        setToolsError(error instanceof Error ? error.message : "Failed to list tools");
      })
      .finally(() => {
        if (!cancelled) setToolsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [server, reloadKey]);

  const selectedTool = toolsData?.tools.find((tool) => tool.name === selectedToolName);

  useEffect(() => {
    setArgumentsJson(schemaTemplate(selectedTool?.inputSchema));
    setCallResult(null);
    setCallError(null);
  }, [selectedTool]);

  const filteredTools = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const tools = toolsData?.tools ?? [];
    if (!normalized) return tools;
    return tools.filter(
      (tool) =>
        tool.name.toLowerCase().includes(normalized) ||
        tool.description?.toLowerCase().includes(normalized),
    );
  }, [query, toolsData]);

  const changeServer = (name: string) => {
    setServer(name);
    setToolsData(null);
    setSearchParams({ server: name }, { replace: true });
  };

  const runTool = useCallback(async () => {
    if (!selectedTool || calling) return;
    setCallError(null);
    setCallResult(null);

    let args: unknown;
    try {
      args = JSON.parse(argumentsJson) as unknown;
    } catch (error) {
      setCallError(`Invalid JSON: ${error instanceof Error ? error.message : "could not parse arguments"}`);
      return;
    }
    if (!isRecord(args)) {
      setCallError("Arguments must be a JSON object.");
      return;
    }

    setCalling(true);
    try {
      setCallResult(await callServerTool(server, selectedTool.name, args));
    } catch (error) {
      setCallError(error instanceof Error ? error.message : "Tool call failed");
    } finally {
      setCalling(false);
    }
  }, [argumentsJson, calling, selectedTool, server]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void runTool();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [runTool]);

  const copyResult = async () => {
    if (!callResult) return;
    await navigator.clipboard.writeText(JSON.stringify(callResult, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const formatArguments = () => {
    try {
      setArgumentsJson(JSON.stringify(JSON.parse(argumentsJson) as unknown, null, 2));
      setCallError(null);
    } catch (error) {
      setCallError(`Invalid JSON: ${error instanceof Error ? error.message : "could not parse arguments"}`);
    }
  };

  return (
    <div className="min-w-0">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent-primary)]/10">
            <Wrench className="h-6 w-6 text-[var(--accent-primary)]" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-2xl font-bold text-foreground sm:text-3xl">Playground</h2>
            <p className="text-sm text-muted-foreground">
              Call tools directly on one upstream server, bypassing tokens and profiles
            </p>
          </div>
        </div>

        <div className="flex w-full items-end gap-2 sm:w-auto">
          <div className="min-w-0 flex-1 sm:w-64 sm:flex-none">
            <Label htmlFor="playground-server" className="text-xs text-muted-foreground">
              Server
            </Label>
            <Select value={server} onValueChange={changeServer} disabled={serverNames.length === 0}>
              <SelectTrigger id="playground-server" className="mt-1">
                <SelectValue placeholder={configLoading ? "Loading…" : "Choose a server"} />
              </SelectTrigger>
              <SelectContent>
                {serverNames.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                    {config?.servers[name]?.enabled === false ? " (disabled)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setReloadKey((key) => key + 1)}
            disabled={!server || toolsLoading}
            aria-label="Refresh tool list"
            title="Refresh tool list"
          >
            <RefreshCw className={cn("h-4 w-4", toolsLoading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {toolsData ? (
        <div className="mb-6 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variant={toolsData.status === "connected" ? "secondary" : "destructive"}>
            {toolsData.status}
          </Badge>
          <Badge variant="outline">{toolsData.transport}</Badge>
          <span>{toolsData.tools.length} tools</span>
          {toolsData.restarts > 0 ? <span>· {toolsData.restarts} restarts</span> : null}
        </div>
      ) : null}

      {configError || toolsError ? (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription className="break-words">{configError ?? toolsError}</AlertDescription>
        </Alert>
      ) : null}

      {serverNames.length === 0 && !configLoading ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Add a server before using the playground.
          </CardContent>
        </Card>
      ) : null}

      {toolsData ? (
        <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <Card className="min-w-0 lg:sticky lg:top-20">
            <CardHeader className="gap-3 pb-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">Tools</span>
                <span className="text-xs text-muted-foreground">
                  {filteredTools.length}/{toolsData.tools.length}
                </span>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search tools"
                  className="pl-9"
                />
              </div>
            </CardHeader>
            <CardContent className="grid max-h-[26rem] min-w-0 gap-1 overflow-y-auto lg:max-h-[calc(100vh-19rem)]">
              {filteredTools.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">No matching tools.</p>
              ) : (
                filteredTools.map((tool) => (
                  <button
                    type="button"
                    key={tool.name}
                    onClick={() => setSelectedToolName(tool.name)}
                    className={cn(
                      "min-w-0 rounded-md border border-transparent px-3 py-2 text-left transition-colors hover:bg-muted",
                      selectedToolName === tool.name &&
                        "border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/5",
                    )}
                  >
                    <span
                      className={cn(
                        "block break-words font-mono text-sm",
                        selectedToolName === tool.name
                          ? "font-semibold text-[var(--accent-primary)]"
                          : "text-foreground",
                      )}
                    >
                      {tool.name}
                    </span>
                    {tool.description ? (
                      <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">
                        {tool.description}
                      </span>
                    ) : null}
                  </button>
                ))
              )}
            </CardContent>
          </Card>

          {selectedTool ? (
            <div className="grid min-w-0 gap-6">
              <ToolPanel
                tool={selectedTool}
                argumentsJson={argumentsJson}
                onArgumentsChange={setArgumentsJson}
                onFormat={formatArguments}
                onReset={() => setArgumentsJson(schemaTemplate(selectedTool.inputSchema))}
                calling={calling}
                onRun={() => void runTool()}
              />

              {callError ? (
                <Alert variant="destructive">
                  <AlertDescription className="break-words">{callError}</AlertDescription>
                </Alert>
              ) : null}

              {callResult ? (
                <ResponsePanel result={callResult} copied={copied} onCopy={() => void copyResult()} />
              ) : null}
            </div>
          ) : (
            <Card className="min-w-0">
              <CardContent className="py-12 text-center text-muted-foreground">
                This server did not expose any tools.
              </CardContent>
            </Card>
          )}
        </div>
      ) : toolsLoading ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          Listing tools…
        </p>
      ) : null}
    </div>
  );
}

function ToolPanel({
  tool,
  argumentsJson,
  onArgumentsChange,
  onFormat,
  onReset,
  calling,
  onRun,
}: {
  tool: McpTool;
  argumentsJson: string;
  onArgumentsChange: (value: string) => void;
  onFormat: () => void;
  onReset: () => void;
  calling: boolean;
  onRun: () => void;
}) {
  const required = requiredFields(tool.inputSchema);

  return (
    <Card className="min-w-0">
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="break-words font-mono text-lg font-semibold">{tool.name}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {tool.description ?? "No description provided."}
            </p>
          </div>
          <Button onClick={onRun} disabled={calling} className="shrink-0">
            {calling ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {calling ? "Running…" : "Run"}
          </Button>
        </div>
        {required.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Required:</span>
            {required.map((field) => (
              <Badge key={field} variant="outline" className="font-mono text-xs">
                {field}
              </Badge>
            ))}
          </div>
        ) : null}
      </CardHeader>

      <CardContent className="min-w-0">
        <Tabs defaultValue="arguments">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <TabsList>
              <TabsTrigger value="arguments">
                <Braces className="mr-1.5 h-4 w-4" />
                Arguments
              </TabsTrigger>
              <TabsTrigger value="schema">Schema</TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={onFormat}>
                Format
              </Button>
              <Button variant="ghost" size="sm" onClick={onReset}>
                Reset
              </Button>
            </div>
          </div>

          <TabsContent value="arguments" className="min-w-0">
            <Textarea
              aria-label="Tool arguments as JSON"
              value={argumentsJson}
              onChange={(event) => onArgumentsChange(event.target.value)}
              rows={12}
              spellCheck={false}
              className="resize-y font-mono text-xs"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              JSON object sent as the tool arguments. Press Cmd/Ctrl + Enter to run.
            </p>
          </TabsContent>

          <TabsContent value="schema" className="min-w-0">
            <JsonBlock value={tool.inputSchema ?? {}} className="max-h-96" />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function ResponsePanel({
  result,
  copied,
  onCopy,
}: {
  result: ServerToolCallResponse;
  copied: boolean;
  onCopy: () => void;
}) {
  const failed = result.result.isError === true;
  const text = resultText(result.result);

  return (
    <Card className={cn("min-w-0", failed && "border-destructive/50")}>
      <CardHeader className="gap-3 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">Response</span>
            <Badge variant={failed ? "destructive" : "secondary"}>
              {failed ? (
                <>
                  <CircleAlert className="mr-1 h-3 w-3" />
                  tool error
                </>
              ) : (
                "success"
              )}
            </Badge>
            <span className="text-xs text-muted-foreground">{result.durationMs} ms</span>
          </div>
          <Button variant="outline" size="sm" onClick={onCopy} className="shrink-0">
            <Copy className="h-4 w-4" />
            {copied ? "Copied" : "Copy JSON"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="min-w-0">
        <Tabs defaultValue="content">
          <TabsList>
            <TabsTrigger value="content">Content</TabsTrigger>
            <TabsTrigger value="raw">Raw</TabsTrigger>
          </TabsList>

          <TabsContent value="content" className="min-w-0">
            {text ? (
              <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs">
                {text}
              </pre>
            ) : (
              <p className="py-4 text-sm text-muted-foreground">
                The tool returned no textual content.
              </p>
            )}
          </TabsContent>

          <TabsContent value="raw" className="min-w-0">
            <JsonBlock value={result} className="max-h-[32rem]" />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function JsonBlock({ value, className }: { value: unknown; className?: string }) {
  return (
    <pre
      className={cn(
        "overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs",
        className,
      )}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
