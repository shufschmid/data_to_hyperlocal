import type { Knex } from 'knex'

/**
 * Die Preise je Million Tokens, damit «Gelerntes» → «Kosten» aus den Tokens
 * Geld rechnet.
 *
 * Quelle: die Preisliste der Anthropic-API, Stand 25. September 2026, in USD.
 * Eingabe und Ausgabe stehen dort je Modell; fuer den Cache gilt die
 * dokumentierte Regel (Lesen ein Zehntel, Schreiben das 1,25-Fache der
 * Eingabe), ausser wo die Liste einen eigenen Lesepreis nennt (Opus 5.5:
 * 0.20). Die datierte Haiku-ID steht neben der undatierten, weil dieses Haus
 * mit der datierten arbeitet und die API sie in der Antwort zurueckgibt.
 *
 * Insert-only, `ON CONFLICT (modell) DO NOTHING`: was die Redaktion
 * nachpflegt, bleibt. `down` entfernt nur, was diese Datei gesaet hat und
 * seither niemand angefasst hat (die Quelle sagt es).
 */

const QUELLE =
  'Anthropic-Preisliste, Stand 25.09.2026 (Cache: Lesen 0,1x, Schreiben 1,25x der Eingabe, ausser wo dokumentiert)'

const PREISE: ReadonlyArray<{
  modell: string
  eingabe: number
  ausgabe: number
  cacheLesen: number
  cacheSchreiben: number
}> = [
  {
    modell: 'claude-haiku-4-5-20251001',
    eingabe: 1,
    ausgabe: 5,
    cacheLesen: 0.1,
    cacheSchreiben: 1.25
  },
  {
    modell: 'claude-haiku-4-5',
    eingabe: 1,
    ausgabe: 5,
    cacheLesen: 0.1,
    cacheSchreiben: 1.25
  },
  {
    modell: 'claude-sonnet-5',
    eingabe: 2,
    ausgabe: 10,
    cacheLesen: 0.2,
    cacheSchreiben: 2.5
  },
  {
    modell: 'claude-sonnet-5-5',
    eingabe: 2,
    ausgabe: 10,
    cacheLesen: 0.2,
    cacheSchreiben: 2.5
  },
  {
    modell: 'claude-opus-5',
    eingabe: 5,
    ausgabe: 25,
    cacheLesen: 0.5,
    cacheSchreiben: 6.25
  },
  {
    modell: 'claude-opus-5-5',
    eingabe: 4,
    ausgabe: 20,
    cacheLesen: 0.2,
    cacheSchreiben: 5
  }
]

export async function up(knex: Knex): Promise<void> {
  for (const p of PREISE) {
    await knex('modellpreise')
      .insert({
        id: knex.raw('gen_random_uuid()'),
        modell: p.modell,
        eingabe_je_mio: p.eingabe,
        ausgabe_je_mio: p.ausgabe,
        cache_lesen_je_mio: p.cacheLesen,
        cache_schreiben_je_mio: p.cacheSchreiben,
        waehrung: 'USD',
        quelle: QUELLE
      })
      .onConflict(['modell'])
      .ignore()
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex('modellpreise').where({ quelle: QUELLE }).delete()
}
