# Demo script (3 minutes)

Page: a copy of the "Über uns" page of [schamdan.de](https://schamdan.de/ueber-uns),
a restaurant site in German, opened in Experience Workspace. The panel is set up as
described in the [README](../README.md), with an empty site dictionary. For an
English demo, use the Frescopa copy instead (see the end).

## Before you start

- Use a copy of the page, not the published one, so the fixes don't end up on the
  live site.
- Empty the `words` row of the site's `languagetool` sheet, so the dictionary step
  shows a change.
- Open the page in the editor, open Panels, then LanguageTool. Choose **Check page**
  once and **Continue**, so the privacy notice doesn't interrupt the demo. Then
  reload.

## 0:00 The problem (20 seconds)

"Authors write and edit pages here every day. Typos and grammar slips go live because
the editor has no proofreader. LanguageTool is an open-source proofreader for more
than 30 languages, also available as a browser extension and for word processors.
This extension brings it into Workspace."

## 0:20 Check the page (40 seconds)

Choose **Check page**.

- The panel detects German and counts five issues: three spelling, one grammar, one
  punctuation. The list looks like Preflight's: a section per type.
- Open the grammar issue with **View suggestions**: LanguageTool's explanation, the
  sentence with "zu" underlined, and the fix in the sentence, "zur Verfügung".
- The other real mistake is a missing comma in "Zutaten die eine Unverträglichkeit
  auslösen".
- False alarms: "Schamdan" (twice, once in capitals) and "Ovinho", the wine shop.
  LanguageTool can't know names.

## 1:00 Site dictionary (30 seconds)

Open "Schamdan" and choose **Add to site dictionary**. The count drops from 5 to 3,
and the capitalized "SCHAMDAN" disappears too. Do the same for "Ovinho".

"The words are saved in the site settings, so every author on this site gets them.
Authors who can't change the settings can ignore a word for the page instead."

## 1:30 Fix it (50 seconds)

Two ways:

- Open the "zu" issue again and choose **Apply change**. The panel asks the Workspace
  assistant to make one exact change (change "zu" to "zur" in the paragraph that starts
  with …). Only on sites with Workspace chat.
- In the editor, select the paragraph with "Zutaten die". Choose **Check selection**,
  open the issue, choose **Use this fix**, then **Apply 1 fix**. The comma appears in
  place, with undo available.

"The panel only touches the text you selected, and it checks that the selection
hasn't changed before it replaces anything."

## 2:20 Settings and servers (25 seconds)

Point at "Using LanguageTool free API" at the bottom and open its (i) button.

- The site uses the free LanguageTool API: no account, about 20 checks a minute. The
  (i) shows what is sent and the site settings.
- Open the **⋯** menu: each author can add their own Premium key there. It stays in
  their browser and is never written to the site settings.
- A site can also point to its own LanguageTool server, so text never leaves the
  company.

Skip Premium for German pages: on 2026-11-11 the Premium API returned no issues for
this page on most calls. English Premium results were stable.

## 2:45 Wrap-up (15 seconds)

"Proofreading where authors write, a shared dictionary for brand names, fixes in
place or through the assistant. It's a plain library plugin: one row in the site
configuration, open source, and no backend."

## English version

The `benpeter/frescopa` site is a copy of the Frescopa coffee demo with the panel set
up and `language` set to `en-US`. Open
https://da.live/canvas#/benpeter/frescopa/drafts/benp/sustainability-lt and switch the
editor to **Content**. The draft has seven planted mistakes:

- Spelling: "comitted", "enviromental"
- Grammar: "Its how we earn trust", "Our machines is engineered"
- Punctuation: "contamination ." and "However we focus" (missing comma)
- Style: "very unique"

**Check page** finds 13 issues, because "Frescopa" shows up six times as a spelling
mistake. **Add to site dictionary** on one of them brings the count down to 7. The steps
are the same as in the German script: open "Its", then select the paragraph and fix it
with **Check selection**.
