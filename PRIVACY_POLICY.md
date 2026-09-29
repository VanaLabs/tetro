# Tetro privacy

Tetro stores meeting recordings, transcripts, summaries, and templates on your
device. You can choose a recordings folder; a folder synced by another app may
also be copied by that app. Deleting a meeting moves it to Tetro's local Trash
until you permanently delete it.

## Local models

Built-in speech and summary models process content on your device. The desktop
app includes Whisper Tiny for transcription. Other models download only when
you choose them, which connects to the model distributor. Tetro does not need
an account to use local models.

## Connected providers

If you select an external summary provider, Tetro sends the transcript text,
template instructions, and any names-and-terms hints needed for that request
to the provider. That provider handles the request under its own terms. A local
Ollama address stays on your device; a remote Ollama address sends content to
that server.

## API keys and permissions

Saved provider API keys are kept in the operating system credential store
(macOS Keychain on Mac), rather than in the settings database. The interface
shows whether a key is saved; it does not read saved keys back into the page.
Newly pasted keys pass through the interface to the native app for saving and
are used to authenticate requests to the provider you select. Remote AI
requests containing transcripts or API keys require HTTPS; local servers
may use HTTP on loopback addresses.

Settings → Permissions lets you check microphone and notification access,
test computer audio, and retry access to saved keys. Keychain may ask you to
authorize Tetro, including after an update. Approving Keychain access does
not require restarting the app.

Recordings and the meeting database are ordinary local files, not separately
encrypted by Tetro. Existing backups may retain data or API keys saved by
older builds.

## Other connections

Tetro does not include usage analytics. It checks GitHub Releases for new
versions at startup and periodically while open. GitHub receives ordinary
connection information such as your IP address. Update checks do not send
recordings, transcripts, or API keys. Updates are downloaded and installed
only when you choose. Model downloads, external providers you select, and links you
choose to open use the internet. Operating-system notification permissions may
be requested for recording and processing notices.

You can review and remove local content through Tetro's Library, Trash,
Templates, Models, and Storage controls. Check your computer's backup or sync
settings for copies outside Tetro's folders.
