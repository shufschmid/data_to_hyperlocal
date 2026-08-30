import { gql } from '@apollo/client'

// GraphQL documents live here, one file per area — not inline in components.
//
// Directus derives this API from the data model: a collection `meldungen` gives
// `meldungen`, `meldungen_by_id`, `update_meldungen_item` and so on. Explore it
// at http://localhost:8055/graphql.
//
// Writes to `meldungen` and `laeufe` deliberately do NOT go through GraphQL.
// Every state change there runs through the `redaktion` extension endpoint,
// because that is where the queue and the approval links live. A mutation from
// the browser would bypass none of the rules — the hook still guards the
// transition — but it would skip minting the approval link, so the two paths
// would not be equivalent.
//
// Plain configuration is different. `gemeinden.aktiv` has no state machine, no
// queue and no side effect; Directus permissions already decide who may set it.
// Routing that through an endpoint would be ceremony around a boolean, so it
// uses a mutation, which is the template's default for collection writes.

export interface DatensatzFelder {
  id: string
  externe_id: string
  titel: string
  beschreibung: string | null
  status: string
  hat_gemeinde: boolean
  bewertung: string | null
  /** When the portal itself last changed the data — the timeline's date. */
  portal_modified: string | null
  /** When the data moved, as opposed to its description. */
  daten_stand: string | null
  /** `annual`, `daily`, `irregular` … — what the catalogue declares. */
  rhythmus: string | null
  zeilen: number | null
  /** Das Agenda-Thema, zu dem der Datensatz gehoert — dann zeigt die Zeitleiste nur dieses. */
  ankuendigung: { id: string } | null
}

export interface DatensaetzeErgebnis {
  datensaetze: DatensatzFelder[]
}

// One of the three feeds of the timeline. Sorted by the portal's own change
// date, not by ours: the question the row answers is "when did the office touch
// this", and `date_updated` moves whenever we write anything at all.
//
// Only 9 of 188 datasets have an agenda entry, so this feed carries the large
// majority of what actually happens — the continuously updated ones the office
// never announces.
export const DATENSAETZE_QUERY = gql`
  query Datensaetze($limit: Int = 60) {
    datensaetze(
      filter: { hat_gemeinde: { _eq: true }, status: { _in: ["neu", "relevant"] } }
      sort: ["-portal_modified"]
      limit: $limit
    ) {
      id
      externe_id
      titel
      beschreibung
      status
      hat_gemeinde
      bewertung
      portal_modified
      daten_stand
      rhythmus
      zeilen
      ankuendigung {
        id
      }
    }
  }
`

export interface DatensatzVerwerfenErgebnis {
  update_datensaetze_item: { id: string; status: string } | null
}

/**
 * „Vergiss es" — für immer.
 *
 * Der Gegenpart zur maschinellen Aussortierung: die Maschine entscheidet, was
 * mechanisch nicht geht (keine Gemeindeebene, tagesaktuelles Register), der
 * Mensch entscheidet über den journalistischen Wert. Und `ignoriert` hält: die
 * tägliche Prüfung lässt diesen Status auch dann stehen, wenn neue Zahlen
 * kommen — nachzulesen in `uebernehme()`.
 */
export const DATENSATZ_VERWERFEN_MUTATION = gql`
  mutation DatensatzVerwerfen($id: ID!, $grund: String!) {
    update_datensaetze_item(id: $id, data: { status: "ignoriert", bewertung: $grund }) {
      id
      status
    }
  }
`

export interface MeldungFelder {
  id: string
  titel: string | null
  lead: string | null
  text: string | null
  status: string
  verarbeitung: string
  /** `cast-csv` in Directus, so a real list here. */
  zeit_warnungen: string[] | null
  fehler: string | null
  publiziert_am: string | null
  gemeinde: { id: string; name: string; bezirk: string } | null
}

export interface LaufFelder {
  id: string
  periode: string
  status: string
  briefing: string | null
  fehler: string | null
  date_created: string | null
  datensatz: { id: string; titel: string } | null
}

