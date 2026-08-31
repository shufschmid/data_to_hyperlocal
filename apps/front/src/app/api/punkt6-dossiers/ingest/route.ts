import { proxyToDirectus } from '@/lib/proxy.server'

// Dasselbe Postfach wie beim Regionaljournal, anderer Betreff-Filter — die
// Trennung liegt im Backend, hier ist es nur eine zweite Adresse.
export async function POST(request: Request) {
  const body = await request.text()

  return proxyToDirectus('/punkt6-dossiers-ingest', {
    method: 'POST',
    ...(body === '' ? {} : { body })
  })
}
