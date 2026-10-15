import { Download } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '~/components/ui/dialog'

export function LinkQrDialog({ code, onClose }: { code: string | null; onClose: () => void }) {
  return (
    <Dialog open={Boolean(code)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle className="truncate font-mono">/{code}</DialogTitle>
          <DialogDescription>Scan to open this short link.</DialogDescription>
        </DialogHeader>
        {code && (
          <div className="grid justify-items-center gap-4">
            <div className="rounded-xl border bg-white p-3 shadow-sm">
              <img src={`/api/qr/${code}`} alt={`QR code for /${code}`} width={224} height={224} />
            </div>
            <Button variant="outline" className="w-full" asChild>
              <a href={`/api/qr/${code}`} download={`${code}.png`}><Download /> Download PNG</a>
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