export interface LaeufeErgebnis {
  laeufe: LaufFelder[]
}

// A run does not carry its articles. The reverse side of the M2O was never
// created — `directus_relations.one_field` is null for `meldungen.lauf`, so
// there is no `laeufe { meldungen }` to ask for. They are fetched separately by
// MELDUNGEN_QUERY below, which is also what lets the workspace poll just the
// articles while a run is being written.
//
// The limit is not cosmetic: the agenda tab asks "does this dataset already
// have a run?" against this list. A run that fell off the end would offer
// "Meldung erzeugen" for something already written, and the endpoint would
// answer with a refusal instead of the articles.
export const LAEUFE_QUERY = gql`
  query Laeufe($limit: Int = 50) {
    laeufe(sort: ["-date_created"], limit: $limit) {
      id
      periode
      status
      briefing
      fehler
      date_created
      datensatz {
        id
        titel
      }
    }
  }
`

export interface MeldungenErgebnis {
  meldungen: MeldungFelder[]
}

// Two things here are easy to get wrong, and both fail as a *validation* error
// rather than an empty result — so the workspace showed nothing at all:
//
//   - `lauf` is a relation, not a column. Directus builds no `_eq` on a relation
//     filter; the comparison goes one level deeper, on the related `id`.
//   - the variable is an `ID`, not a `GraphQLStringOrFloat`. That type is for
//     scalar columns; a relation key is typed `ID`.
export const MELDUNGEN_QUERY = gql`
  query Meldungen($lauf: ID!) {
    meldungen(filter: { lauf: { id: { _eq: $lauf } } }, sort: ["gemeinde.name"], limit: -1) {
      id
      titel
      lead
      text
      status
      verarbeitung
      zeit_warnungen
      fehler
      publiziert_am
      gemeinde {
        id
        name
        bezirk
      }
    }
  }
`

// Alle Meldungen auf einmal — Statistik wie Sport.
//
// Loest die zwei frueheren Abfragen ab (eine pro Lauf, eine fuer Spielberichte).
// Der Grund ist die neue Aufteilung: die Zeitleiste zeigt die Berichte unter
// ihrem Eintrag, und der Gemeinde-Blog mischt beide Herkuenfte chronologisch.
// Beides braucht denselben Bestand, nur anders gruppiert — zwei Abfragen dafuer
// waeren zwei Wahrheiten.
//
// `lauf` und `spiel` sind beide nullbar und schliessen einander aus: eine
// Meldung gehoert entweder zu einem Datensatz-Lauf oder zu einer Begegnung.
export interface AlleMeldungFelder {
  id: string
  titel: string | null
  lead: string | null
  text: string | null
  status: string
  verarbeitung: string
  zeit_warnungen: string[] | null
  fehler: string | null
  publiziert_am: string | null
  /** Only set on waste-collection reminders: the newsletter day they belong to. */
  erscheint_am: string | null
  date_created: string | null
  gemeinde: { id: string; name: string; bezirk: string } | null
  lauf: { id: string } | null
  spiel: {
    id: string
    heim: string
    gast: string
    datum: string
    sportart: string
    wettbewerb: string
  } | null
  /** Only set on press-review articles: the Wochenblatt candidate behind them. */
  kandidat: { id: string } | null
  /** Decided at publish time on press reviews: interesting for the city too. */
  perle: boolean | null
}

export interface AlleMeldungenErgebnis {
  meldungen: AlleMeldungFelder[]
}

export const ALLE_MELDUNGEN_QUERY = gql`
  query AlleMeldungen {
    meldungen(sort: ["-date_created"], limit: -1) {
      id
      titel
      lead
      text
      status
      verarbeitung
      zeit_warnungen
      fehler
      publiziert_am
      erscheint_am
      date_created
      gemeinde {
        id
        name
        bezirk
      }
      lauf {
        id
      }
      spiel {
        id
        heim
        gast
        datum
        sportart
        wettbewerb
      }
      kandidat {
        id
      }
      perle
    }
  }
`

