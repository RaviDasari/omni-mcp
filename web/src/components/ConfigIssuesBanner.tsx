import { Link } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { HealthPayload } from "@/lib/types";

/** Lists servers that were not started and other startup problems. */
export function ConfigIssuesBanner({ health }: { health: HealthPayload | null }) {
  if (!health) return null;
  const blocked = Object.entries(health.servers).filter(([, server]) => (server.issues?.length ?? 0) > 0);
  const global = health.issues ?? [];
  if (blocked.length === 0 && global.length === 0) return null;

  return (
    <Alert variant="destructive" className="mb-6">
      <AlertTitle>
        {blocked.length > 0
          ? `${blocked.length} server${blocked.length === 1 ? "" : "s"} not started`
          : "Configuration problem"}
      </AlertTitle>
      <AlertDescription className="space-y-2">
        <ul className="list-disc space-y-1 pl-5">
          {global.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
          {blocked.map(([name, server]) => (
            <li key={name}>
              <span className="font-medium">{name}</span>
              <ul className="list-[circle] pl-5">
                {server.issues!.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <p>
          Set the missing values on the{" "}
          <Link to="/variables" className="font-medium underline">Variables</Link> page, or edit the server on the{" "}
          <Link to="/servers" className="font-medium underline">Servers</Link> page. Blocked servers start
          automatically once fixed.
        </p>
      </AlertDescription>
    </Alert>
  );
}
