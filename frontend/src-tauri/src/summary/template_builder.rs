//! Template editor commands: load a full template for editing, save or delete custom
//! templates, and draft a new template from a plain-language description using the
//! user's configured summary model (the same provider and model used for notes).

use crate::state::AppState;
use crate::summary::notes_model::{json_object, NotesModel};
use crate::summary::templates::{self, Template, TemplateSection};
use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};
use tracing::{info, warn};

/// A template with everything the editor needs.
#[derive(Debug, Serialize)]
pub struct EditableTemplate {
    pub id: String,
    pub template: Template,
    /// Saved in the user's templates folder (created here or customized).
    pub is_custom: bool,
    /// A built-in version exists; deleting the custom copy restores it.
    pub has_original: bool,
}

#[derive(Debug, Serialize)]
pub struct TemplateDraft {
    pub template: Template,
    /// Human-readable model label, e.g. "llama3.2 via Ollama".
    pub model_label: String,
}

#[tauri::command]
pub async fn api_get_template_full<R: Runtime>(
    _app: AppHandle<R>,
    template_id: String,
) -> Result<EditableTemplate, String> {
    let template = templates::get_template(&template_id)?;
    Ok(EditableTemplate {
        is_custom: templates::is_custom_template(&template_id),
        has_original: templates::has_original_template(&template_id),
        id: template_id,
        template,
    })
}

/// Saves a template to the custom folder. Without an id, a new id is derived from the name.
#[tauri::command]
pub async fn api_save_custom_template<R: Runtime>(
    _app: AppHandle<R>,
    template_id: Option<String>,
    template: Template,
) -> Result<String, String> {
    let template = normalize_template(template);
    template.validate()?;
    let id = match template_id.filter(|id| !id.trim().is_empty()) {
        Some(id) => id,
        None => templates::unique_template_id(&template.name),
    };
    templates::save_custom_template(&id, &template)?;
    Ok(id)
}

#[tauri::command]
pub async fn api_delete_custom_template<R: Runtime>(
    _app: AppHandle<R>,
    template_id: String,
) -> Result<(), String> {
    templates::delete_custom_template(&template_id)
}

/// Asks for a template .json file, validates it and saves it as a new custom template.
/// Returns the new id, or None when the person cancels.
#[tauri::command]
pub async fn api_import_template<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let Some(file) = app.dialog().file().add_filter("Tetro template", &["json"]).blocking_pick_file() else {
        return Ok(None);
    };
    let path = file.into_path().map_err(|e| e.to_string())?;
    let json = std::fs::read_to_string(&path).map_err(|e| format!("Could not read the file: {}", e))?;
    let template = templates::validate_and_parse_template(&json)
        .map_err(|e| format!("This file isn't a valid template: {}", e))?;
    let mut template = normalize_template(template);
    let existing = templates::list_templates();
    if existing.iter().any(|(_, name, _)| name.eq_ignore_ascii_case(&template.name)) {
        let original_name = template.name.clone();
        let mut copy_number = 2;
        loop {
            let candidate = format!("{} ({})", original_name, copy_number);
            if !existing.iter().any(|(_, name, _)| name.eq_ignore_ascii_case(&candidate)) {
                template.name = candidate;
                break;
            }
            copy_number += 1;
        }
    }
    let id = templates::unique_template_id(&template.name);
    templates::save_custom_template(&id, &template)?;
    Ok(Some(id))
}

/// Saves a template as a .json file wherever the person chooses. Returns false on cancel.
#[tauri::command]
pub async fn api_export_template<R: Runtime>(app: AppHandle<R>, template_id: String) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    let template = templates::get_template(&template_id)?;
    let file_name = format!("{}.json", template.name.replace(['/', '\\', ':'], "-"));
    let Some(file) = app.dialog().file().set_file_name(&file_name).add_filter("Tetro template", &["json"]).blocking_save_file() else {
        return Ok(false);
    };
    let path = file.into_path().map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(&template).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("Could not save the file: {}", e))?;
    Ok(true)
}

const DRAFT_SYSTEM_PROMPT: &str = r#"You design note templates for Tetro, an app that turns meeting transcripts into written notes.
Reply with a single JSON object and nothing else. Use exactly this shape:
{"name": "...", "description": "...", "sections": [{"title": "...", "instruction": "...", "format": "paragraph"}]}

Rules:
- "name": 2-5 words naming the kind of meeting.
- "description": one short sentence saying what the notes are for.
- "sections": 3 to 8 sections, in the order the notes should read.
- "title": 1-4 words, Title Case.
- "instruction": one sentence telling the note writer what to pull from the transcript for this section.
- "format": "list" for several separate items, "paragraph" for a written summary, "string" for one short value such as a date, a name or a single decision.
- Follow any structure the user asks for. Otherwise choose sections that fit the meeting.
- Write names, titles and instructions in the same language as the user's description.
- Do not invent details about a particular meeting; describe what to capture."#;