export interface ChatNachricht {
  id: string
  rolle: string
  inhalt: string
  position: number
}

export interface ChatErgebnis {
  chat_nachrichten: ChatNachricht[]
}

export const LAUF_CHAT_QUERY = gql`
  query LaufChat($lauf: ID!) {
    chat_nachrichten(
      # Same relation-filter shape as MELDUNGEN_QUERY above.
      filter: { lauf: { id: { _eq: $lauf } } }
      # position first, id as the tie-breaker: two turns can land in the same
      # millisecond and an unstable order would reshuffle the conversation.
      sort: ["position", "id"]
      limit: -1
    ) {
      id
      rolle
      inhalt
      position
    }
  }
`

export interface AnkuendigungFelder {
  id: string
  titel: string
  status: string
  datum: string | null
  quartal: string | null
  link: string | null
  /** The portal dataset behind this entry, once the backend has found it. */
  datensatz: { id: string; titel: string; status: string; hat_gemeinde: boolean } | null
  zuordnung_hinweis: string | null
}

export interface AnkuendigungenErgebnis {
  ankuendigungen: AnkuendigungFelder[]
}

// No limit and no sort by status: the workspace shows the agenda the way the
// office publishes it — by quarter, chronological inside — and `nachQuartal`
// does that ordering. A page of 40 cut four entries off the end of the year
// without saying so.
//
// `date_created` is the base order on purpose. Announced entries carry no date,
// so this is all that is left of the order the source listed them in.
export const ANKUENDIGUNGEN_QUERY = gql`
  query Ankuendigungen {
    ankuendigungen(sort: ["date_created", "id"], limit: -1) {
      id
      titel
      status
      datum
      quartal
      link
      datensatz {
        id
        titel
        status
        hat_gemeinde
      }
      zuordnung_hinweis
    }
  }
`

// Every dataset, for the picker in the agenda tab — including the ones without
// a municipality column and the ones already dealt with. That is the point:
// this list is what an editor reaches for when the automatic match was wrong,
// so filtering it the way DATENSAETZE_QUERY does would hide exactly the entries
// they are looking for. `felder` comes along so the dialog can offer the real
// column names when detection found none.
export interface DatensatzWahlFelder {
  id: string
  externe_id: string
  titel: string
  status: string
  hat_gemeinde: boolean
  gemeindefeld: string | null
  standard_vorgabe: string | null
  felder: { name: string; type: string }[] | null
}

export interface DatensatzWahlErgebnis {
  datensaetze: DatensatzWahlFelder[]
}

export const DATENSATZ_WAHL_QUERY = gql`
  query DatensatzWahl {
    datensaetze(sort: ["titel"], limit: -1) {
      id
      externe_id
      titel
      status
      hat_gemeinde
      gemeindefeld
      standard_vorgabe
      felder
    }
  }
`

export interface AnkuendigungDatensatzErgebnis {
  update_ankuendigungen_item: { id: string } | null
}

/**
 * Assigns the portal dataset to an agenda entry by hand.
 *
 * The nightly matching only looks at entries that have no dataset, so a
 * decision made here is never overwritten by the next guess. Clearing it again
 * (passing null) puts the entry back in the queue, which is what an editor who
 * assigned the wrong one would expect.
 */
// The relation trap again, this time on the write side: `datensatz` is not an
// `ID` here but `update_datensaetze_input`, so the value is `{ id }` and never
// the bare uuid. An `ID` variable is rejected as a validation error, which
// arrives looking exactly like a permission problem.
export const ANKUENDIGUNG_DATENSATZ_MUTATION = gql`
  mutation AnkuendigungDatensatz($id: ID!, $datensatz: update_datensaetze_input, $hinweis: String) {
    update_ankuendigungen_item(id: $id, data: { datensatz: $datensatz, zuordnung_hinweis: $hinweis }) {
      id
    }
  }
`

export interface GemeindeFelder {
  id: string
  name: string
  bezirk: string
  bfs_nummer: number
  aktiv: boolean
}

