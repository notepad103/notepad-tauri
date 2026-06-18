mod ai;
#[path = "../base/mod.rs"]
mod base;
mod pdf_summary;
mod pdf_vector;
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
            let resource_dir = app.path().resource_dir().ok();
            pdf_vector::install_bundled_embedding_models(&app_data_dir, resource_dir.as_deref())?;
            std::env::set_current_dir(app_data_dir)?;
            base::sql::init_db()?;
            pdf_vector::init_pdf_vector_tables()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ai::summarize_webpage,
            ai::summarize_note,
            ai::explain_article_terms,
            ai::explain_article_term_stream,
            ai::generate_term_knowledge_graph,
            ai::get_ai_settings,
            ai::save_deepseek_api_key,
            ai::save_deepseek_model,
            base::sql::add_groups,
            base::sql::export_local_data,
            base::sql::get_db_path,
            base::sql::get_groups,
            base::sql::get_notes,
            base::sql::search_notes,
            base::sql::update_group,
            base::sql::delete_group,
            base::sql::add_notes,
            base::sql::update_notes,
            base::sql::update_note_group,
            base::sql::update_note_pinned,
            base::sql::delete_notes,
            base::sql::get_note_terms,
            base::sql::save_note_terms,
            base::sql::import_pdf_file,
            base::sql::get_pdf_documents,
            base::sql::read_pdf_document_file,
            base::sql::update_pdf_reading_position,
            base::sql::get_pdf_chunks,
            base::sql::save_pdf_chunks,
            base::sql::delete_pdf_chunks,
            base::sql::get_pdf_outline_items,
            base::sql::save_pdf_outline_items,
            base::sql::delete_pdf_outline_items,
            pdf_vector::ensure_pdf_vector_index,
            pdf_vector::get_pdf_vector_index_state,
            pdf_vector::search_pdf_vectors,
            pdf_vector::answer_pdf_vector_search,
            pdf_vector::answer_pdf_vector_search_stream,
            pdf_summary::summarize_pdf_document
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
    Ok(())
}
