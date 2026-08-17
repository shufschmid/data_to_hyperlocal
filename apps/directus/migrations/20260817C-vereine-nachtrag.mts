import type { Knex } from 'knex'

/**
 * Binningen and Bottmingen, plus a correction to VBC Riehen.
 *
 * The correction is why this is a migration rather than an edit in the admin
 * UI: `20260817B` seeds VBC Riehen with the wrong league, so every fresh
 * install would reproduce the error. Fixing the data here keeps the seed and
 * the running database saying the same thing.
 *
 * `Schwimmen` joins the `sportart` list — Bottmingen's flagship is a swimming
 * club, and a value outside the dropdown shows as an unknown raw value in the
 * admin UI.
 *
 * Note on `bedeutung`: both Binningen clubs are marked `aushaengeschild`
 * because the newsroom filed them that way — its list for Binningen has a
 * single heading, "Clubs in überregionalen Ligen (Höchstes Publikumsinteresse)",
 * and both sit under it. SC Binningen is the village football club *and* plays
 * überregional, which is precisely the case the two-way split handles badly; if
 * an editor disagrees, this is one dropdown in the admin UI.
 */

const SPORTARTEN_NEU = [
  'Fussball',
  'Volleyball',
  'Basketball',
  'Handball',
  'Unihockey',
  'American Football',
  'Schwimmen',
  'Schwingen',
  'Curling',
  'Schach',
  'Turnen',
  'Anderer'
]

const SPORTARTEN_ALT = SPORTARTEN_NEU.filter(
  (sportart) => sportart !== 'Schwimmen'
)

// Only the men's first team is covered: it plays Nationalliga A, while the
// women play 1. Liga. The seed recorded the ambiguity the newsroom has since
// resolved.
const VBC_RIEHEN_LIGA_NEU = 'Nationalliga A (Herren)'
const VBC_RIEHEN_NOTIZ_NEU =
  'Das sportliche Aushängeschild der Gemeinde im Ballsport. Beruecksichtigt wird die Herrenmannschaft in der Nationalliga A; die Damen spielen in der 1. Liga. Heimspiele in der Sporthalle Niederholz.'
const VBC_RIEHEN_LIGA_ALT =
  'Nationalliga B bzw. 1. Liga (Damen) — zu bestaetigen'
const VBC_RIEHEN_NOTIZ_ALT =
  'Das sportliche Aushängeschild der Gemeinde im Ballsport. Die Damen 1 ziehen bei ihren Heimspielen das grösste Hallensport-Publikum in Riehen an.'

interface Saat {
  bfs: number
  name: string
  sportart: string
  bedeutung: string
  liga: string | null
  spielort: string | null
  notiz: string
}

const SAAT: readonly Saat[] = [
  {
    bfs: 2765,
    name: 'SC Binningen',
    sportart: 'Fussball',
    bedeutung: 'aushaengeschild',
    liga: '2. Liga interregional',
    spielort: 'Sportplatz Spiegelfeld, Binningen',
    notiz:
      'Der 1920 gegründete SCB ist der grösste und zuschauerstärkste Sportverein des Ortes. Die 1. Mannschaft spielt in der überregionalen 2. Liga interregional. Mit einer riesigen Juniorenabteilung sorgt der Club bei Heimspielen und Derbys für die grösste Kulisse in der Gemeinde.'
  },
  {
    bfs: 2765,
    name: 'Handball Blau Boys Binningen',
    sportart: 'Handball',
    bedeutung: 'aushaengeschild',
    liga: '1. Liga',
    spielort: 'Spiegelfeld-Halle, Binningen',
    notiz:
      'Das Aushängeschild im lokalen Hallensport. Die «Blau Boys» ziehen bei ihren Heimspielen in der Spiegelfeld-Halle das engagierteste Hallensport-Publikum an.'
  },
  {
    bfs: 2767,
    name: 'Schwimmclub Bottmingen-Oberwil',
    sportart: 'Schwimmen',
    bedeutung: 'aushaengeschild',
    liga: null,
    spielort: 'Hallenbad und Gartenbad beim Schloss Bottmingen',
    notiz:
      'Der SBO ist das sportliche Aushängeschild der Gemeinde mit hoher regionaler Präsenz. Der Club vertritt die Region erfolgreich an nationalen und regionalen Schwimm-Meetings. Traegt Bottmingen und Oberwil im Namen; gefuehrt wird er hier unter Bottmingen.'
  }
]

async function setzeSportarten(
  knex: Knex,
  sportarten: readonly string[]
): Promise<void> {
  await knex('directus_fields')
    .where({ collection: 'vereine', field: 'sportart' })
    .update({
      options: JSON.stringify({
        choices: sportarten.map((sportart) => ({
          text: sportart,
          value: sportart
        }))
      })
    })
}

export async function up(knex: Knex): Promise<void> {
  await setzeSportarten(knex, SPORTARTEN_NEU)

  const gemeinden = (await knex('gemeinden').select(
    'id',
    'bfs_nummer'
  )) as ReadonlyArray<{
    id: string
    bfs_nummer: number
  }>
  const nachBfs = new Map(
    gemeinden.map((gemeinde) => [gemeinde.bfs_nummer, gemeinde.id])
  )

  const zeilen = SAAT.map((verein) => {
    const gemeindeId = nachBfs.get(verein.bfs)
    if (gemeindeId === undefined) {
      throw new Error(
        `No municipality with BFS number ${verein.bfs} for club ${verein.name}`
      )
    }
    return {
      name: verein.name,
      gemeinde: gemeindeId,
      sportart: verein.sportart,
      bedeutung: verein.bedeutung,
      liga: verein.liga,
      spielort: verein.spielort,
      notiz: verein.notiz,
      quelle: 'manuell',
      zuordnung_geprueft: true,
      aktiv: true
    }
  })

  await knex('vereine').insert(zeilen).onConflict(['gemeinde', 'name']).ignore()

  const riehen = nachBfs.get(2703)
  if (riehen !== undefined) {
    await knex('vereine')
      .where({ gemeinde: riehen, name: 'VBC Riehen' })
      .update({ liga: VBC_RIEHEN_LIGA_NEU, notiz: VBC_RIEHEN_NOTIZ_NEU })
  }
}

export async function down(knex: Knex): Promise<void> {
  const gemeinden = (await knex('gemeinden').select(
    'id',
    'bfs_nummer'
  )) as ReadonlyArray<{
    id: string
    bfs_nummer: number
  }>
  const nachBfs = new Map(
    gemeinden.map((gemeinde) => [gemeinde.bfs_nummer, gemeinde.id])
  )

  const riehen = nachBfs.get(2703)
  if (riehen !== undefined) {
    await knex('vereine')
      .where({ gemeinde: riehen, name: 'VBC Riehen' })
      .update({ liga: VBC_RIEHEN_LIGA_ALT, notiz: VBC_RIEHEN_NOTIZ_ALT })
  }

  for (const verein of SAAT) {
    const gemeindeId = nachBfs.get(verein.bfs)
    if (gemeindeId === undefined) continue
    await knex('vereine')
      .where({ gemeinde: gemeindeId, name: verein.name })
      .delete()
  }

  await setzeSportarten(knex, SPORTARTEN_ALT)
}