export interface GemeindenErgebnis {
  gemeinden: GemeindeFelder[]
}

export const GEMEINDEN_QUERY = gql`
  query Gemeinden {
    gemeinden(sort: ["bezirk", "name"], limit: -1) {
      id
      name
      bezirk
      bfs_nummer
      aktiv
    }
  }
`

// The clubs a municipality is known for. Read-only in the workspace: adding and
// editing happens in the Directus admin until the football connector exists,
// because a proposed club needs a confirm/reject affordance rather than a blank
// form, and building the form twice would be waste.
export interface VereinFelder {
  id: string
  name: string
  sportart: string
  /** `aushaengeschild` — regional reach — or `breitensport`, the village itself. */
  bedeutung: string
  /** A snapshot: placements change every season. Never authoritative on its own. */
  liga: string | null
  spielort: string | null
  /** False while the club is only a proposal from a source. */
  zuordnung_geprueft: boolean
  aktiv: boolean
  gemeinde: { id: string } | null
}

export interface VereineErgebnis {
  vereine: VereinFelder[]
}

// Fetched flat and grouped in the browser rather than nested under `gemeinden`:
// the relation is a plain m2o on `vereine`, so Directus exposes no reverse field
// to nest through.
export const VEREINE_QUERY = gql`
  query Vereine {
    vereine(sort: ["name"], limit: -1) {
      id
      name
      sportart
      bedeutung
      liga
      spielort
      zuordnung_geprueft
      aktiv
      gemeinde {
        id
      }
    }
  }
`

// Matches — played and still to come. Written by the connector, read-only here.
//
// `gemeinde` and `sportart` are stored on the row rather than reached through
// `verein`, so the two filters the workspace offers are plain field reads.
export interface SpielFelder {
  id: string
  spielnummer: string
  datum: string
  heim: string
  gast: string
  /** Both null until the source shows a complete result. */
  tore_heim: number | null
  tore_gast: number | null
  wettbewerb: string
  ort: string | null
  status: string | null
  sportart: string
  gemeinde: { id: string; name: string } | null
  /** `liga` kommt mit, damit der Sport-Reiter die erste Mannschaft erkennt. */
  verein: { id: string; name: string; liga: string | null } | null
}

export interface SpieleErgebnis {
  spiele: SpielFelder[]
}

// Newest first: a newsroom looks at what just happened before what is coming.
// The split into past and future is made in the browser against the current
// clock, so it stays right without a refetch.
export const SPIELE_QUERY = gql`
  query Spiele {
    spiele(sort: ["-datum"], limit: -1) {
      id
      spielnummer
      datum
      heim
      gast
      tore_heim
      tore_gast
      wettbewerb
      ort
      status
      sportart
      gemeinde {
        id
        name
      }
      verein {
        id
        name
        liga
      }
    }
  }
`

export interface GemeindeAktivErgebnis {
  update_gemeinden_item: { id: string; aktiv: boolean } | null
}

/**
 * Switches one municipality on or off.
 *
 * `aktiv` decides who gets an article on the next run, so this is the single
 * most consequential setting in the workspace — one more municipality is one
 * more paid call per run.
 */
export const GEMEINDE_AKTIV_MUTATION = gql`
  mutation GemeindeAktiv($id: ID!, $aktiv: Boolean!) {
    update_gemeinden_item(id: $id, data: { aktiv: $aktiv }) {
      id
      aktiv
    }
  }
`

// The portal inventory. Two levels, because "Letzte Änderung" is published per
// branch and not per table — the branch is the only unit that can be watched,
// while the pages under it are what decide whether it is worth watching.
export interface PortalBereichFelder {
  id: string
  pfad: string
  titel: string
  stand: string | null
  beobachten: boolean
  inventur_offen: boolean
  unklar: number
  letzte_pruefung: string | null
  letzter_fehler: string | null
}

