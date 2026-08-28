import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { importLinks, type LinkInput } from '~/lib/links'
import { parseLinkCsv } from '~/lib/csv'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: () => void
}

export function LinkImportDialog({ open, onOpenChange, onImported }: Props) {
  const [rows, setRows] = useState<LinkInput[]>([])
  const [filename, setFilename] = useState('')
  const [conflict, setConflict] = useState<'skip' | 'replace' | 'generate'>('skip')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Awaited<ReturnType<typeof importLinks>> | null>(null)

  useEffect(() => {
    if (open) {
      setResult(null)
      setRows([])
      setFilename('')
    }
  }, [open])

  async function choose(file?: File) {
    if (!file) return
    try {
      const parsed = parseLinkCsv(await file.text())
      if (parsed.length > 200) throw new Error('Import at most 200 links at a time')
      setRows(parsed)
      setFilename(file.name)
    } catch (error) {
      setRows([])
      toast.error(error instanceof Error ? error.message : 'Could not read CSV')
    }
  }

  async function submit() {
    setLoading(true)
    try {
      const result = await importLinks({ data: { rows, conflict } })
      const summary = `${result.created} created, ${result.updated} updated, ${result.skipped} skipped`
      setResult(result)
      result.errors.length ? toast.warning(`${summary}; ${result.errors.length} row errors`) : toast.success(summary)
      onImported()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Import failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import links from CSV</DialogTitle>
          <DialogDescription>Up to 200 rows. Required column: url or destination. Optional: code, title, tags, status, starts_at, expires_at, expired_redirect_url, max_clicks, privacy_enabled, password.</DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="grid gap-3">
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              {result.created} created · {result.updated} updated · {result.skipped} skipped
            </div>
            {result.errors.length > 0 && (
              <div className="max-h-56 overflow-y-auto rounded-md border">
                {result.errors.map((error) => (
                  <div key={`${error.row}-${error.message}`} className="border-b px-3 py-2 text-sm last:border-0">
                    <span className="font-medium">Row {error.row}:</span> {error.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="csv-file">CSV file</Label>
            <Input id="csv-file" type="file" accept=".csv,text/csv" onChange={(event) => choose(event.target.files?.[0])} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="conflicts">When a code already exists</Label>
            <select id="conflicts" className="h-9 rounded-md border bg-background px-3 text-sm" value={conflict} onChange={(event) => setConflict(event.target.value as typeof conflict)}>
              <option value="skip">Skip it</option>
              <option value="generate">Generate a new code</option>
              <option value="replace">Replace the accessible link</option>
            </select>
          </div>
          {rows.length > 0 && (
            <div className="rounded-md border">
              <div className="border-b px-3 py-2 text-sm font-medium">{filename}: {rows.length} link{rows.length === 1 ? '' : 's'}</div>
              <Table>
                <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Destination</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {rows.slice(0, 5).map((row, index) => (
                    <TableRow key={`${row.code ?? 'random'}-${index}`}>
                      <TableCell className="font-mono">{row.code ? `/${row.code}` : 'random'}</TableCell>
                      <TableCell className="max-w-[360px] truncate">{row.url}</TableCell>
                      <TableCell>{row.status}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {rows.length > 5 && <div className="border-t px-3 py-2 text-xs text-muted-foreground">And {rows.length - 5} more…</div>}
            </div>
          )}
        </div>}
        <DialogFooter>
          {result ? (
            <Button onClick={() => { onOpenChange(false); setRows([]); setFilename('') }}>Done</Button>
          ) : (
            <Button onClick={submit} disabled={loading || rows.length === 0}>{loading ? 'Importing…' : `Import ${rows.length || ''} links`}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
