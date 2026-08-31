import { proxyToDirectus } from '@/lib/proxy.server'

// „Postfach jetzt prüfen" für das Regionaljournal — ein Proxy und nichts sonst.
//
// Der Ingest legt nur `pending`-Zeilen an; das Verarbeiten ist der separate
// Schritt je Dossier. Genau deshalb sind die beiden getrennt: mehrere
// 15–35-Sekunden-Verarbeitungen in einem HTTP-Request reissen auf einem echten
// Deployment den Reverse-Proxy-Timeout.
export async function POST(request: Request) {
  const body = await request.text()

  return proxyToDirectus('/dossiers-ingest', {
    method: 'POST',
    ...(body === '' ? {} : { body })
  })
}