export interface PortalSeiteFelder {
  id: string
  pfad: string
  titel: string
  art: string
  form: string | null
  gemeindeebene: boolean
  treffer: number
  ods_datensatz: string | null
  beobachten: boolean
  hinweis: string | null
  bereich: { id: string } | null
  datensatz: { id: string; titel: string; status: string } | null
  ankuendigung: { id: string; titel: string } | null
}

export interface PortalErgebnis {
  portal_bereiche: PortalBereichFelder[]
  portal_seiten: PortalSeiteFelder[]
  /** Directus returns aggregate counts as strings in GraphQL. */
  offen: { count: { id: number } }[]
}

/**
 * Branches, the tables that matter, and how much of the inventory is left.
 *
 * Only pages that are a municipality table are fetched: the portal has some
 * 2'800 pages and all but a fraction are navigation or cantonal tables, which
 * an editor never needs to see.
 */
export const PORTAL_QUERY = gql`
  query Portal {
    portal_bereiche(sort: ["pfad"], limit: -1) {
      id
      pfad
      titel
      stand
      beobachten
      inventur_offen
      unklar
      letzte_pruefung
      letzter_fehler
    }
    portal_seiten(filter: { gemeindeebene: { _eq: true } }, sort: ["pfad"], limit: -1) {
      id
      pfad
      titel
      art
      form
      gemeindeebene
      treffer
      ods_datensatz
      beobachten
      hinweis
      bereich {
        id
      }
      datensatz {
        id
        titel
        status
      }
      ankuendigung {
        id
        titel
      }
    }
    offen: portal_seiten_aggregated(filter: { art: { _eq: "offen" } }) {
      count {
        id
      }
    }
  }
`

export interface PortalBeobachtenErgebnis {
  update_portal_bereiche_item: { id: string; beobachten: boolean } | null
}

/**
 * Switches the daily check for one branch.
 *
 * Derived by the inventory, but overridable: the coverage question is a model's
 * judgement, and an editor who knows better should not have to argue with it.
 */
export const PORTAL_BEOBACHTEN_MUTATION = gql`
  mutation PortalBeobachten($id: ID!, $beobachten: Boolean!) {
    update_portal_bereiche_item(id: $id, data: { beobachten: $beobachten }) {
      id
      beobachten
    }
  }
`

export interface QuelleFelder {
  id: string
  name: string
  typ: string
  basis_url: string
  letzte_pruefung: string | null
  letzter_fehler: string | null
}

export interface QuellenErgebnis {
  quellen: QuelleFelder[]
}

/**
 * The sources and whether the last check worked.
 *
 * The agenda host sits behind a Cloudflare Managed Challenge. When it turns us
 * away, the run writes the reason here — and until now that reason lived only
 * in the Directus admin, which is the one place an editor never looks. A source
 * that cannot be read is news, so it belongs on the front page of the
 * workspace.
 */
export const QUELLEN_QUERY = gql`
  query Quellen {
    quellen(filter: { aktiv: { _eq: true } }, sort: ["name"], limit: -1) {
      id
      name
      typ
      basis_url
      letzte_pruefung
      letzter_fehler
    }
  }
`

export interface WissenFelder {
  id: string
  regel: string
  geltungsbereich: string
  herkunft: string
  aktiv: boolean
}

export interface WissenErgebnis {
  redaktionswissen: WissenFelder[]
}

export const WISSEN_QUERY = gql`
  query Redaktionswissen {
    redaktionswissen(filter: { aktiv: { _eq: true } }, sort: ["-date_created"], limit: -1) {
      id
      regel
      geltungsbereich
      herkunft
      aktiv
    }
  }
`

// --- Entsorgung ------------------------------------------------------------
//
// The printed waste calendar of a municipality, and the exceptional collection
// dates read out of it. Both are small collections — one row per municipality
// and year, a hundred or so dates below each — so both are fetched whole and
// grouped in the browser, like the timeline.

export interface EntsorgungsdokumentFelder {
  id: string
  zone: string | null
  zusatz: string | null
  status: string
  quelle_url: string | null
  fehler: string | null
  pdf: { id: string } | null
}

