import { defineHook } from '@directus/extensions-sdk'

// Marks a candidate whose municipality the editor reassigned.
//
// The inventory assigns each piece to a municipality (page index where
// present, content otherwise) — and it is allowed to be wrong, as long as it
// learns. The flag set here is that lesson's raw material: `lernDigest` turns
// flagged candidates into "this piece belonged to Pratteln" examples for the
// next inventory of the same paper.
//
// A hook, not endpoint logic: the reassignment happens in the workspace via a
// plain GraphQL update AND may happen in the Directus admin UI — the rule has
// to hold on every write path. The inventory itself never UPDATES the field
// (it sets it on create, and the re-inventory diff deliberately leaves it
// alone), so any update that touches `gemeinde` is an editor speaking.

export default defineHook(({ filter }) => {
  filter('wochenblattkandidaten.items.update', (payload) => {
    const daten = payload as Record<string, unknown>
    if (!('gemeinde' in daten)) return payload
    if ('gemeinde_korrigiert' in daten) return payload

    return { ...daten, gemeinde_korrigiert: true }
  })
})
