'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client/react'
import Accordion from '@mui/material/Accordion'
import AccordionDetails from '@mui/material/AccordionDetails'
import AccordionSummary from '@mui/material/AccordionSummary'
import Alert from '@mui/material/Alert'
import Chip from '@mui/material/Chip'
import Badge from '@mui/material/Badge'
import CircularProgress from '@mui/material/CircularProgress'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
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
  ALLE_MELDUNGEN_QUERY,
  ENTSORGUNGSKALENDER_QUERY,
  ENTSORGUNGSTERMINE_QUERY,
  WOCHENBLAETTER_QUERY,
  RECHERCHEHINWEISE_QUERY,
  OFFENE_PERLEN_QUERY,
  type EntsorgungskalenderErgebnis,
  type EntsorgungstermineErgebnis,
  type WochenblaetterErgebnis,
  type RecherchehinweiseErgebnis,
  type PerlenErgebnis,
  LAEUFE_QUERY,
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
  type AlleMeldungenErgebnis,
  type LaeufeErgebnis,
  type PortalBeobachtenErgebnis,
  type PortalErgebnis,
  type QuellenErgebnis,
  type WissenErgebnis
} from '@/graphql/redaktion'
import {
  anzahlBeschaeftigt,
  bleibtAufDemTisch,
  blogNachGemeinde,
  istBeschaeftigt,
  meldungenNachLauf,
  zeitleiste,
  type QuellenLaufStatus
} from '@/lib/redaktion'
import { QuellenLauf } from './QuellenLauf'
import { Presseschau } from './Presseschau'
import { Chefredaktion } from './Chefredaktion'
import { Zeitleiste } from './Zeitleiste'
import { AuftragDialog, type AuftragZiel } from './AuftragDialog'
import { GemeindenAuswahl } from './GemeindenAuswahl'
import { Sportresultate } from './Sportresultate'
import { Entsorgung } from './Entsorgung'
import { EntsorgungHinweis } from './EntsorgungHinweis'
import { GemeindeBlogs } from './GemeindeBlogs'
import { AgendaErfassen } from './AgendaErfassen'
import { PortalUebersicht } from './PortalUebersicht'
import { QuellenHinweis } from './QuellenHinweis'

// The editorial workspace.
//
// The one component that fetches, kept thin so everything below it stays
// trivially testable. Reads go through Apollo; every write goes to the
// extension endpoint via a route handler, because that is where the state
// machine and the approval links live.

interface AktionErgebnis {
  /** Was der Redaktorin gesagt werden muss — null, wenn nichts zu sagen ist. */
  fehler: string | null
  /**
   * Die Sitzung ist zu Ende. Der Proxy hat die Cookies bereits verworfen, es
   * hilft also nur noch eine neue Anmeldung — und ohne dieses Signal bliebe die
   * Oberflaeche angemeldet aussehen, waehrend jede Abfrage scheitert.
   */
  sitzungBeendet: boolean
}

async function aktion(pfad: string, body?: unknown): Promise<AktionErgebnis> {
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
    return {
      fehler: inhalt?.errors?.[0]?.message ?? 'Das hat nicht geklappt.',
      // 401 kommt hier ausschliesslich aus dem eigenen Proxy und heisst immer
      // dasselbe: angemeldet ist niemand mehr.
      sitzungBeendet: antwort.status === 401
    }
  }

  // A 202 with nothing done is the confusing case: the request succeeded, the
  // screen does not change, and without this the button looks broken. The
  // backend already says why — it just has to reach the editor.
  const hinweise = inhalt?.data?.hinweise ?? []
  const abgelehnt = (inhalt?.data?.abgelehnt ?? []).map((a) => a.grund)
  const zusammen = [...hinweise, ...abgelehnt]

  return {
    fehler: zusammen.length > 0 ? zusammen.join(' · ') : null,
    sitzungBeendet: false
  }
}

// Der Blog ist ueber die Adresse ansteuerbar: ?gemeinde=riehen oeffnet ihn
// gefiltert. Gelesen wird einmal beim Aufbau — die Komponente rendert nur im
// Browser (AppShell prueft erst die Session), der Guard schuetzt den Test-DOM.
function gemeindeAusUrl(): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get('gemeinde')
}

function schreibeGemeindeInUrl(slug: string | null): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (slug === null) url.searchParams.delete('gemeinde')
  else url.searchParams.set('gemeinde', slug)
  window.history.replaceState(null, '', url)
}

