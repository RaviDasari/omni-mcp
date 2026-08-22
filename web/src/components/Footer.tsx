interface FooterProps {
  version?: string;
}

export function Footer({ version }: FooterProps) {
  return (
    <footer className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8 w-full">
      <div className="text-center text-muted-foreground text-xs py-4 space-y-1">
        <p>
          <a
            href="https://github.com/RaviDasari/omni-mcp"
            className="text-[var(--accent-primary)] hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            omni-mcp on GitHub
          </a>
          {version ? ` · v${version}` : null}
        </p>
        <p>Local management UI — no login. Writes are limited to localhost.</p>
      </div>
    </footer>
  );
}
