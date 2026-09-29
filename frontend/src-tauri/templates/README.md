# Summary Templates

This directory contains the built-in structures used to summarize recordings.

## Available Templates

The picker puts the four everyday choices first:

| File | Name | Use |
| --- | --- | --- |
| `standard_meeting.json` | General Summary | Flexible default for any recording; no required decisions, actions, or tables. |
| `ideas_and_notes.json` | Ideas & Notes | Solo thoughts and brainstorming; ideas remain separate from commitments. |
| `team_meeting.json` | Team Meeting | A one-on-one or small group conversation, without a required business process. |
| `interview.json` | Interview | Answers, examples, a labeled subjective review, and up to two improvement suggestions. STAR applies only to behavioral job interviews. |

More focused choices:

| File | Name | Use |
| --- | --- | --- |
| `daily_standup.json` | Daily Standup | Yesterday, today, and blockers. |
| `plan.json` | Plan & Next Steps | Goals, workstreams, milestones, and next actions. |
| `project_sync.json` | Project Sync / Status Update | Progress, milestones, risks, and decisions. |
| `retrospective.json` | Team Retrospective (Agile) | Start, stop, continue, and improvement actions. |
| `sales_marketing_client_call.json` | Client / Sales Meeting | Client goals, terms, concerns, and follow-up. |
| `podcast_pre_interview.json` | Podcast | Recap a guest or solo episode. |
| `psychatric_session.json` | Therapy Visit | Personal recap of a visit; include diagnoses or medication only if actually discussed. |

Some filenames retain earlier IDs so saved template choices continue to work. Sections without relevant content should be omitted, and no template should invent transcript facts.

## Template Structure

Each template JSON file follows this schema:

```json
{
  "name": "Template Name",
  "description": "Brief description of the template's purpose",
  "sections": [
    {
      "title": "Section Title",
      "instruction": "Instructions for the LLM on what to extract/include",
      "format": "paragraph|list|string",
      "item_format": "Optional: Markdown table format for list items"
    }
  ]
}
```

## Custom Templates

Users can add custom templates to the application data directory:

- **macOS**: `~/Library/Application Support/am.vanalabs.tetro/templates/`
- **Windows and Linux**: the `templates` folder in Tetro's application data directory

Custom templates override built-in templates with the same filename.

## Template Fields

### Root Level
- `name` (required): Display name for the template
- `description` (required): Brief explanation of the template's use case
- `sections` (required): Array of section definitions

### Section Object
- `title` (required): Section heading text
- `instruction` (required): LLM guidance for this section
- `format` (required): One of `"paragraph"`, `"list"`, or `"string"`
- `item_format` (optional): Markdown formatting hint for list items (e.g., table structure)
- `example_item_format` (optional): Alternative formatting hint

## Usage in Code

Templates are loaded using the `templates` module:

```rust
use crate::summary::templates;

// Get a specific template
let template = templates::get_template("daily_standup")?;

// List available templates
let available = templates::list_templates();

// Validate custom template JSON
let custom_json = std::fs::read_to_string("custom.json")?;
let validated = templates::validate_and_parse_template(&custom_json)?;
```
