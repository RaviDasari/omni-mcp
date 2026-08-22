import { useCallback, useEffect, useMemo, useState } from "react";
import { ListFilter, RefreshCw, Trash2 } from "lucide-react";
import {
  clearTrafficLogs,
  fetchTrafficLogs,
  fetchTrafficSummary,
  type TrafficLogFilters,
} from "@/lib/api";
import type {
  TrafficLogGroupBy,
  TrafficLogListResponse,
  TrafficLogSummaryResponse,
} from "@/lib/types";
import { useConfig } from "@/hooks/useConfig";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const ALL = "__all__";
const PAGE_SIZE = 100;

function localDateTime(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

function FilterSelect({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: string;
  values: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All {label.toLowerCase()}s</SelectItem>
          {values.map((item) => (
            <SelectItem key={item} value={item}>
              {item}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export default function LogsPage() {
  const { config, error: configError } = useConfig();
  const [mode, setMode] = useState<"list" | "grouped">("list");
  const [token, setToken] = useState(ALL);
  const [profile, setProfile] = useState(ALL);
  const [server, setServer] = useState(ALL);
  const [groupBy, setGroupBy] = useState<TrafficLogGroupBy>("tool");
  const [from, setFrom] = useState(() => localDateTime(new Date(Date.now() - 24 * 60 * 60 * 1000)));
  const [to, setTo] = useState(() => localDateTime(new Date()));
  const [offset, setOffset] = useState(0);
  const [list, setList] = useState<TrafficLogListResponse | null>(null);
  const [summary, setSummary] = useState<TrafficLogSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabled = config?.trafficLog?.enabled === false;

  const rangeError = useMemo(() => {
    const fromTime = new Date(from).getTime();
    const toTime = new Date(to).getTime();
    if (!Number.isFinite(fromTime) || !Number.isFinite(toTime)) return "Enter a valid date range.";
    return fromTime > toTime ? "From must not be after To." : null;
  }, [from, to]);

  const filters = useMemo<TrafficLogFilters | null>(() => {
    if (rangeError) return null;
    return {
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      ...(token === ALL ? {} : { token }),
      ...(profile === ALL ? {} : { profile }),
      ...(server === ALL ? {} : { server }),
    };
  }, [from, profile, rangeError, server, to, token]);

  const load = useCallback(async () => {
    if (!filters || disabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (mode === "list") {
        setList(await fetchTrafficLogs(filters, offset, PAGE_SIZE));
      } else {
        setSummary(await fetchTrafficSummary(filters, groupBy));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load traffic logs");
    } finally {
      setLoading(false);
    }
  }, [disabled, filters, groupBy, mode, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  const resetOffset = (setter: (value: string) => void) => (value: string) => {
    setOffset(0);
    setter(value);
  };

  const tokenNames = Object.keys(config?.tokens ?? {}).sort();
  const profileNames = Object.keys(config?.profiles ?? {}).sort();
  const serverNames = Object.keys(config?.servers ?? {}).sort();

  return (
    <div>
      <div className="mb-8 flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent-primary)]/10">
            <ListFilter className="h-7 w-7 text-[var(--accent-primary)]" />
          </div>
          <div>
            <h2 className="text-3xl font-bold text-foreground">Traffic logs</h2>
            <p className="text-muted-foreground">MCP tool-call metadata without arguments or results</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void load()} disabled={loading || disabled || !!rangeError}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Reload
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={clearing || disabled}>
                <Trash2 className="h-4 w-4" />
                Clear logs
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear all traffic logs?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently deletes all stored tool-call metadata.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    void (async () => {
                      setClearing(true);
                      try {
                        await clearTrafficLogs();
                        setList({ events: [], total: 0, dropped: 0 });
                        setSummary((current) =>
                          current ? { ...current, groups: [], totalEvents: 0 } : current,
                        );
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Failed to clear traffic logs");
                      } finally {
                        setClearing(false);
                      }
                    })();
                  }}
                >
                  Clear logs
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {configError || error ? (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{configError ?? error}</AlertDescription>
        </Alert>
      ) : null}
      {disabled ? (
        <Alert className="mb-6">
          <AlertDescription>
            Traffic logging is off. Set <code>trafficLog.enabled</code> to <code>true</code> in config.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Records are retained for {config?.trafficLog?.retentionDays ?? 7} days.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-5">
            <FilterSelect label="Token" value={token} values={tokenNames} onChange={resetOffset(setToken)} />
            <FilterSelect label="Profile" value={profile} values={profileNames} onChange={resetOffset(setProfile)} />
            <FilterSelect label="Server" value={server} values={serverNames} onChange={resetOffset(setServer)} />
            <div className="space-y-2">
              <Label htmlFor="logs-from">From</Label>
              <Input id="logs-from" type="datetime-local" value={from} onChange={(event) => {
                setOffset(0);
                setFrom(event.target.value);
              }} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="logs-to">To</Label>
              <Input id="logs-to" type="datetime-local" value={to} onChange={(event) => {
                setOffset(0);
                setTo(event.target.value);
              }} />
            </div>
          </div>
          {rangeError ? <p className="mt-2 text-sm text-destructive">{rangeError}</p> : null}
        </CardContent>
      </Card>

      <Tabs
        className="mt-6"
        value={mode}
        onValueChange={(value) => {
          setMode(value as "list" | "grouped");
          setOffset(0);
        }}
      >
        <div className="flex items-center justify-between gap-4">
          <TabsList>
            <TabsTrigger value="list">List</TabsTrigger>
            <TabsTrigger value="grouped">Grouped</TabsTrigger>
          </TabsList>
          {mode === "grouped" ? (
            <Select value={groupBy} onValueChange={(value) => setGroupBy(value as TrafficLogGroupBy)}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tool">Group by tool</SelectItem>
                <SelectItem value="server">Group by server</SelectItem>
                <SelectItem value="token">Group by token</SelectItem>
                <SelectItem value="profile">Group by profile</SelectItem>
              </SelectContent>
            </Select>
          ) : null}
        </div>
      </Tabs>

      <Card className="mt-4">
        <CardContent className="pt-6">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-10 w-full" />)}
            </div>
          ) : mode === "list" ? (
            <LogList data={list} offset={offset} onOffsetChange={setOffset} />
          ) : (
            <GroupedLogs data={summary} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LogList({
  data,
  offset,
  onOffsetChange,
}: {
  data: TrafficLogListResponse | null;
  offset: number;
  onOffsetChange: (offset: number) => void;
}) {
  if (!data || data.events.length === 0) {
    return <p className="py-8 text-center text-muted-foreground">No tool calls in this range.</p>;
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Token</TableHead>
            <TableHead>Profile</TableHead>
            <TableHead>Server</TableHead>
            <TableHead>Tool</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Outcome</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.events.map((event, index) => (
            <TableRow key={`${event.ts}-${event.namespacedTool}-${index}`}>
              <TableCell className="whitespace-nowrap">{formatTimestamp(event.ts)}</TableCell>
              <TableCell>{event.token || "—"}</TableCell>
              <TableCell>{event.profile}</TableCell>
              <TableCell>{event.server || "—"}</TableCell>
              <TableCell className="font-mono text-xs">{event.tool || "—"}</TableCell>
              <TableCell>{event.durationMs} ms</TableCell>
              <TableCell>
                <Badge variant={event.outcome === "ok" ? "default" : "destructive"}>
                  {event.outcome}{event.errorCode === undefined ? "" : ` (${event.errorCode})`}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="mt-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {offset + 1}–{Math.min(offset + data.events.length, data.total)} of {data.total}
          {data.dropped > 0 ? ` · ${data.dropped} dropped by size cap` : ""}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => onOffsetChange(Math.max(0, offset - PAGE_SIZE))}>
            Previous
          </Button>
          <Button variant="outline" size="sm" disabled={offset + PAGE_SIZE >= data.total} onClick={() => onOffsetChange(offset + PAGE_SIZE)}>
            Next
          </Button>
        </div>
      </div>
    </>
  );
}

function GroupedLogs({ data }: { data: TrafficLogSummaryResponse | null }) {
  if (!data || data.groups.length === 0) {
    return <p className="py-8 text-center text-muted-foreground">No tool calls in this range.</p>;
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{data.groupBy[0].toUpperCase() + data.groupBy.slice(1)}</TableHead>
            <TableHead className="text-right">Calls</TableHead>
            <TableHead className="text-right">OK</TableHead>
            <TableHead className="text-right">Errors</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.groups.map((group) => (
            <TableRow key={group.key}>
              <TableCell className="font-mono text-xs">{group.key || "—"}</TableCell>
              <TableCell className="text-right font-medium">{group.count}</TableCell>
              <TableCell className="text-right">{group.ok}</TableCell>
              <TableCell className="text-right">{group.error}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="mt-4 text-sm text-muted-foreground">
        {data.totalEvents} calls{data.truncated ? " · showing the top 500 groups" : ""}
      </p>
    </>
  );
}
