import { formatRanges, percentSkipped, toRanges, type PortionCut } from './match';

/** A plain-text checklist you can paste into notes or WhatsApp. */
export function readingList(cut: PortionCut, label: (page: number) => string, bookName: string): string {
  const lines: string[] = [];
  lines.push(`Portion Cut: ${bookName}`);
  lines.push(`Read ${cut.pages.length} of ${cut.totalPages} pages (${percentSkipped(cut)}% skipped).`);
  lines.push('');
  for (const match of cut.matches) {
    if (!match.covered) {
      lines.push(`[ ] ${match.topic.text}`);
      lines.push('    Probably not in this book. Find another source.');
      continue;
    }
    lines.push(`[ ] ${match.topic.text}`);
    lines.push(`    pp. ${formatRanges(toRanges(match.pages), label)}`);
    if (match.sections.length > 0) lines.push(`    ${match.sections.join('; ')}`);
  }
  return lines.join('\n');
}

export function pageLabeler(labels: string[]): (page: number) => string {
  return (page: number) => labels[page - 1] || String(page);
}
