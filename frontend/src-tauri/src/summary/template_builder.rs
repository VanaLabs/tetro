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
    /// Plain-language explanation when a starter layout replaces an unusable model reply.
    pub notice: Option<String>,
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

const DRAFT_SYSTEM_PROMPT: &str = r#"You design summary templates for Tetro, an app that turns recording transcripts into written summaries.
Reply with a single JSON object and nothing else. Use exactly this shape:
{"name": "...", "description": "...", "sections": [{"title": "...", "instruction": "...", "format": "paragraph"}]}

Rules:
- "name": 2-5 words naming the kind of recording or conversation.
- "description": one short sentence saying what the summary is for.
- "sections": 3 to 8 sections, in the order the summary should read.
- "title": 1-4 words, Title Case.
- "instruction": one sentence telling the summary writer what to pull from the transcript for this section.
- "format": "list" for several separate items, "paragraph" for a written summary, "string" for one short value such as a date, a name or a single decision.
- Follow any structure the user asks for. Otherwise choose sections that fit the recording.
- A short description such as "Catch up with friends" is enough. Choose a useful reusable layout; do not ask follow-up questions.
- Write names, titles and instructions in the same language as the user's description.
- This is a reusable extraction guide, NOT a meeting agenda, sample summary, roleplay, or fictional conversation.
- Never invent people's names, places, activities, or example facts. Use generic headings such as "Life Updates", never headings for imagined individuals.
- Every instruction must describe what to extract IF explicitly mentioned in a future transcript. Do not tell participants to speak or introduce themselves.
- Do not add example content, sample answers, item_format, or example_item_format fields."#;

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
    if description.chars().count() < 3 {
        return Err("Add a few words about the recording, such as ‘Catch up with friends’.".into());
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
            .map_err(|e| {
                warn!("Template draft request failed: {}", e);
                if job.token.is_cancelled() { "Draft cancelled.".to_string() }
                else { "Tetro couldn’t reach your summary model. Try again, check Settings → Models, or start from scratch. Your description is still here.".to_string() }
            })?;

        if job.token.is_cancelled() { return Err("Draft cancelled.".into()); }
        match parse_draft(&reply, description) {
            Ok(template) => {
                info!("Drafted template '{}' with {} sections", template.name, template.sections.len());
                return Ok(TemplateDraft { template, model_label: model.label(), notice: None });
            }
            Err(e) => {
                warn!("Template draft attempt {} unusable: {}", attempt + 1, e);
                last_error = e;
            }
        }
    }
    Ok(starter_draft(description))
}

fn starter_draft(description: &str) -> TemplateDraft {
    TemplateDraft {
        template: Template {
            name: description.chars().take(80).collect(),
            description: description.to_string(),
            sections: [
                ("Summary", "Briefly summarize what was actually said in the transcript", "paragraph"),
                ("Details", "Capture the specific updates or details mentioned in the transcript; use names only when explicitly stated", "list"),
                ("Follow-up", "Include only plans or commitments explicitly agreed in the transcript; omit this section if none were stated", "list"),
            ].into_iter().map(|(title, instruction, format)| TemplateSection {
                title: title.into(), instruction: instruction.into(), format: format.into(), item_format: None, example_item_format: None,
            }).collect(),
        },
        model_label: String::new(),
        notice: Some("Your model couldn’t finish a usable draft, so Tetro prepared a simple starting layout. Review the sections and change anything you like.".into()),
    }
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
    let mut template = normalize_template(template);
    // Generated formatting examples can be mistaken for source facts. Imported
    // and manually edited templates retain these fields; new AI drafts do not.
    for section in &mut template.sections {
        section.item_format = None;
        section.example_item_format = None;
        if has_invented_person(section, description) {
            return Err("Use generic sections, without invented people".into());
        }
    }
    template.validate()?;
    Ok(template)
}

