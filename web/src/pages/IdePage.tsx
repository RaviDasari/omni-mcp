import { useEffect, useState } from "react";
import { Terminal } from "lucide-react";
import { fetchConfig, fetchIdeSnippets } from "@/lib/api";
import type { IdeSnippetsResult } from "@/lib/types";
import { IdeIcon } from "@/components/ide-icon";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CodeBlock } from "@/components/ui/code-block";
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

  return (
    <div>
      <div className="mb-8 flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-[var(--accent-primary)]/10 flex items-center justify-center">
          <Terminal className="h-7 w-7 text-[var(--accent-primary)]" />
        </div>
        <div>
          <h2 className="text-3xl font-bold text-foreground">IDE snippets</h2>
          <p className="text-muted-foreground">
            Copy-paste configs for Cursor, VS Code, Claude Code, Claude Desktop, and Windsurf
          </p>
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
              <CardHeader className="flex flex-row items-start gap-3 space-y-0">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-muted">
                  <IdeIcon id={snippet.id} />
                </div>
                <div className="min-w-0">
                  <CardTitle>{snippet.title}</CardTitle>
                  <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                    {snippet.pathHint}
                  </p>
                  {snippet.altPaths?.map((alt) => (
                    <p key={alt} className="break-all font-mono text-xs text-muted-foreground/70">
                      {alt}
                    </p>
                  ))}
                </div>
              </CardHeader>
              <CardContent>
                <CodeBlock code={snippet.json} language="json" />
              </CardContent>
            </Card>
          ))}
          <Card>
            <CardHeader className="flex flex-row items-start gap-3 space-y-0">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-muted">
                <Terminal className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <CardTitle>curl</CardTitle>
                <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{data.url}</p>
              </div>
            </CardHeader>
            <CardContent>
              <CodeBlock code={data.curl} language="bash" />
            </CardContent>
          </Card>
        </div>
      ) : (
        <p className="text-muted-foreground">Loading…</p>
      )}
    </div>
  );
}
