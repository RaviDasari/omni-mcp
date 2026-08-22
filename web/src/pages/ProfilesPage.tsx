import { useState } from "react";
import { Plus, Shield, Trash2 } from "lucide-react";
import { useConfig } from "@/hooks/useConfig";
import { deleteProfile, putProfile } from "@/lib/api";
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

export default function ProfilesPage() {
  const { config, setConfig, error, loading } = useConfig();
  const [formError, setFormError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [wildcard, setWildcard] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const openCreate = () => {
    setEditing(null);
    setName("");
    setWildcard(false);
    setSelected([]);
    setFormError(null);
    setOpen(true);
  };

  const openEdit = (profileName: string, allow: string[]) => {
    setEditing(profileName);
    setName(profileName);
    setWildcard(allow.includes("*"));
    setSelected(allow.filter((s) => s !== "*"));
    setFormError(null);
    setOpen(true);
  };

  const save = async () => {
    const profileName = name.trim();
    if (!profileName) {
      setFormError("Name is required");
      return;
    }
    const allow = wildcard ? ["*"] : selected;
    if (allow.length === 0) {
      setFormError("Select at least one server or enable *");
      return;
    }
    try {
      const result = await putProfile(profileName, { allow });
      setConfig(result.config);
      setOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Save failed");
    }
  };

  const remove = async (profileName: string) => {
    if (!window.confirm(`Delete profile "${profileName}"?`)) return;
    try {
      const result = await deleteProfile(profileName);
      setConfig(result.config);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const toggleServer = (serverName: string, on: boolean) => {
    setSelected((prev) =>
      on ? [...prev, serverName] : prev.filter((s) => s !== serverName),
    );
  };

  return (
    <div>
      <div className="mb-8 flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-[var(--accent-primary)]/10 flex items-center justify-center">
            <Shield className="h-7 w-7 text-[var(--accent-primary)]" />
          </div>
          <div>
            <h2 className="text-3xl font-bold text-foreground">Profiles</h2>
            <p className="text-muted-foreground">Allow-lists that tokens bind to. Keep a default profile.</p>
          </div>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Add profile
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
          {Object.entries(config.profiles).map(([profileName, profile]) => (
            <Card key={profileName}>
              <CardHeader className="flex flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle>{profileName}</CardTitle>
                  <CardDescription>Servers this profile can use</CardDescription>
                </div>
                {profileName !== "default" ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => void remove(profileName)}
                    aria-label={`Delete ${profileName}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2 items-center justify-between">
                <div className="flex flex-wrap gap-1">
                  {profile.allow.map((s) => (
                    <Badge key={s} variant="secondary">
                      {s}
                    </Badge>
                  ))}
                </div>
                <Button variant="outline" size="sm" onClick={() => openEdit(profileName, profile.allow)}>
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
            <DialogTitle>{editing ? `Edit ${editing}` : "Add profile"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1">
              <Label htmlFor="profile-name">Name</Label>
              <Input
                id="profile-name"
                value={name}
                disabled={Boolean(editing)}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="wildcard">Allow all servers (*)</Label>
              <Switch id="wildcard" checked={wildcard} onCheckedChange={setWildcard} />
            </div>
            {!wildcard && config ? (
              <div className="grid gap-2">
                <Label>Servers</Label>
                {Object.keys(config.servers).map((serverName) => (
                  <label key={serverName} className="flex items-center justify-between text-sm">
                    {serverName}
                    <Switch
                      checked={selected.includes(serverName)}
                      onCheckedChange={(on) => toggleServer(serverName, on)}
                    />
                  </label>
                ))}
              </div>
            ) : null}
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
