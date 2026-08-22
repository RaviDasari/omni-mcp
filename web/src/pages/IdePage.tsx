import { useEffect, useState } from "react";
import { Copy, Terminal } from "lucide-react";
import { fetchConfig, fetchIdeSnippets } from "@/lib/api";
import type { IdeSnippetsResult } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

export default function IdePage() {
  const [tokenNames, setTokenNames] = useState<string[]>(["default"]);
  const [token, setToken] = useState("default");
  const [data, setData] = useState<IdeSnippetsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    void fetchConfig()
      .then((r) => {
        const names = Object.keys(r.config.tokens);
        setTokenNames(names);
        setToken((current) => (names.includes(current) ? current : (names[0] ?? "default")));
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load tokens"));
  }, []);

  useEffect(() => {
    void fetchIdeSnippets(token)
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load snippets"));
  }, [token]);

  const copy = async (id: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    window.setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div>
      <div className="mb-8 flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-[var(--accent-primary)]/10 flex items-center justify-center">
          <Terminal className="h-7 w-7 text-[var(--accent-primary)]" />
        </div>
        <div>
          <h2 className="text-3xl font-bold text-foreground">IDE snippets</h2>
          <p className="text-muted-foreground">Copy-paste configs for Cursor, VS Code, Claude Desktop, and Windsurf</p>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="mb-6 max-w-xs grid gap-1">
        <Label>Token</Label>
        <Select value={token} onValueChange={setToken}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {tokenNames.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {data ? (
        <div className="grid gap-4">
          {data.snippets.map((snippet) => (
            <Card key={snippet.id}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle>{snippet.title}</CardTitle>
                  <CardDescription>{snippet.pathHint}</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => void copy(snippet.id, snippet.json)}>
                  <Copy className="h-4 w-4" />
                  {copied === snippet.id ? "Copied" : "Copy"}
                </Button>
              </CardHeader>
              <CardContent>
                <pre className="text-xs overflow-auto rounded-md bg-muted p-3">{snippet.json}</pre>
              </CardContent>
            </Card>
          ))}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>curl</CardTitle>
                <CardDescription>{data.url}</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => void copy("curl", data.curl)}>
                <Copy className="h-4 w-4" />
                {copied === "curl" ? "Copied" : "Copy"}
              </Button>
            </CardHeader>
            <CardContent>
              <pre className="text-xs overflow-auto rounded-md bg-muted p-3">{data.curl}</pre>
            </CardContent>
          </Card>
        </div>
      ) : (
        <p className="text-muted-foreground">Loading…</p>
      )}
    </div>
  );
}
