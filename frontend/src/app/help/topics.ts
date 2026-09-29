export type GuideStep = { title: string; text: string };
export type GuideTopic = { title: string; intro: string; steps: GuideStep[] };
export const GUIDE_TOPICS: GuideTopic[] = [
  { title: 'Record', intro: 'Capture your microphone and computer sound together. Tell everyone before recording.', steps: [
    { title: 'Choose your audio devices', text: 'Open New recording, then Audio. Choose the microphone you will speak into and the device playing the call. Refresh the list if you just connected a headset. The sound meters become active when recording starts.' },
    { title: 'Choose the spoken language', text: 'The language here is what people will speak. Detect automatically is useful for mixed languages. Choose a model that supports the language; the model picker explains the available choices.' },
    { title: 'Begin the recording', text: 'Choose Start recording. Check that the microphone and computer-sound meters move when there is sound. The transcript appears as speech is processed; a short delay is normal, especially with a larger model.' },
    { title: 'Pause without ending the meeting', text: 'Pause stops capturing sound. Resume continues the same meeting. The timer and recording controls show whether you are recording or paused.' },
    { title: 'Mark a moment worth returning to', text: 'Choose Highlight when a decision, question or useful detail comes up. The saved moment helps you find that part of the conversation later.' },
    { title: 'Stop and let Tetro finish saving', text: 'Choose Stop. Tetro finishes the remaining transcript and opens the saved meeting. Keep the app open until saving finishes. Save audio in Settings → Recordings controls whether an audio file is kept.' },
  ] },
  { title: 'Import', intro: 'Turn an existing audio or video file into a meeting. Video files use their audio track.', steps: [
    { title: 'Choose a file', text: 'Use the import button beside New recording, or Command/Ctrl + O. Choose a supported file from your computer. The dialog shows its duration and size before you start.' },
    { title: 'Give the meeting a useful name', text: 'Replace the filename with something you will recognize in the meeting list. Advanced options lets you choose the spoken language and transcription model for this import.' },
    { title: 'Import and follow progress', text: 'Choose Import. Tetro finds speech and turns it into text. A longer recording or larger model takes more time. Stop transcribing cancels the job if you need to change your choice.' },
    { title: 'Review the result', text: 'The saved meeting opens when import finishes. Listen to the recording while checking names, numbers and important details. Then write a summary from the transcript.' },
  ] },
  { title: 'Read & correct', intro: 'Your transcript and saved recording stay together. Corrections are saved to the meeting.', steps: [
    { title: 'Listen to the original', text: 'Play starts the saved recording. Use the timeline to seek, the arrow buttons to move ten seconds, or the speed button to change playback speed. A transcript timestamp plays from that point.' },
    { title: 'Correct a line', text: 'Double-click a transcript line or use its pencil button. Fix the text, then Save or press Enter. Shift + Enter adds a new line; Cancel leaves the text as it was.' },
    { title: 'Keep a useful spelling', text: 'After a word correction, Tetro may offer to add it to Names & terms. You can also add terms in Settings → Transcription. Whisper and summary models use these as hints, so still check the output.' },
    { title: 'Try transcription again when needed', text: 'Retranscribe uses the saved audio with another language or model. Your edits and highlighted moments are preserved. Previous versions lets you inspect earlier transcript text.' },
    { title: 'Use the view that fits', text: 'Side by side shows transcript and summary together. Turn it off to read one view at a time. Hide the meeting list for more room, or drag the divider to adjust the two panels.' },
  ] },
  { title: 'Write summaries', intro: 'A template gives the summary its structure; the summary model writes the first draft.', steps: [
    { title: 'Choose the right structure', text: 'Pick a template beside Write summary. General Summary works for anything; Ideas & Notes, Team Meeting and Interview give common recordings a more specific shape. More templates cover focused uses, and you can create your own.' },
    { title: 'Set language and instructions', text: 'Open More for Summary language, Summary model and Instructions. The summary language can differ from the spoken language. Instructions can ask for a particular tone or focus.' },
    { title: 'Write the draft', text: 'Choose Write summary, or Write again for an existing summary. Stop summarizing cancels the current job. A built-in model runs here; a connected provider receives the transcript and instructions.' },
    { title: 'Review and save your edits', text: 'Click in the summary to edit, then choose Save summary. Check decisions, people, dates and amounts against the transcript: a model can miss or invent details. Saved corrections are kept when you write again.' },
    { title: 'Copy or export', text: 'More includes Copy summary, PDF and Markdown. Choose the option with transcript when you want the source text included. PDF opens a print preview; choose Save as PDF in the system print dialog.' },
  ] },
  { title: 'Templates', intro: 'Templates define what summaries should contain. The examples show the layout using fictional content.', steps: [
    { title: 'Explore the built-in templates', text: 'Open Templates and select a recording type. Read its example summary, then expand Template instructions to see what Tetro will ask the model to write.' },
    { title: 'Describe your own template', text: 'Choose New template and describe the recording, what matters, and the sections you want. Draft template uses your selected summary model. Start from scratch opens a blank editor without using a model.' },
    { title: 'Review before saving', text: 'Give the template a clear name. Check each section’s title, instructions and format. You can reorder, add or remove sections. Save when the structure matches what you need.' },
    { title: 'Reuse and share', text: 'Your saved template appears in the template picker on every meeting. Duplicate makes a separate copy. Export saves a JSON template file; Import adds a compatible file someone has shared with you.' },
  ] },
  { title: 'Models & privacy', intro: 'A model is the downloadable component that recognizes speech or writes summaries. These are separate jobs.', steps: [
    { title: 'Choose a transcription model', text: 'In Settings → Models, open Transcription. Choose by spoken language, download size and the description. Smaller models usually need less memory and time; test accuracy with your own audio.' },
    { title: 'Download once, then use locally', text: 'Download and use installs a model and selects it when ready. Cancel keeps the partial file visible: Resume continues the download, and Delete removes it. In use marks the saved choice. Installed models can be selected without downloading again.' },
    { title: 'Choose a summary model separately', text: 'Summary models write summaries, suggest templates and help with meeting names. Disk size is the download size, not the total memory needed while running. If a model is too slow, try a smaller one.' },
    { title: 'Understand connected providers', text: 'External providers need your own account and API key and may charge for use. Transcript text and instructions are sent to the selected provider. A remote Ollama or custom-server address also sends text to that server.' },
  ] },
  { title: 'Action items', intro: 'Assigned tasks from your summaries are collected here so you can follow up across meetings.', steps: [
    { title: 'Find the task you need', text: 'Open Action items. Search by task, meeting, person or due date. Use Anyone and Any date to narrow the list. The meeting heading opens the source meeting.' },
    { title: 'Mark a task done', text: 'Check the box beside a finished task. It moves out of Open and into Done. Choose Done and uncheck it to reopen the task. All shows both states.' },
    { title: 'Correct the task or owner', text: 'The pencil opens Edit task. Change the wording, person or due date, then Save task. These edits stay with the task when the meeting summary is written again.' },
    { title: 'Make due dates unambiguous', text: 'A phrase such as “Friday” is kept as spoken. Set a calendar date in Edit task if you want it included in Overdue. Tetro does not guess which Friday was meant.' },
  ] },
  { title: 'Files & recovery', intro: 'Find recordings, see what takes up space, and recover meetings you removed.', steps: [
    { title: 'Find your audio', text: 'The folder button in a meeting opens its recording folder. Settings → Recordings shows the save location and whether new recordings keep audio. An imported file is copied into Tetro’s recording storage.' },
    { title: 'Check storage before cleaning up', text: 'Settings → Storage separates models, recordings and meeting data. Expand a category to inspect it. Models can be downloaded again; deleting audio can remove playback and retranscription for that meeting.' },
    { title: 'Recover a removed meeting', text: 'Use Trash in the meeting list. Restore returns a removed meeting or its selected parts. Trashed items still take up space while they remain recoverable.' },
    { title: 'Check before permanent deletion', text: 'Delete permanently cannot be undone from Tetro. Read the confirmation and keep any audio or exports you need first. You can cancel and leave the item in Trash.' },
  ] },
];
