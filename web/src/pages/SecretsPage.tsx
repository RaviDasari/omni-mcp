import { useEffect, useState } from "react";
import { KeyRound, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import {
  applyInlineSecretMigration,
  deleteSecret,
  fetchInlineSecretMigration,
  fetchSecrets,
  importKeychainSecret,
  migrateSecretBackend,
  previewSecretBackendMigration,
  putSecret,
  syncSecrets,
} from "@/lib/api";
import type { SecretsResponse } from "@/lib/types";
import { isValidSecretName } from "@/lib/secrets";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SecretInput } from "@/components/ui/secret-input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type DialogMode = "secret" | "keychain" | null;

export default function SecretsPage() {
  const [data, setData] = useState<SecretsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<DialogMode>(null);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [service, setService] = useState("");
  const [account, setAccount] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const load = async () => {
    try {
      setData(await fetchSecrets());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load secrets");
    }
  };

  useEffect(() => { void load(); }, []);

  const perform = async (action: () => Promise<SecretsResponse>) => {
    setBusy(true);
    try {
      setData(await action());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Secret operation failed");
    } finally {
      setBusy(false);
    }
  };

  // Every dialog field is cleared on both open and close so no value from a
  // previous secret can leak into the next one.
  const resetFields = () => {
    setName("");
    setValue("");
    setService("");
    setAccount("");
  };

  const openSecret = (secretName = "") => {
    resetFields();
    setName(secretName);
    setMode("secret");
  };

  const openKeychain = () => {
    resetFields();
    setMode("keychain");
  };

  const closeDialog = () => {
    resetFields();
    setMode(null);
  };

  const save = async () => {
    const variable = name.trim();
    if (!isValidSecretName(variable) || !value) {
      setError("Use a valid variable name and a non-empty value.");
      return;
    }
    await perform(() => putSecret(variable, value));
    closeDialog();
  };

  const importItem = async () => {
    if (!name.trim() || !service.trim() || !account.trim()) {
      setError("Variable name, service, and account are required.");
      return;
    }
    await perform(() => importKeychainSecret(name.trim(), service.trim(), account.trim()));
    closeDialog();
  };

  const migrateInline = async () => {
    try {
      const preview = await fetchInlineSecretMigration();
      if (preview.candidates.length === 0) {
        setError("No inline server secrets were found.");
        return;
      }
      const renames: Record<string, string> = {};
      for (const conflict of preview.conflicts) {
        const replacement = window.prompt(`Variable ${conflict} conflicts. Enter a replacement name:`);
        if (!replacement) return;
        renames[conflict] = replacement;
      }
      if (!window.confirm(`Move ${preview.candidates.length} inline secret(s) to the active store?`)) return;
      await perform(() => applyInlineSecretMigration(renames));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Migration failed");
    }
  };

  const migrateBackend = async () => {
    if (!data) return;
    const backend = data.backend === "file" ? "keychain" : "file";
    try {
      const preview = await previewSecretBackendMigration(backend);
      if (!window.confirm(`Move ${preview.count} secret(s) from ${preview.from} to ${preview.to}?`)) return;
      await perform(() => migrateSecretBackend(backend));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Backend migration failed");
    }
  };

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent-primary)]/10">
            <ShieldCheck className="h-7 w-7 text-[var(--accent-primary)]" />
          </div>
          <div>
            <h2 className="text-3xl font-bold">Secrets</h2>
            <p className="text-muted-foreground">
              Write-only variables for exact <code>$NAME</code> and <code>{"${NAME}"}</code> references.
            </p>
          </div>
        </div>
        <Button onClick={() => openSecret()}>
          <Plus className="h-4 w-4" /> Add variable
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {!data ? <p className="text-muted-foreground">Loading…</p> : (
        <>
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Active backend <Badge variant="secondary">{data.backend}</Badge>
              </CardTitle>
              <CardDescription>
                Process environment variables take precedence. Stored values are never returned by the API.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={busy} onClick={() => void perform(() => syncSecrets())}>
                <RefreshCw className="h-4 w-4" /> Sync
              </Button>
              <Button
                variant="outline"
                disabled={busy || (!data.keychainSupported && data.backend === "file")}
                onClick={() => void migrateBackend()}
              >
                Move to {data.backend === "file" ? "macOS Keychain" : "secrets.json"}
              </Button>
              {data.keychainSupported ? (
                <Button variant="outline" onClick={openKeychain}>Import Keychain item</Button>
              ) : null}
              <Button variant="outline" onClick={() => void migrateInline()}>Migrate inline config</Button>
            </CardContent>
          </Card>

          {data.secrets.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">No variables configured.</CardContent></Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {data.secrets.map((secret) => (
                <Card key={secret.name}>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2"><KeyRound className="h-4 w-4" />{secret.name}</span>
                      <Badge variant={secret.set ? "secondary" : "destructive"}>{secret.set ? "set" : "unset"}</Badge>
                    </CardTitle>
                    <CardDescription>
                      {secret.usages.length
                        ? secret.usages.map((usage) => usage.path).join(", ")
                        : "Not referenced by the current config"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => openSecret(secret.name)}>Replace</Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={secret.usages.length > 0}
                      aria-label={`Delete ${secret.name}`}
                      onClick={() => setPendingDelete(secret.name)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      <Dialog open={mode !== null} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{mode === "keychain" ? "Import from macOS Keychain" : name ? `Replace ${name}` : "Add variable"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1">
              <Label htmlFor="secret-name">Variable name</Label>
              <Input id="secret-name" value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            {mode === "keychain" ? (
              <>
                <div className="grid gap-1">
                  <Label htmlFor="keychain-service">Keychain service</Label>
                  <Input id="keychain-service" value={service} onChange={(event) => setService(event.target.value)} />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="keychain-account">Keychain account</Label>
                  <Input id="keychain-account" value={account} onChange={(event) => setAccount(event.target.value)} />
                </div>
              </>
            ) : (
              <div className="grid gap-1">
                <Label htmlFor="secret-value">New value</Label>
                <SecretInput
                  id="secret-value"
                  name="omni-mcp-secret-value"
                  revealLabel="value"
                  value={value}
                  onValueChange={setValue}
                />
                <p className="text-xs text-muted-foreground">
                  Paste the new value. Stored values are never read back, so this always starts empty.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button disabled={busy} onClick={() => void (mode === "keychain" ? importItem() : save())}>
              {mode === "keychain" ? "Import" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {pendingDelete}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the value from the active secret backend. It cannot be revealed or recovered by omni-mcp.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pendingDelete) return;
                void perform(() => deleteSecret(pendingDelete));
                setPendingDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

