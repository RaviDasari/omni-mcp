import { useEffect, useState } from "react";
import {
  EllipsisVertical,
  KeyRound,
  LockKeyhole,
  Pencil,
  Plus,
  RefreshCw,
  TextCursorInput,
  Trash2,
} from "lucide-react";
import {
  applyInlineSecretMigration,
  convertVariable,
  deleteVariable,
  fetchInlineSecretMigration,
  fetchVariables,
  importKeychainSecret,
  migrateSecretBackend,
  previewSecretBackendMigration,
  putVariable,
  syncVariables,
} from "@/lib/api";
import type { VariableMetadata, VariablesResponse } from "@/lib/types";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type VariableType = "secret" | "plain";
type DialogMode = "variable" | "keychain" | null;

export default function VariablesPage() {
  const [data, setData] = useState<VariablesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<DialogMode>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<VariableType>("secret");
  const [value, setValue] = useState("");
  const [service, setService] = useState("");
  const [account, setAccount] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [pendingConvert, setPendingConvert] = useState<VariableMetadata | null>(null);

  const load = async () => {
    try {
      setData(await fetchVariables());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Variables");
    }
  };

  useEffect(() => { void load(); }, []);

  const perform = async (action: () => Promise<VariablesResponse>) => {
    setBusy(true);
    try {
      setData(await action());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Variable operation failed");
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const resetFields = () => {
    setEditing(false);
    setName("");
    setType("secret");
    setValue("");
    setService("");
    setAccount("");
  };

  const openVariable = (variable?: VariableMetadata) => {
    resetFields();
    if (variable) {
      setEditing(true);
      setName(variable.name);
      setType(variable.type);
      setValue(variable.type === "plain" ? variable.value ?? "" : "");
    }
    setMode("variable");
  };

  const closeDialog = () => {
    resetFields();
    setMode(null);
  };

  const save = async () => {
    const variableName = name.trim();
    if (!isValidSecretName(variableName) || !value) {
      setError("Use a valid Variable name and a non-empty value.");
      return;
    }
    try {
      await perform(() => putVariable(variableName, value, type));
      closeDialog();
    } catch {
      // The inline alert already contains the actionable error.
    }
  };

  const importItem = async () => {
    if (!name.trim() || !service.trim() || !account.trim()) {
      setError("Variable name, service, and account are required.");
      return;
    }
    try {
      await perform(() => importKeychainSecret(name.trim(), service.trim(), account.trim()));
      closeDialog();
    } catch {
      // The inline alert already contains the actionable error.
    }
  };

  const migrateInline = async () => {
    try {
      const preview = await fetchInlineSecretMigration();
      if (preview.candidates.length === 0) {
        setError("No inline server values were found.");
        return;
      }
      const renames: Record<string, string> = {};
      for (const conflict of preview.conflicts) {
        const replacement = window.prompt(`Variable ${conflict} conflicts. Enter a replacement name:`);
        if (!replacement) return;
        renames[conflict] = replacement;
      }
      if (!window.confirm(`Move ${preview.candidates.length} inline value(s) to secret Variables?`)) return;
      await perform(() => applyInlineSecretMigration(renames));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Migration failed");
    }
  };

  const migrateBackend = async () => {
    if (!data) return;
    const backend = data.secretBackend === "file" ? "keychain" : "file";
    try {
      const preview = await previewSecretBackendMigration(backend);
      if (!window.confirm(`Move ${preview.count} secret Variable(s) from ${preview.from} to ${preview.to}?`)) return;
      await perform(() => migrateSecretBackend(backend));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Secret backend migration failed");
    }
  };

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent-primary)]/10">
            <TextCursorInput className="h-7 w-7 text-[var(--accent-primary)]" />
          </div>
          <div>
            <h2 className="text-3xl font-bold">Variables</h2>
            <p className="text-muted-foreground">
              Secret or plain values for exact <code>$NAME</code> and <code>{"${NAME}"}</code> references.
            </p>
          </div>
        </div>
        <Button onClick={() => openVariable()}>
          <Plus className="h-4 w-4" /> Add Variable
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
                Secret backend <Badge variant="secondary">{data.secretBackend}</Badge>
              </CardTitle>
              <CardDescription>
                Environment values take precedence. Plain values are readable; saved secret values never are.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={busy} onClick={() => void perform(() => syncVariables())}>
                <RefreshCw className="h-4 w-4" /> Sync
              </Button>
              <Button
                variant="outline"
                disabled={busy || (!data.keychainSupported && data.secretBackend === "file")}
                onClick={() => void migrateBackend()}
              >
                Move secrets to {data.secretBackend === "file" ? "macOS Keychain" : "secrets.json"}
              </Button>
              {data.keychainSupported ? (
                <Button variant="outline" onClick={() => { resetFields(); setMode("keychain"); }}>
                  Import Keychain secret
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => void migrateInline()}>Migrate inline config</Button>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Variable</TableHead>
                  <TableHead className="w-24">Type</TableHead>
                  <TableHead className="w-24">Status</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Used by</TableHead>
                  <TableHead className="w-14"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.variables.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      No Variables configured.
                    </TableCell>
                  </TableRow>
                ) : data.variables.map((variable) => (
                  <TableRow key={variable.name}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        {variable.type === "secret"
                          ? <LockKeyhole className="h-4 w-4 text-muted-foreground" />
                          : <TextCursorInput className="h-4 w-4 text-muted-foreground" />}
                        {variable.name}
                      </span>
                    </TableCell>
                    <TableCell><Badge variant="outline">{variable.type}</Badge></TableCell>
                    <TableCell>
                      <Badge variant={variable.set ? "secondary" : "destructive"}>
                        {variable.set ? "set" : "unset"}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-xs truncate font-mono text-sm">
                      {variable.type === "plain" ? variable.value : "••••••••"}
                    </TableCell>
                    <TableCell className="max-w-sm text-muted-foreground">
                      {variable.usages.length
                        ? variable.usages.map((usage) => usage.path).join(", ")
                        : "Not referenced"}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`Open actions for ${variable.name}`}>
                            <EllipsisVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => openVariable(variable)}>
                            <Pencil className="h-4 w-4" /> Edit value
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setPendingConvert(variable)}>
                            <KeyRound className="h-4 w-4" /> Convert to {variable.type === "secret" ? "plain" : "secret"}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={variable.usages.length > 0}
                            className="text-destructive focus:text-destructive"
                            onSelect={() => setPendingDelete(variable.name)}
                          >
                            <Trash2 className="h-4 w-4" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}

      <Dialog open={mode !== null} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {mode === "keychain" ? "Import from macOS Keychain" : editing ? `Edit ${name}` : "Add Variable"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1">
              <Label htmlFor="variable-name">Variable name</Label>
              <Input
                id="variable-name"
                disabled={editing}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
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
              <>
                <div className="grid gap-1">
                  <Label htmlFor="variable-type">Type</Label>
                  <select
                    id="variable-type"
                    disabled={editing}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                    value={type}
                    onChange={(event) => setType(event.target.value as VariableType)}
                  >
                    <option value="secret">Secret (default)</option>
                    <option value="plain">Plain text</option>
                  </select>
                  {editing ? (
                    <p className="text-xs text-muted-foreground">Use Convert to change an existing Variable's type.</p>
                  ) : null}
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="variable-value">{editing ? "New value" : "Value"}</Label>
                  {type === "secret" ? (
                    <>
                      <SecretInput
                        id="variable-value"
                        name="omni-mcp-variable-value"
                        revealLabel="value while typing"
                        value={value}
                        onValueChange={setValue}
                      />
                      <p className="text-xs text-muted-foreground">
                        You may reveal only the value being typed. Saved secret values are never returned.
                      </p>
                    </>
                  ) : (
                    <Input
                      id="variable-value"
                      value={value}
                      onChange={(event) => setValue(event.target.value)}
                    />
                  )}
                </div>
              </>
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
            <AlertDialogDescription>This removes the Variable value and cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (!pendingDelete) return;
              void perform(() => deleteVariable(pendingDelete));
              setPendingDelete(null);
            }}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pendingConvert !== null} onOpenChange={(open) => { if (!open) setPendingConvert(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Convert {pendingConvert?.name} to {pendingConvert?.type === "secret" ? "plain" : "secret"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The value will move between variables.json and the active secret backend. The old copy is removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (!pendingConvert) return;
              const destination = pendingConvert.type === "secret" ? "plain" : "secret";
              void perform(() => convertVariable(pendingConvert.name, destination));
              setPendingConvert(null);
            }}>
              Convert
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
