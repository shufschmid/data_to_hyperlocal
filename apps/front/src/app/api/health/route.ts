import { NextResponse } from 'next/server'

// GET /api/health — used by the docker-compose healthcheck.
//
// Deliberately unauthenticated and deliberately dumb: it says "this process serves
// requests", nothing more. Do not make it check Directus — a readiness probe that
// depends on a downstream service restarts a perfectly healthy container whenever
// the dependency hiccups.
export function GET() {
  return NextResponse.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } })
}
