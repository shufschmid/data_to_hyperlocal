// Which content-management system built a page — read off the HTML, never off
// the host.
//
// The nine registered municipal sites run four templates, and the newsroom's
// rule is that a rule holds for a KIND of page, never for one municipality.
// So there is no host table: a page is fingerprinted on every read, and a
// page matching none of the four is a loud error on its source row, not an
// empty read. Measured on all nine: the fingerprints never co-occur.

export type Plattform =
  | 'weblication'
  | 'iweb_tabelle'
  | 'iweb_karten'
  | 'backslash'

export type DetailFamilie = 'weblication' | 'iweb' | 'backslash'

export function erkennePlattform(html: string): Plattform | null {
  if (
    /<table\b[^>]*\bid="informationList"/i.test(html) &&
    /data-webpack-module="datatables"/i.test(html)
  ) {
    return 'iweb_tabelle'
  }
  if (/\bid="newsCardlist"/i.test(html)) return 'iweb_karten'
  if (/\bclass="[^"]*\bmod-news-lst\b/i.test(html)) return 'backslash'
  if (/<meta\s+name="Generator"\s+content="Weblication/i.test(html))
    return 'weblication'
  return null
}

/** The two i-web list layouts share one detail-page template. */
export function detailFamilie(plattform: Plattform): DetailFamilie {
  if (plattform === 'iweb_tabelle' || plattform === 'iweb_karten') return 'iweb'
  return plattform
}

/** The family a detail page belongs to, when it has to be told from the page alone. */
export function erkenneDetailFamilie(html: string): DetailFamilie | null {
  if (
    /\bclass="[^"]*\bicms-wysiwyg\b/i.test(html) ||
    /\bclass="[^"]*\bicms-block-container\b/i.test(html)
  ) {
    return 'iweb'
  }
  if (
    /\bclass="[^"]*\bnews-content\b/i.test(html) &&
    /\bclass="[^"]*\bmain__title\b/i.test(html)
  ) {
    return 'backslash'
  }
  if (/<meta\s+name="Generator"\s+content="Weblication/i.test(html))
    return 'weblication'
  return null
}
