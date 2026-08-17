'use client'

import { useCallback, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client/react'
import Accordion from '@mui/material/Accordion'
import AccordionDetails from '@mui/material/AccordionDetails'
import AccordionSummary from '@mui/material/AccordionSummary'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import LinearProgress from '@mui/material/LinearProgress'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { LIVE_FETCH_POLICY } from '@/lib/apollo'
import {
  ANKUENDIGUNG_DATENSATZ_MUTATION,
  ANKUENDIGUNGEN_QUERY,
  DATENSAETZE_QUERY,
  DATENSATZ_VERWERFEN_MUTATION,
  DATENSATZ_WAHL_QUERY,
  GEMEINDE_AKTIV_MUTATION,
  GEMEINDEN_QUERY,
  VEREINE_QUERY,
  SPIELE_QUERY,
  LAEUFE_QUERY,
  MELDUNGEN_QUERY,
  PORTAL_BEOBACHTEN_MUTATION,
  PORTAL_QUERY,
  QUELLEN_QUERY,
  WISSEN_QUERY,
  type AnkuendigungDatensatzErgebnis,
  type AnkuendigungenErgebnis,
  type DatensaetzeErgebnis,
  type DatensatzVerwerfenErgebnis,
  type DatensatzWahlErgebnis,
  type GemeindeAktivErgebnis,
  type GemeindenErgebnis,
  type VereineErgebnis,
  type SpieleErgebnis,
  type LaeufeErgebnis,
  type MeldungenErgebnis,
  type MeldungFelder,
  type PortalBeobachtenErgebnis,
  type PortalErgebnis,
  type QuellenErgebnis,
  type WissenErgebnis
} from '@/graphql/redaktion'
import { fortschritt, laufStatusText, zeitleiste } from '@/lib/redaktion'
import { Zeitleiste } from './Zeitleiste'
import { AuftragDialog, type AuftragZiel } from './AuftragDialog'
import { GemeindenAuswahl } from './GemeindenAuswahl'
import { Sportresultate } from './Sportresultate'
import { AgendaErfassen } from './AgendaErfassen'
import { PortalUebersicht } from './PortalUebersicht'
import { QuellenHinweis } from './QuellenHinweis'
import { MeldungKarte } from './MeldungKarte'

// The editorial workspace.
//
// The one component that fetches, kept thin so everything below it stays
// trivially testable. Reads go through Apollo; every write goes to the
// extension endpoint via a route handler, because that is where the state
// machine and the approval links live.

async function aktion(pfad: string, body?: unknown): Promise<string | null> {
  const antwort = await fetch(`/api/redaktion/${pfad}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
  const inhalt = (await antwort.json().catch(() => null)) as {
    errors?: { message: string }[]
    data?: { hinweise?: string[]; abgelehnt?: { grund: string }[] }
  } | null

  if (!antwort.ok) {
    return inhalt?.errors?.[0]?.message ?? 'Das hat nicht geklappt.'
  }

  // A 202 with nothing done is the confusing case: the request succeeded, the
  // screen does not change, and without this the button looks broken. The
  // backend already says why — it just has to reach the editor.
  const hinweise = inhalt?.data?.hinweise ?? []
  const abgelehnt = (inhalt?.data?.abgelehnt ?? []).map((a) => a.grund)
  const zusammen = [...hinweise, ...abgelehnt]

  return zusammen.length > 0 ? zusammen.join(' · ') : null
}

export function RedaktionPanel() {
  const [reiter, setReiter] = useState(0)
  const [gewaehlt, setGewaehlt] = useState<string | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)
  const [stapelAnweisung, setStapelAnweisung] = useState('')
  const [sendet, setSendet] = useState(false)

  const datensaetze = useQuery<DatensaetzeErgebnis>(DATENSAETZE_QUERY, {
    fetchPolicy: LIVE_FETCH_POLICY
  })
  const laeufe = useQuery<LaeufeErgebnis>(LAEUFE_QUERY, {
    fetchPolicy: LIVE_FETCH_POLICY
  })
  const ankuendigungen = useQuery<AnkuendigungenErgebnis>(ANKUENDIGUNGEN_QUERY, {
    fetchPolicy: LIVE_FETCH_POLICY
  })
  const wissen = useQuery<WissenErgebnis>(WISSEN_QUERY, {
    fetchPolicy: LIVE_FETCH_POLICY
  })
  const gemeinden = useQuery<GemeindenErgebnis>(GEMEINDEN_QUERY, {
    fetchPolicy: LIVE_FETCH_POLICY
  })
  const vereine = useQuery<VereineErgebnis>(VEREINE_QUERY, {
    fetchPolicy: LIVE_FETCH_POLICY
  })
  const spiele = useQuery<SpieleErgebnis>(SPIELE_QUERY, {
    fetchPolicy: LIVE_FETCH_POLICY
  })
  const [setzeAktiv] = useMutation<GemeindeAktivErgebnis>(GEMEINDE_AKTIV_MUTATION)

  // Loaded with the tab, not on demand: 181 rows is one small query, and a
  // picker that has to fetch before it can offer anything feels broken.
  const datensatzWahl = useQuery<DatensatzWahlErgebnis>(DATENSATZ_WAHL_QUERY, {
    fetchPolicy: LIVE_FETCH_POLICY
  })
  const [ordneZu] = useMutation<AnkuendigungDatensatzErgebnis>(ANKUENDIGUNG_DATENSATZ_MUTATION)
  const portal = useQuery<PortalErgebnis>(PORTAL_QUERY, { fetchPolicy: LIVE_FETCH_POLICY })
  const [setzeBeobachten] = useMutation<PortalBeobachtenErgebnis>(PORTAL_BEOBACHTEN_MUTATION)
  const [verwirf] = useMutation<DatensatzVerwerfenErgebnis>(DATENSATZ_VERWERFEN_MUTATION)
  const quellen = useQuery<QuellenErgebnis>(QUELLEN_QUERY, { fetchPolicy: LIVE_FETCH_POLICY })
  const [auftragFuer, setAuftragFuer] = useState<AuftragZiel | null>(null)
  // Der Deckel der Zeitleiste; „mehr anzeigen" hebt ihn schrittweise an.
  const [zeilen, setZeilen] = useState(40)

  const laufId = gewaehlt ?? laeufe.data?.laeufe[0]?.id ?? null
  const aktuellerLauf = laeufe.data?.laeufe.find((l) => l.id === laufId) ?? null

  // Polling is driven by the run's own status, not by the articles it returns —
  // reading the query's result to decide how to run the query is circular, and
  // TypeScript says so before it can become a runtime surprise.
  //
  // A workspace that polls forever hammers the database all night, so it stops
  // as soon as the run is no longer producing anything.
  const laeuftNoch =
    aktuellerLauf !== null && ['geplant', 'briefing', 'schreibt'].includes(aktuellerLauf.status)

  const meldungen = useQuery<MeldungenErgebnis>(MELDUNGEN_QUERY, {
    variables: { lauf: laufId },
    skip: laufId === null,
    fetchPolicy: LIVE_FETCH_POLICY,
    pollInterval: laeuftNoch ? 4000 : 0
  })

  const liste: MeldungFelder[] = meldungen.data?.meldungen ?? []

  const allesNeuLaden = useCallback(async () => {
    await Promise.all([laeufe.refetch(), meldungen.refetch?.(), datensaetze.refetch()])
  }, [laeufe, meldungen, datensaetze])

  async function fuehreAus(pfad: string, body?: unknown) {
    setSendet(true)
    setFehler(null)

    try {
      const problem = await aktion(pfad, body)
      if (problem !== null) setFehler(problem)
      await allesNeuLaden()
    } catch (error) {
      // Without this, a failing refetch — a broken query, a dropped connection —
      // skipped the reset below and left every button in the workspace disabled
      // for good, with nothing on screen to say why.
      setFehler(
        error instanceof Error
          ? `Die Ansicht konnte nicht aktualisiert werden: ${error.message}`
          : 'Die Ansicht konnte nicht aktualisiert werden.'
      )
    } finally {
      setSendet(false)
    }
  }

  // `gemeinden.aktiv` is plain configuration, so it goes straight to GraphQL —
  // no queue, no state machine, nothing an endpoint would add. Errors still have
  // to surface: a switch that silently springs back is worse than one that
  // refuses, because it looks like it worked.
  async function schalteGemeinden(ids: readonly string[], aktiv: boolean) {
    setSendet(true)
    setFehler(null)

    try {
      // Serial on purpose. "Alle" in the largest district is 30 writes, and
      // firing them at once buys nothing an editor would notice while making a
      // partial failure much harder to explain.
      for (const id of ids) {
        await setzeAktiv({ variables: { id, aktiv } })
      }
      await gemeinden.refetch()
    } catch (error) {
      setFehler(
        error instanceof Error
          ? `Die Gemeinde konnte nicht umgestellt werden: ${error.message}`
          : 'Die Gemeinde konnte nicht umgestellt werden.'
      )
      await gemeinden.refetch().catch(() => undefined)
    } finally {
      setSendet(false)
    }
  }

  async function ordneAn(eintragId: string, datensatzId: string | null) {
    await ordneZu({
      variables: {
        id: eintragId,
        datensatz: datensatzId === null ? null : { id: datensatzId },
        hinweis: datensatzId === null ? null : 'Von Hand zugeordnet.'
      }
    })
    await ankuendigungen.refetch()
  }

  async function schalteBereich(id: string, beobachten: boolean) {
    setSendet(true)
    setFehler(null)

    try {
      await setzeBeobachten({ variables: { id, beobachten } })
      await portal.refetch()
    } catch (error) {
      setFehler(
        error instanceof Error
          ? `Der Zweig konnte nicht umgestellt werden: ${error.message}`
          : 'Der Zweig konnte nicht umgestellt werden.'
      )
    } finally {
      setSendet(false)
    }
  }

  /**
   * „Vergiss es" — die redaktionelle Hälfte der Arbeitsteilung.
   *
   * Die Maschine sortiert aus, was mechanisch entscheidbar ist: keine
   * Gemeindeebene, tagesaktuelles Register. Was davon übrig bleibt, beurteilt
   * ein Mensch — und `ignoriert` hält, weil die tägliche Prüfung diesen Status
   * auch bei neuen Zahlen stehen lässt.
   */
  async function verwirfDatensatz(datensatzId: string, titel: string) {
    setSendet(true)
    setFehler(null)

    try {
      await verwirf({
        variables: {
          id: datensatzId,
          grund: 'Nicht relevant: von der Redaktion aussortiert.'
        }
      })
      await Promise.all([datensaetze.refetch(), datensatzWahl.refetch()])
      setFehler(`„${titel}" wird nicht mehr vorgeschlagen.`)
    } catch (error) {
      setFehler(
        error instanceof Error
          ? `Der Datensatz konnte nicht aussortiert werden: ${error.message}`
          : 'Der Datensatz konnte nicht aussortiert werden.'
      )
    } finally {
      setSendet(false)
    }
  }

  async function erfasseAnkuendigung(eintrag: {
    titel: string
    status: string
    datum: string | null
    quartal: string | null
    link: string | null
  }) {
    setSendet(true)
    setFehler(null)

    try {
      // Through the endpoint, not a mutation: it looks the agenda source up
      // itself, so the browser never has to know which id an entry belongs to —
      // and GraphQL's create input for that relation would want a whole new
      // source rather than a reference to the existing one.
      const problem = await aktion('ankuendigungen', eintrag)
      if (problem !== null) setFehler(problem)
      await ankuendigungen.refetch()
    } catch (error) {
      setFehler(
        error instanceof Error
          ? `Der Eintrag konnte nicht erfasst werden: ${error.message}`
          : 'Der Eintrag konnte nicht erfasst werden.'
      )
    } finally {
      setSendet(false)
    }
  }

  const stand = fortschritt(liste)

  return (
    <Stack spacing={3}>
      {fehler !== null && (
        // Not always an error: a run that already exists arrives here too.
        <Alert severity="info" onClose={() => setFehler(null)}>
          {fehler}
        </Alert>
      )}

      {/* A failing query used to render as an empty list, which reads like "no
          articles yet" and sends you looking in the wrong place. */}
      {[datensaetze, laeufe, meldungen, ankuendigungen, wissen, gemeinden, portal, quellen]
        .map((q) => q.error)
        .filter((e): e is NonNullable<typeof e> => e !== undefined)
        .slice(0, 1)
        .map((e) => (
          <Alert key="abfrage" severity="error">
            Die Daten konnten nicht geladen werden: {e.message}
          </Alert>
        ))}

      <QuellenHinweis quellen={quellen.data?.quellen ?? []} onErfassen={() => setReiter(1)} />

      <Tabs value={reiter} onChange={(_, v: number) => setReiter(v)}>
        <Tab label="Läufe" />
        <Tab label="statistik.bl" />
        <Tab label="Sportresultate" />
        <Tab label="Gelerntes" />
        <Tab label="Gemeinden" />
      </Tabs>

      {reiter === 0 && (
        <Stack spacing={3}>
          {laeufe.loading && <CircularProgress />}
          {laeufe.data?.laeufe.length === 0 && (
            <Alert severity="info">Noch kein Lauf. Unter „Datensätze“ einen freigeben.</Alert>
          )}

          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
            {laeufe.data?.laeufe.map((l) => (
              <Chip
                key={l.id}
                label={`${l.datensatz?.titel ?? 'Lauf'} — ${l.periode}`}
                onClick={() => setGewaehlt(l.id)}
                color={l.id === laufId ? 'primary' : 'default'}
              />
            ))}
          </Stack>

          {aktuellerLauf !== null && (
            <Paper sx={{ p: 3 }}>
              <Stack spacing={2}>
                <Typography variant="body2" color="text.secondary">
                  {laufStatusText(aktuellerLauf.status)} · {stand.fertig} von {stand.gesamt} Meldungen
                </Typography>
                {stand.gesamt > 0 && stand.prozent < 100 && (
                  <LinearProgress variant="determinate" value={stand.prozent} />
                )}
                {aktuellerLauf.fehler !== null && <Alert severity="warning">{aktuellerLauf.fehler}</Alert>}

                <Divider />

                <TextField
                  label="Anweisung an alle Meldungen dieses Laufs"
                  size="small"
                  multiline
                  minRows={2}
                  value={stapelAnweisung}
                  onChange={(e) => setStapelAnweisung(e.target.value)}
                  disabled={sendet}
                />
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                  <Button
                    variant="contained"
                    size="small"
                    disabled={sendet || stapelAnweisung.trim() === ''}
                    onClick={() =>
                      void fuehreAus(`laeufe/${aktuellerLauf.id}/chat`, {
                        anweisung: stapelAnweisung.trim()
                      }).then(() => setStapelAnweisung(''))
                    }
                  >
                    Auf alle anwenden
                  </Button>
                  <Button
                    size="small"
                    disabled={sendet}
                    onClick={() => void fuehreAus(`laeufe/${aktuellerLauf.id}/pruefung`)}
                  >
                    Alle gegenlesen lassen
                  </Button>
                  <Button
                    size="small"
                    disabled={sendet}
                    onClick={() => void fuehreAus(`laeufe/${aktuellerLauf.id}/publizieren`)}
                  >
                    Alle publizieren
                  </Button>
                </Stack>
              </Stack>
            </Paper>
          )}

          {liste.map((m) => (
            <MeldungKarte
              key={m.id}
              meldung={m}
              laeuft={sendet}
              onChat={async (id, anweisung) => {
                await fuehreAus(`meldungen/${id}/chat`, { anweisung })
              }}
              onAktion={async (id, was) => {
                await fuehreAus(`meldungen/${id}/${was}`)
              }}
            />
          ))}
        </Stack>
      )}

      {reiter === 1 && (
        <Stack spacing={1}>
          <Typography variant="body2" color="text.secondary">
            Woher unser Material kommt, nach Datum: die Publikationsagenda des Amts, Änderungen an den
            überwachten Portal-Zweigen und neue Zahlen auf data.bl.ch. Angekündigtes ohne Termin steht unten
            und rückt nach oben, sobald es ein Datum hat.
          </Typography>
          <AgendaErfassen
            quartale={[
              ...new Set(
                (ankuendigungen.data?.ankuendigungen ?? [])
                  .map((a) => a.quartal)
                  .filter((q): q is string => q !== null)
              )
            ].sort()}
            laeuft={sendet}
            onAnlegen={erfasseAnkuendigung}
          />
          {ankuendigungen.loading && <CircularProgress />}
          {ankuendigungen.data?.ankuendigungen.length === 0 && (
            <Alert severity="info">Noch keine Agenda gelesen.</Alert>
          )}
          <Zeitleiste
            ergebnis={zeitleiste(
              {
                ankuendigungen: ankuendigungen.data?.ankuendigungen ?? [],
                bereiche: portal.data?.portal_bereiche ?? [],
                datensaetze: datensaetze.data?.datensaetze ?? [],
                laeufe: laeufe.data?.laeufe ?? []
              },
              zeilen
            )}
            laeuft={sendet}
            onMeldungenAnsehen={(laufId) => {
              setGewaehlt(laufId)
              setReiter(0)
            }}
            onAuftrag={(eintrag) =>
              setAuftragFuer({
                titel: eintrag.titel,
                datensatzId: eintrag.datensatzId,
                ankuendigungId: eintrag.herkunft === 'agenda' ? eintrag.id.replace('agenda-', '') : null
              })
            }
            onVerwerfen={(eintrag) => {
              if (eintrag.datensatzId === null) return
              void verwirfDatensatz(eintrag.datensatzId, eintrag.titel)
            }}
            onMehr={() => setZeilen((bisher) => bisher + 40)}
          />

          <Accordion disableGutters>
            <AccordionSummary expandIcon={<span aria-hidden>▾</span>}>
              <Typography variant="body2">
                Alle {portal.data?.portal_bereiche.length ?? 0} Portal-Zweige
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <PortalUebersicht
                bereiche={portal.data?.portal_bereiche ?? []}
                seiten={portal.data?.portal_seiten ?? []}
                offen={portal.data?.offen[0]?.count.id ?? 0}
                laeuft={sendet}
                onBeobachten={(id, beobachten) => void schalteBereich(id, beobachten)}
              />
            </AccordionDetails>
          </Accordion>

          <AuftragDialog
            ziel={auftragFuer}
            datensaetze={datensatzWahl.data?.datensaetze ?? []}
            laeuft={sendet}
            onSchliessen={() => setAuftragFuer(null)}
            onTabelle={async (url, vorgabe) => {
              const antwort = await fetch('/api/redaktion/tabellen', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, ...(vorgabe === '' ? {} : { vorgabe }) })
              })
              const inhalt = (await antwort.json().catch(() => null)) as {
                errors?: { message: string }[]
                data?: { datensatz: string }
              } | null

              if (!antwort.ok) {
                throw new Error(inhalt?.errors?.[0]?.message ?? 'Das hat nicht geklappt.')
              }

              // Refetched rather than assembled from the response: the picker
              // must show the same row the run will use, not a copy of it.
              const neu = await datensatzWahl.refetch()
              return neu.data?.datensaetze.find((d) => d.id === inhalt?.data?.datensatz) ?? null
            }}
            onNurZuordnen={(datensatzId) => {
              const ankuendigung = auftragFuer?.ankuendigungId ?? null
              if (ankuendigung === null) return
              void ordneAn(ankuendigung, datensatzId).catch((error: unknown) =>
                setFehler(
                  error instanceof Error
                    ? `Die Zuordnung konnte nicht gespeichert werden: ${error.message}`
                    : 'Die Zuordnung konnte nicht gespeichert werden.'
                )
              )
            }}
            onStarten={({ datensatzId, vorgabe, gemeindefeld }) => {
              const ankuendigung = auftragFuer?.ankuendigungId ?? null
              void (async () => {
                // Assignment first: if the run is refused — because one already
                // exists for this period — the correction the editor made must
                // still be there when they come back. Only an agenda row has
                // something to assign; a catalogue change is already the dataset.
                if (ankuendigung !== null) await ordneAn(ankuendigung, datensatzId)
                await fuehreAus(`datensaetze/${datensatzId}/lauf`, {
                  ...(vorgabe === '' ? {} : { vorgabe }),
                  ...(gemeindefeld === null ? {} : { gemeindefeld })
                })
                await datensatzWahl.refetch()
              })()
            }}
          />
        </Stack>
      )}

      {reiter === 2 && (
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            Resultate und kommende Begegnungen der erfassten Vereine — nur Aktivmannschaften, kein Nachwuchs
            und keine Testspiele. Wird täglich aus dem Match Center des Verbands nachgeführt.
          </Typography>
          <Sportresultate spiele={spiele.data?.spiele ?? []} laedt={spiele.loading} />
        </Stack>
      )}

      {reiter === 3 && (
        <Stack spacing={1}>
          <Typography variant="body2" color="text.secondary">
            Regeln, die aus deinen Anweisungen gelernt wurden. Sie fliessen in jede weitere Meldung ein — auch
            nächstes Jahr.
          </Typography>
          {wissen.data?.redaktionswissen.length === 0 && <Alert severity="info">Noch nichts gelernt.</Alert>}
          {wissen.data?.redaktionswissen.map((w) => (
            <Paper key={w.id} sx={{ p: 2 }}>
              <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                <Chip size="small" label={w.geltungsbereich} />
                <Typography variant="body2">{w.regel}</Typography>
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}

      {reiter === 4 && (
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            Für welche Gemeinden ein Lauf Meldungen schreibt. Gilt ab dem nächsten Lauf; bereits erzeugte
            Meldungen bleiben, wie sie sind.
          </Typography>
          {gemeinden.loading && <CircularProgress />}
          <GemeindenAuswahl
            gemeinden={gemeinden.data?.gemeinden ?? []}
            vereine={vereine.data?.vereine ?? []}
            laeuft={sendet}
            onUmschalten={(id, aktiv) => schalteGemeinden([id], aktiv)}
          />
        </Stack>
      )}
    </Stack>
  )
}
