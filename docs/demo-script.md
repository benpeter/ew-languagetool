# Demo script (3 minutes)

Page: the "Über uns" page of [schamdan.de](https://schamdan.de/ueber-uns), a restaurant site in German, opened in Experience Workspace. The panel is set up as described in the [README](../README.md), with an empty site dictionary.

## Before you start

- Use a copy of the page, not the published one, so the fixes don't end up on the live site.
- Empty the `words` row of the site's `languagetool` sheet, so the dictionary step shows a change.
- Open the page in the editor, open Panels, then LanguageTool. Click Check page once and Continue, so the privacy notice doesn't interrupt the demo. Then reload.

## 0:00 The problem (20 seconds)

"Authors write and edit pages here every day. Typos and grammar slips go live because the editor has no proofreader. LanguageTool is an open-source proofreader for more than 30 languages, also available as a browser extension and for word processors. This extension brings it into Workspace."

## 0:20 Check the page (40 seconds)

Click Check page.

- The panel detects German and lists five issues: three spelling, one grammar, one punctuation.
- Point at the counts at the top, then at one issue: the sentence with the word underlined, LanguageTool's explanation, the suggestions.
- Real mistakes: "stehen Ihnen gerne zu Verfügung" (should be "zur"), and a missing comma before "die eine Unverträglichkeit auslösen".
- False alarms: "Schamdan" (twice, once in capitals) and "Ovinho", the wine shop. LanguageTool can't know names.

## 1:00 Site dictionary (30 seconds)

Click Add to site dictionary under "Schamdan". The count drops from 5 to 3, and the capitalized "SCHAMDAN" disappears too. Do the same for "Ovinho".

"The words are saved in the site settings, so every author on this site gets them. Authors who can't change the settings can ignore a word for the page instead."

## 1:30 Fix a selection (50 seconds)

In the editor, select "stehen Ihnen gerne zu Verfügung". Click Check selection.

- One issue: "zu" should be "zur". Click the "zur" suggestion; the corrected text shows above the Apply button.
- Click Apply 1 fix to the selection. The editor text changes in place, with undo available.

Then select the three paragraphs from "Dies vermeidet" to "Servicepersonal.", check, pick "Zutaten, die", apply. The comma appears and the paragraphs stay as they were.

"The panel only touches the text you selected, and it checks that the selection hasn't changed before it replaces anything."

## 2:20 Settings and servers (25 seconds)

Open Settings.

- The site uses the free LanguageTool API: no account, about 20 checks a minute.
- Each author can add their own premium key here. It stays in their browser and is never written to the site settings.
- A site can also point to its own LanguageTool server, so text never leaves the company.

If a premium key is set up, check the page again and point at issues marked "(premium)". Try this right before the demo: on 2026-11-11 the premium API returned no issues for this German page on most calls. If it still does, skip this step and leave the key out of the demo browser.

## 2:45 Wrap-up (15 seconds)

"Proofreading where authors write, a shared dictionary for brand names, fixes in place. It's a plain library plugin: one row in the site configuration, open source, and no backend."
