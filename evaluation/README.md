# Pilot evaluation protocol

The goal is to measure whether your internal GLM deployment helps people finish real work. The following are **task templates**, not completed benchmark results. Supply approved source material and expected outcomes before running them.

For each task, record a stable task ID in the project title, a baseline manual completion time, the initial brief, two revision instructions, and a short acceptance checklist. Repeat a subset of tasks to check consistency. Keep every attempt, including failures. Let a colleague review the artifact without being told which system produced it where practical.

## Thirty representative tasks

| ID  | Format   | Work brief                                                    | Required evidence                                              |
| --- | -------- | ------------------------------------------------------------- | -------------------------------------------------------------- |
| W01 | Web      | Employee service portal with categories and request filtering | Filtering works; labels match the supplied service catalogue   |
| W02 | Web      | Procurement intake form with clearly grouped fields           | Required fields work; submission states that it is a prototype |
| W03 | Web      | Project status dashboard using a supplied sample dataset      | Every displayed status and number matches the source           |
| W04 | Web      | Onboarding checklist with expandable instructions             | Expansion works; all required steps remain present             |
| W05 | Web      | Knowledge base with category tabs and search                  | Tabs and filters work independently                            |
| W06 | Web      | Meeting room directory with room details dialogs              | Capacity and room names match supplied data                    |
| W07 | Web      | Internal event information page                               | Required details remain legible on desktop and mobile          |
| W08 | Web      | IT incident status page                                       | States are distinguishable without relying on colour alone     |
| W09 | Web      | Policy comparison screen                                      | Text is accurate; long descriptions do not overflow            |
| W10 | Web      | Recreate a permitted screenshot using your brand              | Layout hierarchy matches; unrelated content survives edits     |
| S01 | Slides   | Six-slide project update from supplied notes                  | All numbers and status claims trace to the notes               |
| S02 | Slides   | Eight-slide training deck on an internal process              | Every required step is covered in the correct order            |
| S03 | Slides   | Four-slide proposal comparing two options                     | Native editable comparison table; no invented benefits         |
| S04 | Slides   | Five-slide onboarding introduction                            | Clear sequence and consistent branding                         |
| S05 | Slides   | Six-slide incident review                                     | Timeline and causes remain faithful to the source              |
| S06 | Slides   | Five-slide research summary                                   | Qualifications and source attributions are preserved           |
| S07 | Slides   | Four-slide meeting briefing                                   | Clear decisions and unresolved questions                       |
| S08 | Slides   | Six-slide product walkthrough using reference images          | Images keep their proportions and remain readable              |
| S09 | Slides   | Five-slide quarterly plan                                     | Owners and dates match the approved planning input             |
| S10 | Slides   | Restyle an existing slide screenshot                          | Editable output, readable type, no clipping                    |
| D01 | Document | Two-page project proposal                                     | Purpose, scope, tradeoffs, and open decisions are clear        |
| D02 | Document | Standard operating procedure                                  | Complete ordered procedure; no invented policy                 |
| D03 | Document | Meeting summary with action table                             | Action owners and dates match supplied notes                   |
| D04 | Document | Internal policy summary                                       | Exceptions and qualifications are retained                     |
| D05 | Document | Incident report                                               | Facts are separated from hypotheses                            |
| D06 | Document | Requirements brief                                            | Requirements are testable and source-backed                    |
| D07 | Document | Vendor comparison from supplied facts                         | Consistent table; no fabricated ratings                        |
| D08 | Document | Employee onboarding guide                                     | Clear headings and all required steps                          |
| D09 | Document | Leadership decision memo                                      | Recommendation follows the supplied evidence                   |
| D10 | Document | Research report with tables and an image                      | Accurate content and clean pagination in the native export     |

## Example brief structure

> Task W01. Create a responsive employee service portal for new employees. Use only the following approved service names and descriptions: [paste source facts]. Include a search filter over the service rows and expandable instructions. Use our accent colour [hex] and the attached layout reference. Label any sample data. Do not add real backend integrations.

Revision 1 should test a meaningful content change. Example: “Rename Equipment to Workplace technology and add the supplied service, preserving the other descriptions.”

Revision 2 should test a visual change without collateral changes. Example: “Make the layout easier to read on a narrow screen while preserving every service and its description.”

For slides, include the exact slide count and enough source facts to support the narrative. For documents, specify the audience, purpose, and required sections. The pilot does not ingest source DOCX/PPTX files; paste approved source text into the brief and use images as visual references.

## What to record

- Did the initial output satisfy the brief?
- Did each revision make the requested change while preserving unrelated content?
- Does the downloaded HTML/PPTX/DOCX work and remain editable?
- Are facts, numbers, dates, and attributions accurate?
- Are there clipped, overlapping, missing, or unreadable elements?
- How long did generation, waiting, editing, and cleanup take in total?
- Would the intended user use the artifact for this task?

Mark critical factual or functional errors explicitly. An artifact containing such errors cannot be accepted in the app's evaluation form.

## Decision method

Suggested initial targets are 80% of tasks usable within two revisions and a median total time saving of 30%, with no critical errors in accepted artifacts. These targets are proposals, not claims about GLM performance.

Calculate results by task and format. Do not treat multiple accepted revisions of one project as separate successful tasks. Dashboard percentages are revision-based convenience summaries; the CSV is the source for task-level analysis.

If one format fails the threshold, narrow its scope or improve the workflow and retest on fresh tasks. Do not hide unsuccessful runs, mix demo fixtures into model results, or infer performance for 2,000 concurrent users from a single-user pilot.
