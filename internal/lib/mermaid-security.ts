// Reused from GitDiagram src/features/diagram/mermaid-security.ts (MIT).
const safeGitHubClickDirective =
  /^\s*click\s+[a-z_][a-z0-9_-]*\s+"https:\/\/github\.com\/[^"\s]+"\s*$/iu;

// Mermaid's lexer tokenizes `click` followed by ANY whitespace run (tab, or
// even a newline — making a bare "click" line continue onto the next line), so
// detection must not assume the single-space form the compiler emits.
const clickDirectiveStart = /^click(\s|$)/u;

export function sanitizeMermaidSourceForRender(source: string): string {
  const lines: string[] = [];
  let insideConfigDirective = false;

  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    if (insideConfigDirective) {
      insideConfigDirective = !trimmed.includes('}%%');
      continue;
    }
    if (trimmed.startsWith('%%{')) {
      insideConfigDirective = !trimmed.includes('}%%');
      continue;
    }
    if (clickDirectiveStart.test(trimmed) && !safeGitHubClickDirective.test(line)) {
      continue;
    }
    lines.push(line);
  }

  return lines.join('\n');
}
