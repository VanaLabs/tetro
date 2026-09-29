import type { TemplateSection } from '@/components/tetro/TemplateEditor';

// Fictional examples for previews only. They are never sent to the summary model.
const EXAMPLES: Record<string, string[]> = {
  'summary': ['The team reviewed a small private beta. Maya will prepare the launch checklist by Friday; Daniel will check recording quality tomorrow. The budget is $500, and the next meeting is Monday.'],
  'key points': ['Recording reliability matters most before the beta.', 'The remaining checks need another computer.', 'The team will review readiness on Monday.'],
  'decisions': ['Release the beta only after the remaining checks pass.'],
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
  'additional details': ['The team will compare results at tomorrow’s standup. No additional decisions were made.'],
  'overview': ['I wondered whether a small private beta could show where the new setup flow is confusing. The idea is still exploratory.'],
  'ideas & observations': ['Invite a few people who have never used the app.', 'Watch where setup feels confusing.', 'Keep the first guide short.'],
  'meeting overview': ['Maya and Daniel compared the beta checklist and agreed that recording quality needs one more check before invitations go out.'],
  'discussion': ['Maya wants to test setup on a clean computer.', 'Daniel raised a concern about the recording indicator.', 'Both discussed how to explain export options.'],
  'agreements & open questions': ['Agreed: test a clean installation before invitations.', 'Open: who will answer feedback from beta testers?'],
  'interview summary': ['The conversation focused on how Maya organized volunteers for a community garden and what changed after the first season.'],
  'key answers': ['Maya said the first schedule failed because volunteers could not cover weekday mornings.', 'She described how the team switched to shorter weekend shifts.'],
  'examples & evidence': ['Maya described a two-week trial of weekend shifts and said more volunteers stayed involved afterward.'],
  'interview review': ['Subjective impression: Maya gave a clear situation and described what she did, but the result of the schedule change was only briefly explained.'],
  'improvements for next time': ['Explain the outcome of the schedule change with one concrete detail.', 'Separate the team’s actions from your own contribution when answering.'],
  'follow-ups': ['Jo — send the recording link after the interview.'],
  'plan overview': ['Prepare a private beta with a clear setup flow, reliable recordings and a short guide. Release after the final checks pass.'],
  'goals & success criteria': ['A new tester can record, find a transcript and write a summary without help.', 'All release-blocking checks pass before invitations go out.'],
  'scope, inputs & constraints': ['Scope: recording, transcription, summaries and export.', 'Inputs: test recordings and feedback from five beta testers.', 'Constraint: $500 budget; no customer recordings in testing.'],
  'workstreams & deliverables': ['Maya: tested launch checklist.', 'Daniel: recording-quality report.', 'Jo: setup guide and invitation draft.'],
  'workflow graph': ['Record a test → review the transcript → write a summary → check the export → review the launch checklist. Any failed check returns to its owner before release.'],
  'timeline & milestones': ['Tomorrow: finish the recording-quality review.', 'Friday: review the launch checklist.', 'Monday: decide whether the beta is ready.'],
  'roles, ownership & handoffs': ['Maya sends the completed checklist to Jo.', 'Daniel reports recording issues to Maya before the final review.'],
  'risks, dependencies & open questions': ['Risk: setup behaves differently on another computer.', 'Dependency: a second device is needed for installation checks.', 'Open question: who will answer beta-test feedback?'],
  'next actions': ['Maya — prepare the checklist — Friday.', 'Daniel — check recording quality — tomorrow.'],
  'milestones & status': ['Import checks: complete.', 'Recording review: in progress.', 'Beta release: waiting for final tests.'],
  'progress summary': ['Import and export checks are complete. The team is now checking recordings and first-time setup.'],
  'top risks & mitigations': ['A clean installation has not been checked yet. Jo will test it on a second computer.'],
  'related documents': ['Launch checklist, revision 2.', 'Recording test results, September 25.'],
  'episode overview': ['This episode follows a volunteer group’s first year building a community garden and the changes that helped it keep people involved.'],
  'key themes': ['Starting with a small, workable plan.', 'Learning from a failed volunteer schedule.', 'Keeping newcomers involved.'],
  'stories & examples': ['The first planting day had more volunteers than tools.', 'A weekend-shift trial solved the weekday watering gap.'],
  'takeaways': ['Shorter, predictable shifts made volunteering easier to sustain.'],
  'open questions': ['Who needs to confirm the remaining details before the next meeting?'],
  'follow-up actions': ['Jo — send the question outline — Friday.', 'Maya — confirm the opening date — before recording.'],
  'sprint': ['Sprint 12 · September 14–25, 2026'],
  'start doing': ['Test a clean installation before the final day of each sprint.'],
  'stop doing': ['Adding new features after the release checklist is agreed.'],
  'continue doing': ['Reviewing real recordings together each week.'],
  'notes & votes': ['The team gave early installation testing three votes and shorter status updates two votes. Maya will try the first change next sprint.'],
  'observations & votes': ['The team gave early installation testing three votes and shorter status updates two votes. Maya will try the first change next sprint.'],
  'meeting metadata': ['Client kickoff · September 25, 2026 · 30 minutes'],
  'client goals & success criteria': ['Give the client a searchable record of weekly planning meetings and a clear list of follow-up tasks.'],
  'agreed deliverables': ['A private beta for five testers.', 'A setup guide and a feedback form.'],
  'commercial terms discussed': ['A $500 pilot budget was discussed. Payment terms and a contract were not agreed during this call.'],
  'risks & concerns': ['The client’s second computer has not been tested yet.'],
  'next steps': ['Jo — send the proposed pilot scope — Friday.', 'Client — confirm the five testers — date not stated.'],
  'visit overview': ['I talked about a stressful week and how I have been handling it. We focused on a small change I could try before the next visit.'],
  'what i shared': ['I said that work felt overwhelming on two days this week.', 'I asked why it was hard to stop thinking about work afterward.'],
  'what we discussed': ['We discussed noticing when the workday ends and trying a short transition routine afterward.'],
  'what stood out': ['I said the idea of a clear end-of-day routine felt practical enough to try.'],
  'questions for next visit': ['Would a different routine help on days when work runs late?'],
};

const TEMPLATE_EXAMPLES: Record<string, Record<string, string[]>> = {
  podcast_pre_interview: {
    'follow-ups': ['The host promised to share the resource list mentioned at the end of the episode.'],
  },
  plan: {
    'next steps': ['Maya — prepare the checklist — Friday.', 'Daniel — check recording quality — tomorrow.'],
  },
  psychatric_session: {
    'next steps': ['I said I would try the end-of-day routine before the next visit.'],
  },
};

export function templateExample(section: TemplateSection, templateId?: string): string[] {
  const title = section.title.trim().toLowerCase();
  const example = (templateId && TEMPLATE_EXAMPLES[templateId]?.[title]) || EXAMPLES[title];
  if (example) return example;
  if (/decisions?|agreements?/i.test(section.title)) return EXAMPLES['key decisions'];
  if (/tasks?|actions?|follow.up/i.test(section.title)) return EXAMPLES['action items'];
  if (section.format === 'list') return ['A relevant point from the conversation appears here.', 'Additional points appear as separate bullets.'];
  if (section.format === 'string') return ['A short answer from the conversation.'];
  return ['This section will contain a paragraph based on the conversation and the instructions you gave this template. Details that were not discussed should be left unstated.'];
}
