export type ReportExportResult =
  | Readonly<{ status: 'saved' | 'download_started' | 'cancelled'; error: null }>
  | Readonly<{ status: 'failed'; error: string }>;

export function reportFileName(): string {
  return `fastcook-report-${Date.now()}.json`;
}