export interface EntsorgungskalenderFelder {
  id: string
  jahr: number
  status: string
  merkblatt: string | null
  gemeinde: { id: string; name: string } | null
  /** One per zone — the Riehen case — or a single one for the whole municipality. */
  dokumente: EntsorgungsdokumentFelder[]
}

export interface EntsorgungskalenderErgebnis {
  entsorgungskalender: EntsorgungskalenderFelder[]
}

export const ENTSORGUNGSKALENDER_QUERY = gql`
  query Entsorgungskalender {
    entsorgungskalender(sort: ["-jahr", "gemeinde.name"], limit: -1) {
      id
      jahr
      status
      merkblatt
      gemeinde {
        id
        name
      }
      dokumente {
        id
        zone
        zusatz
        status
        quelle_url
        fehler
        pdf {
          id
        }
      }
    }
  }
`

export interface EntsorgungsterminFelder {
  id: string
  kategorie: string
  zone: string | null
  datum: string
  anmeldeschluss: string | null
  anmeldeschluss_zeit: string | null
  bereitstellung: string | null
  anmeldung: string | null
  warnung: string | null
  geprueft: boolean
  meldung: { id: string } | null
}

export interface EntsorgungstermineErgebnis {
  entsorgungstermine: EntsorgungsterminFelder[]
}

// The relation filter needs the nested `{ id: { _eq: ... } }` shape and an `ID!`
// variable — a plain uuid or `GraphQLStringOrFloat` is rejected. Both traps are
// documented at the top of this file.
export const ENTSORGUNGSTERMINE_QUERY = gql`
  query Entsorgungstermine($kalender: ID!) {
    entsorgungstermine(
      filter: { kalender: { id: { _eq: $kalender } } }
      sort: ["datum", "kategorie"]
      limit: -1
    ) {
      id
      kategorie
      zone
      datum
      anmeldeschluss
      anmeldeschluss_zeit
      bereitstellung
      anmeldung
      warnung
      geprueft
      meldung {
        id
      }
    }
  }
`

// --- Presseschau: Wochenblaetter, Ausgaben, Kandidaten ----------------------

export interface KandidatFelder {
  id: string
  titel: string
  seite: number | null
  typ: string
  /** Zuordnung des Inventars — bei Mehr-Gemeinden-Blättern korrigierbar. */
  gemeinde: { id: string; name: string } | null
  gemeinde_korrigiert: boolean
  frontseite: boolean
  warum_exklusiv: string | null
  zusammenfassung: string | null
  perle_vorschlag: boolean
  perle_begruendung: string | null
  entscheid: string
  ablehnungsgrund: string | null
  ablehnungskommentar: string | null
}

export interface AusgabeFelder {
  id: string
  schluessel: string
  nummer: string | null
  datum: string | null
  seite_url: string | null
  pdf_url: string | null
  seiten: number | null
  status: string
  fehler: string | null
  /** Textlayer je Seite — die Ausklappbox „Originaltext" neben jedem Vorschlag. */
  seiten_texte: string[] | null
  kandidaten: KandidatFelder[]
}

export interface WochenblattFelder {
  id: string
  name: string
  archiv_url: string
  aktiv: boolean
  letzte_pruefung: string | null
  letzter_fehler: string | null
  gemeinde: { id: string; name: string } | null
  /** Alle Gemeinden, über die das Blatt schreibt — der Anzeiger hat zwei. */
  abdeckungen: Array<{ id: string; gemeinde: { id: string; name: string } | null }>
  /** Die neuesten Ausgaben zuerst; die Ansicht zeigt die erste. */
  ausgaben: AusgabeFelder[]
}

export interface WochenblaetterErgebnis {
  wochenblaetter: WochenblattFelder[]
}