export interface RedaktionPanelProps {
  /**
   * Die Sitzung ist zu Ende — die Huelle soll neu pruefen und das
   * Anmeldeformular zeigen. Ohne das bliebe die Ansicht angemeldet aussehen,
   * waehrend nichts mehr laedt.
   */
  onSitzungEnde?: () => void | Promise<void>
}

export function RedaktionPanel({ onSitzungEnde }: RedaktionPanelProps = {}) {
  const [blogGemeinde, setBlogGemeinde] = useState<string | null>(gemeindeAusUrl)
  // Mit ?gemeinde=… startet die Ansicht im Blog — das ist der Sinn des Links.
  const [reiter, setReiter] = useState(blogGemeinde === null ? 0 : 5)
  const [kalenderWahl, setKalenderWahl] = useState<string | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)
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
  const alleMeldungen = useQuery<AlleMeldungenErgebnis>(ALLE_MELDUNGEN_QUERY, {
    fetchPolicy: LIVE_FETCH_POLICY
  })
  const kalender = useQuery<EntsorgungskalenderErgebnis>(ENTSORGUNGSKALENDER_QUERY, {
    fetchPolicy: LIVE_FETCH_POLICY
  })
  const wochenblaetter = useQuery<WochenblaetterErgebnis>(WOCHENBLAETTER_QUERY, {
    fetchPolicy: LIVE_FETCH_POLICY
  })
  const recherchehinweise = useQuery<RecherchehinweiseErgebnis>(RECHERCHEHINWEISE_QUERY, {
    fetchPolicy: LIVE_FETCH_POLICY
  })
  // Der Perlen-Stapel der Chefredaktion: Kandidaten mit Perlen-Vorschlag,
  // deren Urteil noch aussteht — unabhängig davon, ob eine Meldung daraus
  // wurde. Sie überleben neue Ausgaben, bis die Chefin entschieden hat.
  const offenePerlen = useQuery<PerlenErgebnis>(OFFENE_PERLEN_QUERY, {
    fetchPolicy: LIVE_FETCH_POLICY
  })
  // Per selected calendar, not all of them: a hundred dates times eighty-seven
  // municipalities is a table nobody looks at whole.
  const termine = useQuery<EntsorgungstermineErgebnis>(ENTSORGUNGSTERMINE_QUERY, {
    fetchPolicy: LIVE_FETCH_POLICY,
    variables: { kalender: kalenderWahl ?? '' },
    skip: kalenderWahl === null
  })
  // The PDF extraction runs detached on the server and takes minutes. While a
  // calendar reports 'liest', poll so the editor sees it finish; the termine
  // only change at the very end, so one refetch on the falling edge is enough.
  const wirdAusgelesen = (kalender.data?.entsorgungskalender ?? []).some(
    (eintrag) => eintrag.status === 'liest'
  )
  const { startPolling, stopPolling } = kalender
  const termineNeuLaden = termine.refetch
  const warAusgelesen = useRef(false)
  useEffect(() => {
    if (warAusgelesen.current && !wirdAusgelesen) void termineNeuLaden()
    warAusgelesen.current = wirdAusgelesen
    if (!wirdAusgelesen) return
    startPolling(10_000)
    return () => stopPolling()
  }, [wirdAusgelesen, startPolling, stopPolling, termineNeuLaden])
  // Same story for the press review: fetching and inventorying an issue runs
  // detached on the server, so the tab polls while any issue reports it.
  const wirdInventarisiert = (wochenblaetter.data?.wochenblaetter ?? []).some((blatt) =>
    blatt.ausgaben.some((a) => a.status === 'liest' || a.status === 'neu')
  )
  const { startPolling: blattPollingStart, stopPolling: blattPollingStop } = wochenblaetter
  const hinweiseNeuLaden = recherchehinweise.refetch
  const warInventarisiert = useRef(false)
  useEffect(() => {
    // New research leads land at the very end of an inventory — one refetch
    // on the falling edge keeps the tab badge honest.
    if (warInventarisiert.current && !wirdInventarisiert) void hinweiseNeuLaden()
    warInventarisiert.current = wirdInventarisiert
    if (!wirdInventarisiert) return
    blattPollingStart(10_000)
    return () => blattPollingStop()
  }, [wirdInventarisiert, blattPollingStart, blattPollingStop, hinweiseNeuLaden])

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

  const meldungenAlle = alleMeldungen.data?.meldungen ?? []
  // Schreiben und Ueberarbeiten laufen im Hintergrund weiter, nachdem der
  // Endpoint mit 202 geantwortet hat. Ohne dieses Polling lud die Ansicht genau
  // einmal neu — sofort, also bevor irgendetwas fertig sein konnte — und zeigte
  // danach den alten Text, bis jemand die Seite neu lud. Das sah aus wie ein
  // haengender Lauf und war keiner.
  const wirdGeschrieben = istBeschaeftigt(meldungenAlle)
  const offeneMeldungen = anzahlBeschaeftigt(meldungenAlle)
  const { startPolling: meldungPollingStart, stopPolling: meldungPollingStop } = alleMeldungen
  const laeufeNeuLaden = laeufe.refetch
  const warBeschaeftigt = useRef(false)
  useEffect(() => {
    // Der Laufstatus ("bereit") dreht erst mit der letzten Meldung — ein
    // Nachladen auf der fallenden Flanke haelt die Zeitleiste ehrlich.
    if (warBeschaeftigt.current && !wirdGeschrieben) void laeufeNeuLaden()
    warBeschaeftigt.current = wirdGeschrieben
    if (!wirdGeschrieben) return
    meldungPollingStart(5_000)
    return () => meldungPollingStop()
  }, [wirdGeschrieben, meldungPollingStart, meldungPollingStop, laeufeNeuLaden])
  const berichteZuLauf = meldungenNachLauf(meldungenAlle)
  const laufStatus = new Map((laeufe.data?.laeufe ?? []).map((l) => [l.id, l.status]))
  const blogs = blogNachGemeinde(meldungenAlle)
  const spielBerichte = meldungenAlle.filter((m) => m.spiel !== null)
  // Der Tisch der Redaktorin zählt, was noch Arbeit ist — dieselbe Regel wie
  // die Presseschau-Ansicht, damit Badge und Karten nie auseinanderlaufen.
  const meldungStatusJeKandidat = new Map(
    meldungenAlle.flatMap((m) => (m.kandidat === null ? [] : [[m.kandidat.id, m.status] as const]))
  )

  const allesNeuLaden = useCallback(async () => {
    await Promise.all([laeufe.refetch(), alleMeldungen.refetch(), datensaetze.refetch()])
  }, [laeufe, alleMeldungen, datensaetze])

  // The hand-started scrape run: state lives in the extension's process, this
  // only mirrors it. Polled while a run is under way; when it finishes, the
  // affected tabs are refetched once.
  const [quellenLaufStatus, setQuellenLaufStatus] = useState<QuellenLaufStatus | null>(null)
  const ladeQuellenLauf = useCallback(async () => {
    try {
      const antwort = await fetch('/api/redaktion/quellen/lauf')
      if (!antwort.ok) return
      const inhalt = (await antwort.json()) as { data?: QuellenLaufStatus }
      setQuellenLaufStatus(inhalt.data ?? null)
    } catch {
      // Die Anzeige ist Komfort; ein verpasster Abruf wird beim naechsten Poll
      // nachgeholt.
    }
  }, [])
  useEffect(() => {
    void ladeQuellenLauf()
  }, [ladeQuellenLauf])
  const quellenRefetch = quellen.refetch
  const datensaetzeRefetch = datensaetze.refetch
  const ankuendigungenRefetch = ankuendigungen.refetch
  const spieleRefetch = spiele.refetch
  const warUnterwegs = useRef(false)
  useEffect(() => {
    const unterwegs = quellenLaufStatus?.laeuft === true
    if (warUnterwegs.current && !unterwegs) {
      void Promise.all([quellenRefetch(), datensaetzeRefetch(), ankuendigungenRefetch(), spieleRefetch()])
    }
    warUnterwegs.current = unterwegs
    if (!unterwegs) return
    const intervall = setInterval(() => void ladeQuellenLauf(), 10_000)
    return () => clearInterval(intervall)
  }, [
    quellenLaufStatus?.laeuft,
    ladeQuellenLauf,
    quellenRefetch,
    datensaetzeRefetch,
    ankuendigungenRefetch,
    spieleRefetch
  ])

  async function fuehreAus(pfad: string, body?: unknown) {
    setSendet(true)
    setFehler(null)

    try {
      const { fehler: problem, sitzungBeendet } = await aktion(pfad, body)
      if (problem !== null) setFehler(problem)
      // Neu laden hat keinen Sinn mehr, wenn niemand mehr angemeldet ist — es
      // wuerde nur drei weitere Fehlschlaege erzeugen.
      if (sitzungBeendet) {
        await onSitzungEnde?.()
        return
      }
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
      const { fehler: problem, sitzungBeendet } = await aktion('ankuendigungen', eintrag)
      if (problem !== null) setFehler(problem)
      if (sitzungBeendet) {
        await onSitzungEnde?.()
        return
      }
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

  return (
    <Stack spacing={3}>
      {wirdGeschrieben && (
        <Alert severity="info" icon={<CircularProgress size={18} />}>
          {offeneMeldungen === 1
            ? 'Eine Meldung wird gerade geschrieben oder überarbeitet — die Ansicht aktualisiert sich von selbst.'
            : `${offeneMeldungen} Meldungen werden gerade geschrieben oder überarbeitet — die Ansicht aktualisiert sich von selbst.`}
        </Alert>
      )}

      {fehler !== null && (
        // Not always an error: a run that already exists arrives here too.
        <Alert severity="info" onClose={() => setFehler(null)}>
          {fehler}
        </Alert>
      )}

      {/* A failing query used to render as an empty list, which reads like "no
          articles yet" and sends you looking in the wrong place. */}
      {[
        datensaetze,
        laeufe,
        alleMeldungen,
        ankuendigungen,
        wissen,
        gemeinden,
        portal,
        quellen,
        // Without these a failing sport query rendered as "Noch keine Spiele
        // erfasst" — indistinguishable from a quiet week, and it sends you
        // looking at the connector instead of at the error.
        vereine,
        spiele
      ]
        .map((q) => q.error)
        .filter((e): e is NonNullable<typeof e> => e !== undefined)
        .slice(0, 1)
        .map((e) => (
          <Alert key="abfrage" severity="error">
            Die Daten konnten nicht geladen werden: {e.message}
          </Alert>
        ))}

      <QuellenHinweis quellen={quellen.data?.quellen ?? []} onErfassen={() => setReiter(0)} />

      <EntsorgungHinweis
        gemeinden={gemeinden.data?.gemeinden ?? []}
        kalender={kalender.data?.entsorgungskalender ?? []}
        onErfassen={() => setReiter(2)}
      />

      <Tabs value={reiter} onChange={(_, v: number) => setReiter(v)}>
        <Tab label="statistik.bl" />
        <Tab label="Sportresultate" />
        <Tab label="Entsorgung" />
        <Tab
          label={
            <Badge
              color="info"
              badgeContent={
                // Der Füllstand des Tischs: alles, was noch auf die
                // Redaktorin wartet — Offenes und Meldungen im Redigat.
                (wochenblaetter.data?.wochenblaetter ?? [])
                  .flatMap((b) => b.ausgaben)
                  .flatMap((a) => a.kandidaten)
                  .filter((k) => bleibtAufDemTisch(k.entscheid, meldungStatusJeKandidat.get(k.id) ?? null))
                  .length
              }
              sx={{ '& .MuiBadge-badge': { right: -12 } }}
            >
              Wochenblätter
            </Badge>
          }
        />
        <Tab
          label={
            <Badge
              color="warning"
              badgeContent={
                (recherchehinweise.data?.recherchehinweise ?? []).filter((h) => h.status === 'offen').length +
                (offenePerlen.data?.wochenblattkandidaten ?? []).length
              }
              sx={{ '& .MuiBadge-badge': { right: -12 } }}
            >
              Chefredaktion
            </Badge>
          }
        />
        <Tab label="Blog" />
        <Tab label="Gelerntes" />
        <Tab label="Gemeinden" />
      </Tabs>

      {reiter === 0 && (
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
            berichteZuLauf={berichteZuLauf}
            laufStatus={laufStatus}
            onStapelChat={async (laufId, anweisung) => {
              await fuehreAus(`laeufe/${laufId}/chat`, { anweisung })
            }}
            onStapelAktion={async (laufId, aktion) => {
              await fuehreAus(`laeufe/${laufId}/${aktion}`)
            }}
            onChat={async (id, anweisung) => {
              await fuehreAus(`meldungen/${id}/chat`, { anweisung })
            }}
            onAktion={async (id, was) => {
              await fuehreAus(`meldungen/${id}/${was}`)
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

      {reiter === 1 && (
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            Resultate und kommende Begegnungen der erfassten Vereine — nur Aktivmannschaften, kein Nachwuchs
            und keine Testspiele. Wird täglich aus dem Match Center des Verbands nachgeführt.
          </Typography>
          <Sportresultate
            spiele={spiele.data?.spiele ?? []}
            laedt={spiele.loading}
            berichte={spielBerichte}
            laeuft={sendet}
            onMeldungenErzeugen={async () => {
              // Ueber fuehreAus, nicht an ihm vorbei: sonst bleibt der Knopf
              // stumm („Wird geschrieben …“ erschien nie) und ein Fehler
              // landete nirgends.
              await fuehreAus('spielberichte')
              await Promise.all([spiele.refetch(), alleMeldungen.refetch()])
            }}
            onAllePublizieren={async () => {
              await fuehreAus('spielberichte/publizieren')
              await alleMeldungen.refetch()
            }}
            onChat={async (id, anweisung) => {
              await fuehreAus(`meldungen/${id}/chat`, { anweisung })
            }}
            onAktion={async (id, was) => {
              await fuehreAus(`meldungen/${id}/${was}`)
            }}
          />
        </Stack>
      )}

      {reiter === 2 && (
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            Der gedruckte Abfuhrkalender einer Gemeinde, einmal im Jahr erfasst. Daraus entstehen Erinnerungen
            an die aussergewöhnlichen Termine — Papier, Häckseldienst, Altmetall, Sonderabfälle. Die
            wöchentliche Kehrichtabfuhr bleibt bewusst aussen vor. Jede Erinnerung wird für ihren
            Newsletter-Tag geschrieben und am Vortag publiziert.
          </Typography>
          <Entsorgung
            gemeinden={gemeinden.data?.gemeinden ?? []}
            kalender={kalender.data?.entsorgungskalender ?? []}
            termine={termine.data?.entsorgungstermine ?? []}
            meldungen={meldungenAlle}
            gewaehlt={kalenderWahl}
            onWaehlen={setKalenderWahl}
            laeuft={sendet}
            onAnlegen={async (eingabe) => {
              await fuehreAus('entsorgung/kalender', eingabe)
              await kalender.refetch()
            }}
            onAuslesen={async (id) => {
              await fuehreAus(`entsorgung/kalender/${id}/extrahieren`)
              await Promise.all([kalender.refetch(), termine.refetch()])
            }}
            onBestaetigen={async (id, ids) => {
              await fuehreAus(
                `entsorgung/kalender/${id}/pruefen`,
                ids === undefined ? undefined : { termine: ids }
              )
              await Promise.all([kalender.refetch(), termine.refetch()])
            }}
            onMeldungen={async (id) => {
              await fuehreAus(`entsorgung/kalender/${id}/meldungen`)
              await termine.refetch()
            }}
            onFreigeben={async (id) => {
              await fuehreAus(`entsorgung/kalender/${id}/freigeben`)
            }}
            onChat={async (id, anweisung) => {
              await fuehreAus(`meldungen/${id}/chat`, { anweisung })
            }}
            onAktion={async (id, was) => {
              await fuehreAus(`meldungen/${id}/${was}`)
            }}
          />
        </Stack>
      )}

      {reiter === 3 && (
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            Was die Wochenblätter exklusiv haben. Der 9-Uhr-Lauf inventarisiert jede neue Ausgabe zu
            Kandidaten; aus übernommenen entsteht eine kurze Meldung mit Verweis aufs Blatt — abgelehnte
            lernen dem Inventar, was die Redaktion nicht will. Erledigtes verschwindet sofort vom Tisch, und
            mit jeder neuen Ausgabe verfallen die unentschiedenen Vorschläge der alten von selbst.
          </Typography>
          <Presseschau
            blaetter={wochenblaetter.data?.wochenblaetter ?? []}
            gemeinden={gemeinden.data?.gemeinden ?? []}
            meldungen={meldungenAlle}
            laedt={wochenblaetter.loading}
            laeuft={sendet}
            onAnlegen={async (eingabe) => {
              await fuehreAus('wochenblaetter', eingabe)
              await wochenblaetter.refetch()
            }}
            onPruefen={async () => {
              await fuehreAus('wochenblaetter/pruefen')
              await Promise.all([wochenblaetter.refetch(), recherchehinweise.refetch()])
            }}
            onInventar={async (id) => {
              await fuehreAus(`ausgaben/${id}/inventar`)
              await Promise.all([wochenblaetter.refetch(), recherchehinweise.refetch()])
            }}
            onMeldung={async (id) => {
              await fuehreAus(`kandidaten/${id}/meldung`)
              await Promise.all([wochenblaetter.refetch(), alleMeldungen.refetch()])
            }}
            onAblehnen={async (id, grund, kommentar) => {
              await fuehreAus(`kandidaten/${id}/ablehnen`, {
                grund,
                ...(kommentar === '' ? {} : { kommentar })
              })
              await wochenblaetter.refetch()
            }}
            onWeiterreichen={async (id, begruendung) => {
              await fuehreAus(`kandidaten/${id}/weiterreichen`, {
                ...(begruendung === '' ? {} : { begruendung })
              })
              await Promise.all([wochenblaetter.refetch(), recherchehinweise.refetch()])
            }}
            onGemeinde={async (id, gemeindeId) => {
              await fuehreAus(`kandidaten/${id}/gemeinde`, { gemeinde: gemeindeId })
              await wochenblaetter.refetch()
            }}
            onChat={async (id, anweisung) => {
              await fuehreAus(`meldungen/${id}/chat`, { anweisung })
            }}
            onAktion={async (id, was) => {
              // Publiziert oder verworfen heisst: weg vom Tisch. Die Karten
              // filtern über den Meldungsstatus, den fuehreAus frisch holt.
              await fuehreAus(`meldungen/${id}/${was}`)
            }}
          />
        </Stack>
      )}

      {reiter === 4 && (
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            Der Tisch der Chefredaktion: Recherche-Hinweise (aus Leserbriefen, vom Inventar oder von der
            Redaktion weitergereicht) und die Perlen-Frage zu Beiträgen der Wochenblätter — unabhängig davon,
            ob eine Meldung daraus wird. Beides bleibt liegen, bis es entschieden ist — auch über neue
            Ausgaben hinweg.
          </Typography>
          <Chefredaktion
            hinweise={recherchehinweise.data?.recherchehinweise ?? []}
            perlen={offenePerlen.data?.wochenblattkandidaten ?? []}
            laeuft={sendet}
            onHinweisUrteil={async (id, brauchbar, kommentar) => {
              await fuehreAus(`hinweise/${id}/bewerten`, {
                brauchbar,
                ...(kommentar === '' ? {} : { kommentar })
              })
              await recherchehinweise.refetch()
            }}
            onPerle={async (id, perle) => {
              // Das Urteil hängt am Kandidaten — ob je eine Meldung daraus
              // wurde, spielt keine Rolle.
              await fuehreAus(`kandidaten/${id}/perle`, { perle })
              await offenePerlen.refetch()
            }}
          />
        </Stack>
      )}

      {reiter === 5 && (
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            Alles, was für eine Gemeinde geschrieben wurde — neuste zuerst, gleich ob aus einer Statistik oder
            aus einem Spiel entstanden. Woher ein Beitrag kommt, ist eine Frage der Produktion; gelesen wird
            er als einer.
          </Typography>
          <GemeindeBlogs
            blogs={blogs}
            laedt={alleMeldungen.loading}
            auswahl={blogGemeinde}
            laeuft={sendet}
            onAuswahl={(slug) => {
              setBlogGemeinde(slug)
              schreibeGemeindeInUrl(slug)
            }}
            onPublizieren={async (id) => {
              await fuehreAus(`meldungen/${id}/publizieren`)
            }}
          />
        </Stack>
      )}

      {reiter === 6 && (
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

      {reiter === 7 && (
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            Für welche Gemeinden ein Lauf Meldungen schreibt. Gilt ab dem nächsten Lauf; bereits erzeugte
            Meldungen bleiben, wie sie sind.
          </Typography>
          <QuellenLauf
            status={quellenLaufStatus}
            laeuft={sendet}
            onStarten={async () => {
              await fuehreAus('quellen/lauf')
              await ladeQuellenLauf()
            }}
          />
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