pub(crate) fn has_invented_person(section: &TemplateSection, description: &str) -> bool {
    let description = description.to_lowercase();
    let possessive = regex::Regex::new(r"\b([A-Z][\p{L}]+)['’]s\b").unwrap();
    let text = format!("{} {}", section.title, section.instruction);
    if possessive.captures_iter(&text).any(|c| !description.split(|c: char| !c.is_alphanumeric()).any(|word| word == c[1].to_lowercase())) { return true; }
    // Reject a model-created per-person heading such as "Life Updates - Sarah".
    [" - ", " – ", " — ", ": "].iter().any(|separator| {
        section.title.split_once(separator).is_some_and(|(_, name)| {
            let words: Vec<_> = name.split_whitespace().collect();
            !words.is_empty() && words.len() <= 2 && words.iter().all(|w| w.chars().next().is_some_and(char::is_uppercase))
                && !description.contains(&name.to_lowercase())
        })
    })
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

    #[test]
    fn rejects_fictional_people_but_keeps_names_the_user_requested() {
        let reply = r#"{"name":"Friend Catch-Up","description":"Friends","sections":[{"title":"Life Updates - Sarah","instruction":"Share Sarah's work updates","format":"paragraph"}]}"#;
        assert!(parse_draft(reply, "Catch up with friends").is_err());
        assert!(parse_draft(reply, "Catch up with Sarah").is_ok());
    }

    #[test]
    fn starter_layout_is_valid_and_does_not_claim_to_be_model_generated() {
        let draft = starter_draft("Catch up with friends");
        draft.template.validate().unwrap();
        assert!(draft.model_label.is_empty());
        assert!(draft.notice.unwrap().contains("starting layout"));
        let json = serde_json::to_string(&draft.template).unwrap();
        for invented in ["Sarah", "Mark", "Emily", "Italy"] { assert!(!json.contains(invented)); }
    }

    #[test]
    fn generated_examples_are_not_saved_as_instructions() {
        let reply = r#"{"name":"Catch-Up","description":"Friends","sections":[{"title":"Updates","instruction":"Extract stated updates","format":"list","example_item_format":"Sarah went to Italy"}]}"#;
        assert!(parse_draft(reply, "Catch up with friends").unwrap().sections[0].example_item_format.is_none());
    }

    /// Opt-in smoke test against an already downloaded model; never downloads or
    /// changes model settings. Supply TETRO_MODEL_TEST_DIR and MEETILY_LLAMA_HELPER.
    #[tokio::test]
    #[ignore]
    async fn live_friend_catchup_draft_and_summary() {
        use crate::summary::{llm_client::{generate_summary, LLMProvider}, processor::generate_meeting_summary};
        let dir = std::path::PathBuf::from(std::env::var("TETRO_MODEL_TEST_DIR").expect("Set the model data directory"));
        let client = crate::network_security::client().unwrap();
        let brief = "Catch up with friends";
        let reply = generate_summary(&client, &LLMProvider::BuiltInAI, "qwen3.5:2b", "", DRAFT_SYSTEM_PROMPT, &format!("Meeting description:\n{brief}"), None, None, Some(1200), Some(0.2), None, Some(&dir), None).await.unwrap();
        let draft = parse_draft(&reply.content, brief).expect("Starter model should produce a reusable template for this brief");
        let json = serde_json::to_string_pretty(&draft).unwrap();
        for name in ["Sarah", "Mark", "Emily", "Italy"] { assert!(!json.contains(name), "Invented detail: {name}"); }
        println!("LIVE TEMPLATE:\n{json}");
        let source = "It is good to see you again. We have not spoken for a while, so I wanted to say hello and hear how you are doing. Thanks for calling. I am happy to hear from you too. That is all I wanted to say today.";
        let output = generate_meeting_summary(&client, &LLMProvider::BuiltInAI, "qwen3.5:2b", "", source, "", "friends", &draft, 1748, None, None, Some(800), None, None, Some(&dir), None, Some("en"), Some("en"), None).await.unwrap();
        println!("LIVE SUMMARY:\n{}", output.final_markdown);
        for name in ["Sarah", "Mark", "Emily", "Italy", "project", "travel", "productive"] { assert!(!output.final_markdown.contains(name), "Invented detail: {name}"); }
        assert!(["greet", "hello", "happy", "see"].iter().any(|word| output.final_markdown.to_lowercase().contains(word)), "Must describe the recorded greeting, not just an empty template");
        crate::summary::summary_engine::shutdown_sidecar_gracefully().await.unwrap();
    }
}
