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
export default function TokensPage() {
  const { config, setConfig, error, loading } = useConfig();
  const [formError, setFormError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [profiles, setProfiles] = useState<string[]>(["default"]);
  const [description, setDescription] = useState("");
  const [disabled, setDisabled] = useState(false);

  const openCreate = () => {
    setEditing(null);
    setName("");
    setProfiles([config?.defaultProfile ?? "default"]);
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
    setProfiles(token.profiles ?? (token.profile ? [token.profile] : []));
    setDescription(token.description ?? "");
    setDisabled(Boolean(token.disabled));
    setFormError(null);
    setOpen(true);
  };

  const save = async () => {
    const tokenName = name.trim();
    if (!tokenName) {
      setFormError("Token name is required.");
      return;
    }
    if (profiles.length === 0) {
      setFormError("Select at least one profile.");
      return;
    }
    try {
      const result = await putToken(tokenName, {
        profiles,
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
    if (!window.confirm(`Delete Token "${tokenName}"?`)) return;
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
              Route IDE clients through one or more profiles. Managed Secrets are configured separately.
            </p>
          </div>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Add Token
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
                  <CardDescription>
                    {token.description || `Profiles: ${(token.profiles ?? (token.profile ? [token.profile] : [])).join(", ")}`}
                  </CardDescription>
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
              <CardContent className="flex items-center justify-between gap-3">
                <div className="flex flex-wrap gap-1">
                  {(token.profiles ?? (token.profile ? [token.profile] : [])).map((profile) => (
                    <Badge key={profile} variant="secondary">{profile}</Badge>
                  ))}
                </div>
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
            <DialogTitle>{editing ? `Edit ${editing}` : "Add Token"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1">
              <Label htmlFor="token-name">Token name</Label>
              <Input
                id="token-name"
                value={name}
                disabled={Boolean(editing)}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label>Profiles (maximum privileges are combined)</Label>
              <div className="grid gap-2 rounded-md border p-3">
                {config
                  ? Object.keys(config.profiles).map((profile) => (
                      <div key={profile} className="flex items-center justify-between gap-3">
                        <span className="text-sm">{profile}</span>
                        <Switch
                          checked={profiles.includes(profile)}
                          onCheckedChange={(checked) =>
                            setProfiles((current) =>
                              checked
                                ? [...new Set([...current, profile])]
                                : current.filter((name) => name !== profile),
                            )
                          }
                        />
                      </div>
                    ))
                  : null}
              </div>
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
