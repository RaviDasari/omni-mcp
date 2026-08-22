import { useState } from "react";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { useConfig } from "@/hooks/useConfig";
import { deleteToken, putToken } from "@/lib/api";
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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function TokensPage() {
  const { config, setConfig, error, loading } = useConfig();
  const [formError, setFormError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [profile, setProfile] = useState("default");
  const [description, setDescription] = useState("");
  const [disabled, setDisabled] = useState(false);

  const openCreate = () => {
    setEditing(null);
    setName("");
    setProfile(config?.defaultProfile ?? "default");
    setDescription("");
    setDisabled(false);
    setFormError(null);
    setOpen(true);
  };

  const openEdit = (tokenName: string) => {
    const token = config?.tokens[tokenName];
    if (!token) return;
    setEditing(tokenName);
    setName(tokenName);
    setProfile(token.profile);
    setDescription(token.description ?? "");
    setDisabled(Boolean(token.disabled));
    setFormError(null);
    setOpen(true);
  };

  const save = async () => {
    const tokenName = name.trim();
    if (!tokenName) {
      setFormError("Token name is required (this is the secret clients send).");
      return;
    }
    try {
      const result = await putToken(tokenName, {
        profile,
        description: description.trim() || undefined,
        disabled,
      });
      setConfig(result.config);
      setOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Save failed");
    }
  };

  const remove = async (tokenName: string) => {
    if (!window.confirm(`Delete token "${tokenName}"?`)) return;
    try {
      const result = await deleteToken(tokenName);
      setConfig(result.config);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <div>
      <div className="mb-8 flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-[var(--accent-primary)]/10 flex items-center justify-center">
            <KeyRound className="h-7 w-7 text-[var(--accent-primary)]" />
          </div>
          <div>
            <h2 className="text-3xl font-bold text-foreground">Tokens</h2>
            <p className="text-muted-foreground">
              Token names are the secrets IDEs send. They are listed here as names only.
            </p>
          </div>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Add token
        </Button>
      </div>

      {error || formError ? (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{error ?? formError}</AlertDescription>
        </Alert>
      ) : null}

      {loading || !config ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {Object.entries(config.tokens).map(([tokenName, token]) => (
            <Card key={tokenName}>
              <CardHeader className="flex flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    {tokenName}
                    {token.disabled ? <Badge variant="destructive">disabled</Badge> : null}
                  </CardTitle>
                  <CardDescription>{token.description || `Profile: ${token.profile}`}</CardDescription>
                </div>
                {tokenName !== "default" ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => void remove(tokenName)}
                    aria-label={`Delete ${tokenName}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </CardHeader>
              <CardContent className="flex items-center justify-between">
                <Badge variant="secondary">{token.profile}</Badge>
                <Button variant="outline" size="sm" onClick={() => openEdit(tokenName)}>
                  Edit
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing}` : "Add token"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1">
              <Label htmlFor="token-name">Token name (secret)</Label>
              <Input
                id="token-name"
                value={name}
                disabled={Boolean(editing)}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label>Profile</Label>
              <Select value={profile} onValueChange={setProfile}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {config
                    ? Object.keys(config.profiles).map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))
                    : null}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="desc">Description</Label>
              <Input id="desc" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="disabled">Disabled</Label>
              <Switch id="disabled" checked={disabled} onCheckedChange={setDisabled} />
            </div>
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
