import type { TemplateSection } from '@/components/tetro/TemplateEditor';

// Fictional examples for previews only. They are never sent to the notes model.
const EXAMPLES: Record<string, string[]> = {
  'summary': ['The team reviewed a small private beta. Maya will prepare the launch checklist by Friday; Daniel will check recording quality tomorrow. The budget is $500, and the next meeting is Monday.'],
  'key decisions': ['Release the private beta after the final tests pass.', 'Keep the project within the $500 budget.'],
  'action items': ['Maya — prepare the launch checklist — Friday.', 'Daniel — review recording quality — tomorrow.'],
  'discussion highlights': ['The group agreed that reliable recording matters more than adding another feature before the beta. The release date depends on the remaining tests.'],
  'date': ['September 25, 2026'],
  'meeting date & time': ['September 25, 2026 · 10:00 AM'],
  'attendees': ['Maya, Daniel and Jo'],
  'attendance': ['Maya, Daniel and Jo'],
  'yesterday': ['Maya finished the import checks.', 'Daniel corrected the export layout.'],
  'today': ['Maya will test a recording from start to finish.', 'Daniel will review the keyboard shortcuts.'],
  'blockers': ['The team needs a second computer to check first-time setup.'],
  'notes': ['The team will compare results at tomorrow’s standup. No additional decisions were made.'],
  'plan overview': ['Prepare a private beta with a clear setup flow, reliable recordings and a short guide. Release after the final checks pass.'],
  'goals & success criteria': ['A new tester can record, find a transcript and write notes without help.', 'All release-blocking checks pass before invitations go out.'],
  'scope, inputs & constraints': ['Scope: recording, transcription, notes and export.', 'Inputs: test recordings and feedback from five beta testers.', 'Constraint: $500 budget; no customer recordings in testing.'],
  'workstreams & deliverables': ['Maya: tested launch checklist.', 'Daniel: recording-quality report.', 'Jo: setup guide and invitation draft.'],
  'workflow graph': ['Record a test → review the transcript → write notes → check the export → review the launch checklist. Any failed check returns to its owner before release.'],
  'timeline & milestones': ['Tomorrow: finish the recording-quality review.', 'Friday: review the launch checklist.', 'Monday: decide whether the beta is ready.'],
  'roles, ownership & handoffs': ['Maya sends the completed checklist to Jo.', 'Daniel reports recording issues to Maya before the final review.'],
  'risks, dependencies & open questions': ['Risk: setup behaves differently on another computer.', 'Dependency: a second device is needed for installation checks.', 'Open question: who will answer beta-test feedback?'],
  'next actions': ['Maya — prepare the checklist — Friday.', 'Daniel — check recording quality — tomorrow.'],
  'milestones & status': ['Import checks: complete.', 'Recording review: in progress.', 'Beta release: waiting for final tests.'],
  'progress summary': ['Import and export checks are complete. The team is now checking recordings and first-time setup.'],
  'top risks & mitigations': ['A clean installation has not been checked yet. Jo will test it on a second computer.'],
  'related documents': ['Launch checklist, revision 2.', 'Recording test results, September 25.'],
  'interview context': ['A 30-minute episode about how a small team built its first community garden. The preparation call focuses on useful stories and questions for new volunteers.'],
  'guest profile and expertise': ['Maya coordinates a volunteer garden with 20 members.', 'She can discuss volunteer schedules and lessons from the first season.'],
  'stories and key talking points': ['How the team found its first planting site.', 'A watering schedule that failed, and what the volunteers changed.'],
  'potential episode angles': ['Starting small: the first month of a volunteer project.', 'Keeping volunteers involved after the initial excitement.'],
  'questions to prepare': ['What surprised you during the first season?', 'What would you do differently with the same budget?'],
  'boundaries and verification points': ['Do not name volunteers without their permission.', 'Confirm the garden’s opening date before recording.'],
  'recording logistics': ['Remote recording on Monday at 10 AM.', 'Allow 15 minutes beforehand for microphone checks.'],
  'open questions': ['Who needs to confirm the remaining details before the next meeting?'],
  'follow-up actions': ['Jo — send the question outline — Friday.', 'Maya — confirm the opening date — before recording.'],
  'sprint': ['Sprint 12 · September 14–25, 2026'],
  'start doing': ['Test a clean installation before the final day of each sprint.'],
  'stop doing': ['Adding new features after the release checklist is agreed.'],
  'continue doing': ['Reviewing real recordings together each week.'],
  'notes & votes': ['The team gave early installation testing three votes and shorter status updates two votes. Maya will try the first change next sprint.'],
  'meeting metadata': ['Client kickoff · September 25, 2026 · 30 minutes'],
  'client goals & success criteria': ['Give the client a searchable record of weekly planning meetings and a clear list of follow-up tasks.'],
  'agreed deliverables': ['A private beta for five testers.', 'A setup guide and a feedback form.'],
  'commercial terms discussed': ['A $500 pilot budget was discussed. Payment terms and a contract were not agreed during this call.'],
  'risks & concerns': ['The client’s second computer has not been tested yet.'],
  'next steps': ['Jo — send the proposed pilot scope — Friday.', 'Client — confirm the five testers — date not stated.'],
  'session metadata': ['Fictional session example · September 25, 2026 · clinician review required'],
  'ai session summary': ['The participant described a difficult week and discussed what they wanted to address in the next session. This example shows the layout; it is not a clinical record.'],
  'subjective (s)': ['The participant said, “I have had a stressful week.” Include only what the participant actually reported.'],
  'objective (o)': ['No objective observations were stated in the example conversation.'],
  'assessment (a)': ['No clinician assessment was stated. Do not infer a diagnosis from the transcript.'],
  'plan (p)': ['The clinician and participant agreed to continue the conversation at the next appointment.'],
  'medications': ['Not discussed in this example.'],
  'diagnoses (dsm/icd)': ['No diagnosis or diagnostic code was stated.'],
  'safety & risk management': ['No safety assessment was documented in the example conversation. The reviewing clinician must verify this section.'],
  'next appointment': ['Date not stated.'],
  'audit trail': ['Draft created from the example conversation. Awaiting clinician review and corrections.'],
};

export function templateExample(section: TemplateSection): string[] {
  const example = EXAMPLES[section.title.trim().toLowerCase()];
  if (example) return example;
  if (/decisions?|agreements?/i.test(section.title)) return EXAMPLES['key decisions'];
  if (/tasks?|actions?|follow.up/i.test(section.title)) return EXAMPLES['action items'];
  if (section.format === 'list') return ['A relevant point from the conversation appears here.', 'Additional points appear as separate bullets.'];
  if (section.format === 'string') return ['A short answer from the conversation.'];
  return ['This section will contain a paragraph based on the conversation and the instructions you gave this template. Details that were not discussed should be left unstated.'];
}