export const WOCHENBLAETTER_QUERY = gql`
  query Wochenblaetter {
    wochenblaetter(sort: ["gemeinde.name"], limit: -1) {
      id
      name
      archiv_url
      aktiv
      letzte_pruefung
      letzter_fehler
      gemeinde {
        id
        name
      }
      abdeckungen {
        id
        gemeinde {
          id
          name
        }
      }
      ausgaben(sort: ["-datum"], limit: 1) {
        id
        schluessel
        nummer
        datum
        seite_url
        pdf_url
        seiten
        status
        fehler
        seiten_texte
        kandidaten(sort: ["seite"], limit: -1) {
          id
          titel
          seite
          typ
          gemeinde {
            id
            name
          }
          gemeinde_korrigiert
          frontseite
          warum_exklusiv
          zusammenfassung
          perle_vorschlag
          perle_begruendung
          entscheid
          ablehnungsgrund
          ablehnungskommentar
        }
      }
    }
  }
`

// --- Recherche-Faehrten: nie Inhalt, immer Arbeit --------------------------

export interface RecherchehinweisFelder {
  id: string
  titel: string
  fundort: string | null
  seite: number | null
  begruendung: string | null
  /** Der Wortlaut der Fundseite, beim Anlegen kopiert — die Fährte überlebt ihre Ausgabe. */
  quelltext: string | null
  status: string
  kommentar: string | null
  date_created: string | null
  gemeinde: { id: string; name: string } | null
  ausgabe: {
    id: string
    nummer: string | null
    pdf_url: string | null
    wochenblatt: { id: string; name: string } | null
  } | null
}

export interface RecherchehinweiseErgebnis {
  recherchehinweise: RecherchehinweisFelder[]
}

export const RECHERCHEHINWEISE_QUERY = gql`
  query Recherchehinweise {
    recherchehinweise(sort: ["-date_created"], limit: 100) {
      id
      titel
      fundort
      seite
      begruendung
      quelltext
      status
      kommentar
      date_created
      gemeinde {
        id
        name
      }
      ausgabe {
        id
        nummer
        pdf_url
        wochenblatt {
          id
          name
        }
      }
    }
  }
`

// Die Gemeinde-Korrektur an einem Kandidaten laeuft ueber den Endpoint
// (POST /redaktion/kandidaten/:id/gemeinde) — dieselbe Falle wie bei den
// Ankuendigungen: die GraphQL-Mutation typt die Relation als Create-Input
// und will eine ganze neue Gemeinde statt einer Referenz. Der Hook
// `kandidat-gemeinde` markiert die Korrektur auf jedem Schreibweg als
// Lernsignal (`gemeinde_korrigiert`).

/**
 * Ein Kandidat mit Perlen-Vorschlag, dessen Urteil noch aussteht — der
 * Perlen-Stapel auf dem Tisch der Chefredaktion. Das Urteil hängt am
 * KANDIDATEN und ist unabhängig davon, ob je eine Meldung daraus wird;
 * darum überlebt der Stapel auch neue Ausgaben (das Aufräumen verschont
 * Perlen-Vorschläge). `seiten_texte` kommt mit, damit sie das Urteil am
 * Original fällt statt an der Zusammenfassung.
 */
export interface PerleFelder {
  id: string
  titel: string
  seite: number | null
  zusammenfassung: string | null
  perle_begruendung: string | null
  entscheid: string
  gemeinde: { id: string; name: string } | null
  ausgabe: {
    id: string
    nummer: string | null
    pdf_url: string | null
    seiten_texte: string[] | null
    wochenblatt: { id: string; name: string } | null
  } | null
}

export interface PerlenErgebnis {
  wochenblattkandidaten: PerleFelder[]
}

export const OFFENE_PERLEN_QUERY = gql`
  query OffenePerlen {
    wochenblattkandidaten(
      filter: { perle_vorschlag: { _eq: true }, perle: { _null: true } }
      sort: ["-date_created"]
      limit: 50
    ) {
      id
      titel
      seite
      zusammenfassung
      perle_begruendung
      entscheid
      gemeinde {
        id
        name
      }
      ausgabe {
        id
        nummer
        pdf_url
        seiten_texte
        wochenblatt {
          id
          name
        }
      }
    }
  }
`
