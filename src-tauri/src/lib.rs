mod ai;
#[path = "../base/mod.rs"]
mod base;
mod webpage;

use std::fs;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() -> Result<(), Box<dyn std::error::Error>> {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            fs::create_dir_all(&app_data_dir)?;
            std::env::set_current_dir(app_data_dir)?;
            base::sql::init_db()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ai::summarize_webpage,
            ai::explain_article_terms,
            ai::explain_article_term_stream,
            ai::generate_term_knowledge_graph,
            ai::get_ai_settings,
            ai::save_deepseek_api_key,
            ai::save_deepseek_model,
            base::sql::add_groups,
            base::sql::get_db_path,
            base::sql::get_groups,
            base::sql::get_notes,
            base::sql::update_group,
            base::sql::delete_group,
            base::sql::add_notes,
            base::sql::update_notes,
            base::sql::update_note_group,
            base::sql::update_note_pinned,
            base::sql::delete_notes,
            base::sql::get_note_terms,
            base::sql::save_note_terms
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
    Ok(())
}