/// Drafts a template from the user's description with their configured summary model.
#[tauri::command]
pub async fn api_draft_template<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    description: String,
    request_id: String,
) -> Result<TemplateDraft, String> {
    let job = super::draft_jobs::DraftJob::start(request_id)?;
    let description = description.trim();
    if description.chars().count() < 10 {
        return Err("Describe the meeting in a sentence or two so the model has something to work with.".into());
    }

    let model = NotesModel::load(state.db_manager.pool()).await?;
    let app_data_dir = app.path().app_data_dir().ok();

    let user_prompt = format!("Meeting description:\n{}", description);
    let mut last_error = String::new();
    for attempt in 0..2 {
        let prompt = if attempt == 0 {
            user_prompt.clone()
        } else {
            format!("{}\n\nYour previous reply could not be used ({}). Reply with the JSON object only.", user_prompt, last_error)
        };
        let reply = model
            .complete_cancellable(app_data_dir.as_ref(), DRAFT_SYSTEM_PROMPT, &prompt, 1200, Some(&job.token))
            .await
            .map_err(|e| format!("The model could not draft a template: {}", e))?;

        if job.token.is_cancelled() { return Err("Draft cancelled.".into()); }
        match parse_draft(&reply, description) {
            Ok(template) => {
                info!("Drafted template '{}' with {} sections", template.name, template.sections.len());
                return Ok(TemplateDraft { template, model_label: model.label() });
            }
            Err(e) => {
                warn!("Template draft attempt {} unusable: {}", attempt + 1, e);
                last_error = e;
            }
        }
    }
    Err(format!("The model's answer couldn't be turned into a template ({}). Try again, add more detail, or start from scratch.", last_error))
}

/// Extracts the JSON object from a model reply (tolerating code fences and chatter),
/// then cleans it into a valid template.
fn parse_draft(reply: &str, description: &str) -> Result<Template, String> {
    let json = json_object(reply).ok_or("no JSON object")?;
    let mut template: Template = serde_json::from_str(json).map_err(|e| format!("invalid JSON: {}", e))?;
    if template.description.trim().is_empty() {
        template.description = description.chars().take(140).collect();
    }
    if template.name.trim().is_empty() {
        template.name = "New template".into();
    }
    let template = normalize_template(template);
    template.validate()?;
    Ok(template)
}

/// Trims text, maps loose format names onto the three supported ones, drops empty sections.
fn normalize_template(template: Template) -> Template {
    let sections = template
        .sections
        .into_iter()
        .map(|s| TemplateSection {
            title: s.title.trim().to_string(),
            instruction: s.instruction.trim().trim_end_matches('.').to_string(),
            format: match s.format.trim().to_lowercase().as_str() {
                "list" | "bullets" | "bullet" | "bullet list" | "table" | "checklist" => "list",
                "string" | "short" | "one line" | "line" | "text" | "value" => "string",
                _ => "paragraph",
            }
            .to_string(),
            item_format: s.item_format.filter(|f| !f.trim().is_empty()),
            example_item_format: s.example_item_format.filter(|f| !f.trim().is_empty()),
        })
        .filter(|s| !s.title.is_empty() && !s.instruction.is_empty())
        .take(12)
        .collect();
    Template {
        name: template.name.trim().to_string(),
        description: template.description.trim().to_string(),
        sections,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_fenced_reply_and_normalizes_formats() {
        let reply = "Here you go:\n```json\n{\"name\":\" Client Call \",\"description\":\"\",\"sections\":[{\"title\":\"Goals\",\"instruction\":\"What the client wants.\",\"format\":\"Bullets\"},{\"title\":\"Date\",\"instruction\":\"Meeting date\",\"format\":\"short\"},{\"title\":\"\",\"instruction\":\"x\",\"format\":\"list\"}]}\n```";
        let t = parse_draft(reply, "Weekly call with a client about deliverables").unwrap();
        assert_eq!(t.name, "Client Call");
        assert_eq!(t.description, "Weekly call with a client about deliverables");
        assert_eq!(t.sections.len(), 2);
        assert_eq!(t.sections[0].format, "list");
        assert_eq!(t.sections[0].instruction, "What the client wants");
        assert_eq!(t.sections[1].format, "string");
    }

    #[test]
    fn rejects_reply_without_json() {
        assert!(parse_draft("I cannot help with that", "desc").is_err());
    }
}
