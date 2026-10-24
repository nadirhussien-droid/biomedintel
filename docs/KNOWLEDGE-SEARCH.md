# Knowledge search: finding the right page from everyday words (24 Oct 2026)

BiomedIntel.ai — _Smarter Maintenance. Safer Healthcare._

Reported by Nadir Isse on staging (backlog B-16). He uploaded and approved a Bair Hugger 750 knowledge base PDF. The word "fuse" appears in it once, as the heading "Fuse replacement" on page 4. Describing the fault as "fuse blown" found nothing.

## What was wrong

- The PDF was read correctly: 6 pages, 20 passages, including the fuse section.
- The **search box** returned only passages containing **every** word typed. The manual never says "blown", so "fuse blown" returned nothing, while "fuse" alone worked.
- **IntellAssist** kept a manual passage only when it shared **two** meaningful words with the fault description, so a two-word fault such as "fuse blown" could never match a passage that only says "fuse".
- When many passages matched, common words (such as "replace", which appears in most sections) counted as much as rare, telling words (such as "fuse").

## What changed

- **Search box:** every word is tried first. If no passage has them all, it shows passages with any of the words, with a note: "No passage contains all of the words … These contain some of them, best match first. Check that each one really applies."
- **Ranking:** rare words in the organisation's manuals weigh more than common ones (inverse document frequency), so the most specific section comes first.
- **IntellAssist:** a description with one or two meaningful words needs one of them in a passage. Longer descriptions still need two, so a vague description does not pull in unrelated manuals. The existing test for that case still passes. The same rare-word ranking orders the passages.
- Nothing changes about what a person may see (approval, hospital and access level, other organisations).

## Checked against the real PDF (local, fictional organisation)

| Typed or described                        | Before            | After                                      |
| ----------------------------------------- | ----------------- | ------------------------------------------ |
| fuse                                      | found (page 4)    | found, first                               |
| fuse blown / blown fuse                   | nothing           | found, first (marked "some of your words") |
| fuse is blown and needs replacing         | nothing           | fuse section first of 15                   |
| unit has no power fuse blown              | nothing           | fuse section first of 17                   |
| IntellAssist: "Fuse blown" and 2 variants | no manual passage | fuse section retrieved first               |

Tests: `tests/integration/knowledge.test.ts`, 'a short fault description finds the matching passage ("Fuse blown" → the fuse section)'.

## Note

IntellAssist only searches manuals when an AI provider is configured and AI is switched on (IntellAssist → Settings). On staging no AI provider is configured, so it reports "not configured". The search box works without AI.

## Choosing equipment in the filters (fixed 24 Oct 2026)

Found on staging: with "any model" the manual was found, but choosing the right
equipment found nothing. Two causes, both fixed:

- A document with **no equipment links** is general (IntellAssist already treats
  it that way) but the search page hid it as soon as any filter was chosen. It
  now appears under every filter, shown as "General".
- The model, category and manufacturer lists all had to match the same link.
  A manual linked only to the manufacturer (or only to the category) vanished
  when all three were chosen. Now, choosing a **model** means "this exact
  device": documents linked to that model, its category or its manufacturer
  (and general documents) are found, and the other two lists are ignored.
  Choosing only a category and/or manufacturer finds general documents,
  documents linked to that category or manufacturer, and documents linked to a
  model that fits every list chosen.
