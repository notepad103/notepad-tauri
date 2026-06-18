use crate::ai::{AiClient, AiMessage, StreamEvent};
use crate::base::sql::get_pdf_document;
use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
use rusqlite::{
    ffi::{sqlite3_auto_extension, SQLITE_OK},
    params, Connection, OptionalExtension,
};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::OnceLock;
use tauri::ipc::Channel;

const SQLITE_NAME: &str = "notepad.db";
const DEFAULT_EMBEDDING_MODEL: &str = "BGESmallZHV15";
const EMBEDDING_MODEL_ENV: &str = "NOTE_EMBEDDING_MODEL";
const EMBEDDING_CACHE_DIR: &str = "embedding-models";
const EMBEDDING_BATCH_SIZE: usize = 16;
const DEFAULT_SEARCH_TOP_K: usize = 8;
const MAX_SEARCH_TOP_K: usize = 30;
const AI_CONTEXT_RESULT_LIMIT: usize = 8;
const AI_CONTEXT_CHAR_LIMIT: usize = 16_000;
const AI_CONTEXT_CHUNK_CHAR_LIMIT: usize = 2_400;
const HF_ENDPOINT_ENV: &str = "HF_ENDPOINT";
const FALLBACK_HF_ENDPOINT: &str = "https://hf-mirror.com";
const DEFAULT_USE_HF_MIRROR_ENV: &str = "NOTE_EMBEDDING_USE_HF_MIRROR";
const BUNDLED_EMBEDDING_MODELS_DIR: &str = "resources/embedding-models";

static SQLITE_VEC_REGISTRATION: OnceLock<Result<(), String>> = OnceLock::new();

#[derive(Clone, Serialize)]
pub struct PdfVectorIndexProgress {
    progress: f32,
    message: String,
    current: usize,
    total: usize,
}

#[derive(Serialize)]
pub struct PdfVectorIndexState {
    pdf_document_id: i64,
    status: String,
    chunk_count: usize,
    embedding_count: usize,
    missing_embedding_count: usize,
    model: String,
    dimensions: usize,
    cache_dir: String,
}

#[derive(Serialize)]
pub struct PdfVectorSearchResult {
    chunk_id: i64,
    chunk_index: i64,
    page_start: i64,
    page_end: i64,
    content: String,
    distance: f64,
    score: f64,
}

#[derive(Serialize)]
pub struct PdfVectorAnswer {
    query: String,
    answer: String,
    search_results: Vec<PdfVectorSearchResult>,
}

struct PdfChunkForEmbedding {
    id: i64,
    pdf_document_id: i64,
    chunk_index: i64,
    page_start: i64,
    page_end: i64,
    content: String,
    content_hash: String,
}

struct EmbeddingRuntime {
    model_name: String,
    dimensions: usize,
    model: TextEmbedding,
}

pub fn install_bundled_embedding_models(
    app_data_dir: &Path,
    resource_dir: Option<&Path>,
) -> Result<(), String> {
    let target_dir = app_data_dir.join(EMBEDDING_CACHE_DIR);
    for source_dir in bundled_embedding_model_dirs(resource_dir) {
        if source_dir.is_dir() {
            copy_dir_contents(&source_dir, &target_dir)?;
        }
    }
    Ok(())
}

pub fn init_pdf_vector_tables() -> Result<(), String> {
    let conn = open_db()?;
    let model = current_embedding_model()?;
    let dimensions = embedding_dimensions(&model)?;
    conn.execute(
        r#"
        CREATE TABLE IF NOT EXISTS pdf_chunk_embeddings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pdf_chunk_id INTEGER NOT NULL,
            pdf_document_id INTEGER NOT NULL,
            model TEXT NOT NULL,
            dimensions INTEGER NOT NULL,
            embedding BLOB NOT NULL,
            content_hash TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER,
            FOREIGN KEY(pdf_chunk_id) REFERENCES pdf_chunks(id),
            FOREIGN KEY(pdf_document_id) REFERENCES pdf_documents(id)
        )
        "#,
        [],
    )
    .map_err(|err| err.to_string())?;
    conn.execute(
        r#"
        CREATE UNIQUE INDEX IF NOT EXISTS idx_pdf_chunk_embeddings_chunk_model
        ON pdf_chunk_embeddings(pdf_chunk_id, model)
        "#,
        [],
    )
    .map_err(|err| err.to_string())?;
    conn.execute(
        r#"
        CREATE INDEX IF NOT EXISTS idx_pdf_chunk_embeddings_doc_model
        ON pdf_chunk_embeddings(pdf_document_id, model)
        "#,
        [],
    )
    .map_err(|err| err.to_string())?;
    ensure_vec_table(&conn, dimensions)?;
    Ok(())
}

#[tauri::command]
pub async fn ensure_pdf_vector_index(
    pdf_document_id: i64,
    progress: Channel<PdfVectorIndexProgress>,
) -> Result<PdfVectorIndexState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_pdf_vector_index_blocking(pdf_document_id, progress)
    })
    .await
    .map_err(|err| format!("向量索引任务失败：{err}"))?
}

#[tauri::command]
pub fn get_pdf_vector_index_state(pdf_document_id: i64) -> Result<PdfVectorIndexState, String> {
    init_pdf_vector_tables()?;
    let model = current_embedding_model()?;
    let model_name = stable_model_name(&model);
    let dimensions = embedding_dimensions(&model)?;
    read_index_state(pdf_document_id, &model_name, dimensions)
}

#[tauri::command]
pub async fn search_pdf_vectors(
    pdf_document_id: i64,
    query: String,
    top_k: Option<usize>,
) -> Result<Vec<PdfVectorSearchResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        search_pdf_vectors_blocking(pdf_document_id, query, top_k)
    })
    .await
    .map_err(|err| format!("向量搜索任务失败：{err}"))?
}

#[tauri::command]
pub async fn answer_pdf_vector_search(
    pdf_document_id: i64,
    query: String,
    top_k: Option<usize>,
) -> Result<PdfVectorAnswer, String> {
    let clean_query = query.trim().to_string();
    if clean_query.is_empty() {
        return Err("请输入搜索内容".to_string());
    }

    let search_query = clean_query.clone();
    let search_results = tauri::async_runtime::spawn_blocking(move || {
        search_pdf_vectors_blocking(pdf_document_id, search_query, top_k)
    })
    .await
    .map_err(|err| format!("向量搜索任务失败：{err}"))??;

    if search_results.is_empty() {
        return Ok(PdfVectorAnswer {
            query: clean_query,
            answer: "没有召回到足够相关的 PDF 片段，暂时无法基于文档回答。".to_string(),
            search_results,
        });
    }

    let document = get_pdf_document(pdf_document_id)?;
    let prompt = build_vector_answer_prompt(&document.name, &clean_query, &search_results);
    let answer = match AiClient::new() {
        Ok(client) => client
            .chat_text(
                vec![
                    AiMessage::system(
                        "你是一个严谨的中文 PDF 检索问答助手。只能依据用户提供的召回片段回答，不要编造文档里没有的信息。",
                    ),
                    AiMessage::user(prompt),
                ],
                0.2,
            )
            .await
            .unwrap_or_else(|err| format!("AI 回答生成失败：{err}")),
        Err(err) => format!("AI 回答生成失败：{err}"),
    };

    Ok(PdfVectorAnswer {
        query: clean_query,
        answer,
        search_results,
    })
}

#[tauri::command]
pub async fn answer_pdf_vector_search_stream(
    pdf_document_id: i64,
    query: String,
    top_k: Option<usize>,
    channel: Channel<StreamEvent>,
) -> Result<(), String> {
    let clean_query = query.trim().to_string();
    if clean_query.is_empty() {
        let err = "请输入搜索内容".to_string();
        let _ = channel.send(StreamEvent::Error(err.clone()));
        return Err(err);
    }

    let search_query = clean_query.clone();
    let search_results = tauri::async_runtime::spawn_blocking(move || {
        search_pdf_vectors_blocking(pdf_document_id, search_query, top_k)
    })
    .await
    .map_err(|err| format!("向量搜索任务失败：{err}"))??;

    if search_results.is_empty() {
        channel
            .send(StreamEvent::Delta(
                "没有召回到足够相关的 PDF 片段，暂时无法基于文档回答。".to_string(),
            ))
            .map_err(|err| err.to_string())?;
        channel
            .send(StreamEvent::Done)
            .map_err(|err| err.to_string())?;
        return Ok(());
    }

    let document = get_pdf_document(pdf_document_id)?;
    let prompt = build_vector_answer_prompt(&document.name, &clean_query, &search_results);
    let error_channel = channel.clone();
    let client = match AiClient::new() {
        Ok(client) => client,
        Err(err) => {
            let _ = error_channel.send(StreamEvent::Error(err.clone()));
            return Err(err);
        }
    };
    match client
        .chat_text_stream(
            vec![
                AiMessage::system(
                    "你是一个严谨的中文 PDF 检索问答助手。只能依据用户提供的召回片段回答，不要编造文档里没有的信息。",
                ),
                AiMessage::user(prompt),
            ],
            0.2,
            channel,
        )
        .await
    {
        Ok(()) => Ok(()),
        Err(err) => {
            let _ = error_channel.send(StreamEvent::Error(err.clone()));
            Err(err)
        }
    }
}

fn ensure_pdf_vector_index_blocking(
    pdf_document_id: i64,
    progress: Channel<PdfVectorIndexProgress>,
) -> Result<PdfVectorIndexState, String> {
    init_pdf_vector_tables()?;
    send_progress(&progress, 0.0, "检查 PDF 文本切片", 0, 0);

    let model = current_embedding_model()?;
    let model_name = stable_model_name(&model);
    let dimensions = embedding_dimensions(&model)?;
    let chunk_count = count_pdf_chunks(pdf_document_id)?;
    if chunk_count == 0 {
        send_progress(&progress, 100.0, "PDF 尚未生成文本切片", 0, 0);
        return Ok(PdfVectorIndexState {
            pdf_document_id,
            status: "empty".to_string(),
            chunk_count: 0,
            embedding_count: 0,
            missing_embedding_count: 0,
            model: model_name,
            dimensions,
            cache_dir: embedding_cache_dir()?.to_string_lossy().into_owned(),
        });
    }

    cleanup_orphan_embeddings(pdf_document_id)?;
    let stale_chunks = chunks_missing_embeddings(pdf_document_id, &model_name, dimensions)?;
    if stale_chunks.is_empty() {
        send_progress(
            &progress,
            100.0,
            "PDF 向量索引已就绪",
            chunk_count,
            chunk_count,
        );
        return read_index_state(pdf_document_id, &model_name, dimensions);
    }

    send_progress(
        &progress,
        8.0,
        format!("下载或加载 embedding 模型：{model_name}"),
        0,
        stale_chunks.len(),
    );
    let mut runtime = EmbeddingRuntime::new(model)?;
    send_progress(
        &progress,
        12.0,
        format!("模型已就绪：{model_name}"),
        0,
        stale_chunks.len(),
    );

    let total = stale_chunks.len();
    let mut completed = 0usize;
    for batch in stale_chunks.chunks(EMBEDDING_BATCH_SIZE) {
        let inputs = batch
            .iter()
            .map(build_embedding_input)
            .collect::<Vec<String>>();
        let embeddings = runtime.embed(inputs)?;
        save_chunk_embeddings(batch, &runtime.model_name, runtime.dimensions, embeddings)?;
        completed += batch.len();

        let progress_value = 12.0 + (completed as f32 / total as f32) * 86.0;
        send_progress(
            &progress,
            progress_value,
            format!("生成向量 {completed}/{total}"),
            completed,
            total,
        );
    }

    send_progress(&progress, 100.0, "PDF 向量索引完成", total, total);
    read_index_state(pdf_document_id, &runtime.model_name, runtime.dimensions)
}

impl EmbeddingRuntime {
    fn new(model: EmbeddingModel) -> Result<Self, String> {
        let model_name = stable_model_name(&model);
        let dimensions = embedding_dimensions(&model)?;
        let cache_dir = embedding_cache_dir()?;
        std::fs::create_dir_all(&cache_dir)
            .map_err(|err| format!("创建 embedding 模型缓存目录失败：{err}"))?;

        configure_hf_endpoint();
        let options = InitOptions::new(model)
            .with_cache_dir(cache_dir.clone())
            .with_show_download_progress(false)
            .with_intra_threads(2);

        let model = match TextEmbedding::try_new(options.clone()) {
            Ok(model) => model,
            Err(primary_err) => {
                if std::env::var(HF_ENDPOINT_ENV).is_ok() {
                    return Err(format!(
                        "初始化 fastembed 模型失败：{primary_err}\n模型：{model_name}\n缓存目录：{}\n当前 {HF_ENDPOINT_ENV} 已配置，请检查该地址是否可访问。",
                        cache_dir.to_string_lossy()
                    ));
                }

                std::env::set_var(HF_ENDPOINT_ENV, FALLBACK_HF_ENDPOINT);
                TextEmbedding::try_new(options).map_err(|fallback_err| {
                    format!(
                        "初始化 fastembed 模型失败：{primary_err}\n已自动切换 {HF_ENDPOINT_ENV}={FALLBACK_HF_ENDPOINT} 重试，但仍失败：{fallback_err}\n模型：{model_name}\n缓存目录：{}",
                        cache_dir.to_string_lossy()
                    )
                })?
            }
        };

        Ok(Self {
            model_name,
            dimensions,
            model,
        })
    }

    fn embed(&mut self, inputs: Vec<String>) -> Result<Vec<Vec<f32>>, String> {
        let embeddings = self
            .model
            .embed(inputs, Some(EMBEDDING_BATCH_SIZE))
            .map_err(|err| format!("生成 embedding 失败：{err}"))?;

        embeddings
            .into_iter()
            .map(|mut vector| {
                validate_embedding(&vector, self.dimensions)?;
                normalize_embedding(&mut vector);
                Ok(vector)
            })
            .collect()
    }
}

fn configure_hf_endpoint() {
    if std::env::var(HF_ENDPOINT_ENV).is_ok() {
        return;
    }

    let use_mirror = std::env::var(DEFAULT_USE_HF_MIRROR_ENV)
        .map(|value| value.trim() != "0" && !value.eq_ignore_ascii_case("false"))
        .unwrap_or(true);
    if use_mirror {
        std::env::set_var(HF_ENDPOINT_ENV, FALLBACK_HF_ENDPOINT);
    }
}

fn open_db() -> Result<Connection, String> {
    register_sqlite_vec_extension()?;
    Connection::open(SQLITE_NAME).map_err(|err| err.to_string())
}

fn register_sqlite_vec_extension() -> Result<(), String> {
    SQLITE_VEC_REGISTRATION
        .get_or_init(|| {
            let code = unsafe {
                sqlite3_auto_extension(Some(std::mem::transmute(
                    sqlite_vec::sqlite3_vec_init as *const (),
                )))
            };
            if code == SQLITE_OK {
                Ok(())
            } else {
                Err(format!("注册 sqlite-vec 扩展失败：SQLite code {code}"))
            }
        })
        .clone()
}

fn embedding_cache_dir() -> Result<PathBuf, String> {
    std::env::current_dir()
        .map(|dir| dir.join(EMBEDDING_CACHE_DIR))
        .map_err(|err| err.to_string())
}

fn bundled_embedding_model_dirs(resource_dir: Option<&Path>) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(resource_dir) = resource_dir {
        dirs.push(resource_dir.join(BUNDLED_EMBEDDING_MODELS_DIR));
        dirs.push(resource_dir.join(EMBEDDING_CACHE_DIR));
    }
    if let Some(manifest_dir) = option_env!("CARGO_MANIFEST_DIR") {
        dirs.push(PathBuf::from(manifest_dir).join(BUNDLED_EMBEDDING_MODELS_DIR));
    }
    dirs
}

fn copy_dir_contents(source: &Path, target: &Path) -> Result<(), String> {
    std::fs::create_dir_all(target).map_err(|err| {
        format!(
            "创建 embedding 模型缓存目录失败：{}：{err}",
            target.to_string_lossy()
        )
    })?;

    for entry in std::fs::read_dir(source).map_err(|err| {
        format!(
            "读取内置 embedding 模型目录失败：{}：{err}",
            source.to_string_lossy()
        )
    })? {
        let entry = entry.map_err(|err| err.to_string())?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        let metadata = std::fs::metadata(&source_path).map_err(|err| {
            format!(
                "读取内置 embedding 模型文件失败：{}：{err}",
                source_path.to_string_lossy()
            )
        })?;

        if metadata.is_dir() {
            copy_dir_contents(&source_path, &target_path)?;
            continue;
        }

        if !metadata.is_file() {
            continue;
        }

        let should_copy = match std::fs::metadata(&target_path) {
            Ok(target_metadata) => target_metadata.len() != metadata.len(),
            Err(_) => true,
        };
        if should_copy {
            if let Some(parent) = target_path.parent() {
                std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
            }
            std::fs::copy(&source_path, &target_path).map_err(|err| {
                format!(
                    "复制内置 embedding 模型文件失败：{} -> {}：{err}",
                    source_path.to_string_lossy(),
                    target_path.to_string_lossy()
                )
            })?;
        }
    }

    Ok(())
}

fn current_embedding_model() -> Result<EmbeddingModel, String> {
    let configured =
        std::env::var(EMBEDDING_MODEL_ENV).unwrap_or_else(|_| DEFAULT_EMBEDDING_MODEL.to_string());
    EmbeddingModel::from_str(&configured).map_err(|err| {
        format!(
            "不支持的 embedding 模型：{configured}。请使用 fastembed 的模型枚举名，例如 {DEFAULT_EMBEDDING_MODEL}。原始错误：{err}"
        )
    })
}

fn stable_model_name(model: &EmbeddingModel) -> String {
    format!("fastembed:{model:?}")
}

fn embedding_dimensions(model: &EmbeddingModel) -> Result<usize, String> {
    TextEmbedding::get_model_info(model)
        .map(|info| info.dim)
        .map_err(|err| format!("读取 embedding 模型信息失败：{err}"))
}

fn vec_table_name(dimensions: usize) -> String {
    format!("pdf_chunk_embedding_vec_{dimensions}")
}

fn ensure_vec_table(conn: &Connection, dimensions: usize) -> Result<(), String> {
    let table_name = vec_table_name(dimensions);
    let sql = format!(
        r#"
        CREATE VIRTUAL TABLE IF NOT EXISTS {table_name}
        USING vec0(
            embedding float[{dimensions}],
            pdf_document_id integer partition key,
            model text,
            content_hash text
        )
        "#
    );
    conn.execute(&sql, [])
        .map(|_| ())
        .map_err(|err| format!("初始化 sqlite-vec 向量表失败：{err}。表：{table_name}"))
}

fn ensure_vec_table_in_tx(tx: &rusqlite::Transaction<'_>, dimensions: usize) -> Result<(), String> {
    let table_name = vec_table_name(dimensions);
    let sql = format!(
        r#"
        CREATE VIRTUAL TABLE IF NOT EXISTS {table_name}
        USING vec0(
            embedding float[{dimensions}],
            pdf_document_id integer partition key,
            model text,
            content_hash text
        )
        "#
    );
    tx.execute(&sql, [])
        .map(|_| ())
        .map_err(|err| format!("初始化 sqlite-vec 向量表失败：{err}。表：{table_name}"))
}

fn send_progress(
    channel: &Channel<PdfVectorIndexProgress>,
    progress: f32,
    message: impl Into<String>,
    current: usize,
    total: usize,
) {
    let _ = channel.send(PdfVectorIndexProgress {
        progress: progress.clamp(0.0, 100.0),
        message: message.into(),
        current,
        total,
    });
}

fn count_pdf_chunks(pdf_document_id: i64) -> Result<usize, String> {
    let conn = open_db()?;
    conn.query_row(
        "SELECT COUNT(*) FROM pdf_chunks WHERE pdf_document_id = ?1",
        [pdf_document_id],
        |row| row.get::<_, i64>(0),
    )
    .map(|count| count.max(0) as usize)
    .map_err(|err| err.to_string())
}

fn cleanup_orphan_embeddings(pdf_document_id: i64) -> Result<(), String> {
    let conn = open_db()?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT e.id, e.dimensions
            FROM pdf_chunk_embeddings e
            WHERE e.pdf_document_id = ?1
              AND NOT EXISTS (
                  SELECT 1
                  FROM pdf_chunks
                  WHERE pdf_chunks.id = e.pdf_chunk_id
              )
            "#,
        )
        .map_err(|err| err.to_string())?;
    let orphan_rows = stmt
        .query_map([pdf_document_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|err| err.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())?;
    drop(stmt);

    for (embedding_id, dimensions) in orphan_rows {
        if dimensions > 0 {
            ensure_vec_table(&conn, dimensions as usize)?;
            delete_vec_row(&conn, dimensions as usize, embedding_id)?;
        }
    }

    conn.execute(
        r#"
        DELETE FROM pdf_chunk_embeddings
        WHERE pdf_document_id = ?1
          AND NOT EXISTS (
              SELECT 1
              FROM pdf_chunks
              WHERE pdf_chunks.id = pdf_chunk_embeddings.pdf_chunk_id
          )
        "#,
        [pdf_document_id],
    )
    .map(|_| ())
    .map_err(|err| err.to_string())
}

fn chunks_missing_embeddings(
    pdf_document_id: i64,
    model: &str,
    dimensions: usize,
) -> Result<Vec<PdfChunkForEmbedding>, String> {
    let conn = open_db()?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT c.id, c.pdf_document_id, c.chunk_index, c.page_start, c.page_end,
                   c.content, c.content_hash
            FROM pdf_chunks c
            LEFT JOIN pdf_chunk_embeddings e
              ON e.pdf_chunk_id = c.id
             AND e.model = ?2
            WHERE c.pdf_document_id = ?1
              AND (
                    e.id IS NULL
                 OR e.content_hash != c.content_hash
                 OR e.dimensions != ?3
              )
            ORDER BY c.chunk_index, c.id
            "#,
        )
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map((pdf_document_id, model, dimensions as i64), |row| {
            Ok(PdfChunkForEmbedding {
                id: row.get(0)?,
                pdf_document_id: row.get(1)?,
                chunk_index: row.get(2)?,
                page_start: row.get(3)?,
                page_end: row.get(4)?,
                content: row.get(5)?,
                content_hash: row.get(6)?,
            })
        })
        .map_err(|err| err.to_string())?;

    rows.map(|row| row.map_err(|err| err.to_string())).collect()
}

fn build_embedding_input(chunk: &PdfChunkForEmbedding) -> String {
    format!(
        "passage: 页码：第 {}-{} 页\n切片：{}\n\n{}",
        chunk.page_start,
        chunk.page_end,
        chunk.chunk_index + 1,
        chunk.content.trim()
    )
}

fn char_count(text: &str) -> usize {
    text.chars().count()
}

fn truncate_chars(text: &str, limit: usize) -> String {
    let mut chars = text.chars();
    let truncated = chars.by_ref().take(limit).collect::<String>();
    if chars.next().is_some() {
        format!("{}\n\n[片段过长，已截断]", truncated.trim())
    } else {
        truncated
    }
}

fn build_vector_answer_prompt(
    document_name: &str,
    query: &str,
    results: &[PdfVectorSearchResult],
) -> String {
    let mut used_chars = 0usize;
    let mut passages = Vec::new();

    for (index, result) in results.iter().take(AI_CONTEXT_RESULT_LIMIT).enumerate() {
        if used_chars >= AI_CONTEXT_CHAR_LIMIT {
            break;
        }

        let remaining = AI_CONTEXT_CHAR_LIMIT - used_chars;
        let content_limit = remaining.min(AI_CONTEXT_CHUNK_CHAR_LIMIT);
        let content = truncate_chars(result.content.trim(), content_limit);
        used_chars += char_count(&content);
        let page_label = if result.page_start == result.page_end {
            format!("第 {} 页", result.page_start)
        } else {
            format!("第 {}-{} 页", result.page_start, result.page_end)
        };
        passages.push(format!(
            "### 片段 {}\n- 页码：{}\n- 相似度：{:.0}%\n- 内容：\n{}",
            index + 1,
            page_label,
            result.score * 100.0,
            content
        ));
    }

    format!(
        "请根据 PDF 语义搜索召回片段回答用户问题。\n\n# PDF\n{}\n\n# 用户问题\n{}\n\n# 召回片段\n{}\n\n# 输出要求\n使用中文 Markdown；只依据召回片段，不要使用外部知识补全；如果证据不足，直接说明“召回片段不足以确认”；回答要先给结论，再列依据；每条关键依据都带页码，例如“第 3-4 页”；不要输出 JSON。\n\n建议结构：\n## 回答\n## 依据\n## 仍不确定的地方",
        document_name,
        query,
        passages.join("\n\n")
    )
}

fn save_chunk_embeddings(
    chunks: &[PdfChunkForEmbedding],
    model: &str,
    dimensions: usize,
    embeddings: Vec<Vec<f32>>,
) -> Result<(), String> {
    if chunks.len() != embeddings.len() {
        return Err(format!(
            "embedding 数量不一致：输入 {} 条，输出 {} 条",
            chunks.len(),
            embeddings.len()
        ));
    }

    let mut conn = open_db()?;
    ensure_vec_table(&conn, dimensions)?;
    let tx = conn.transaction().map_err(|err| err.to_string())?;
    ensure_vec_table_in_tx(&tx, dimensions)?;
    for (chunk, embedding) in chunks.iter().zip(embeddings.iter()) {
        let blob = embedding_to_blob(embedding);
        if let Some((embedding_id, old_dimensions)) = tx
            .query_row(
                r#"
                SELECT id, dimensions
                FROM pdf_chunk_embeddings
                WHERE pdf_chunk_id = ?1
                  AND model = ?2
                "#,
                params![chunk.id, model],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()
            .map_err(|err| err.to_string())?
        {
            if old_dimensions > 0 && old_dimensions as usize != dimensions {
                ensure_vec_table_in_tx(&tx, old_dimensions as usize)?;
                delete_vec_row_in_tx(&tx, old_dimensions as usize, embedding_id)?;
            }
        }

        let embedding_id = tx
            .query_row(
                r#"
            INSERT INTO pdf_chunk_embeddings (
                pdf_chunk_id,
                pdf_document_id,
                model,
                dimensions,
                embedding,
                content_hash,
                created_at,
                updated_at
            ) VALUES (
                ?1,
                ?2,
                ?3,
                ?4,
                ?5,
                ?6,
                strftime('%s', 'now'),
                strftime('%s', 'now')
            )
            ON CONFLICT(pdf_chunk_id, model)
            DO UPDATE SET
                pdf_document_id = excluded.pdf_document_id,
                dimensions = excluded.dimensions,
                embedding = excluded.embedding,
                content_hash = excluded.content_hash,
                updated_at = strftime('%s', 'now')
            RETURNING id
            "#,
                params![
                    chunk.id,
                    chunk.pdf_document_id,
                    model,
                    dimensions as i64,
                    blob,
                    &chunk.content_hash,
                ],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|err| err.to_string())?;

        upsert_vec_row_in_tx(
            &tx,
            dimensions,
            embedding_id,
            &embedding_to_blob(embedding),
            chunk.pdf_document_id,
            model,
            &chunk.content_hash,
        )?;
    }
    tx.commit().map_err(|err| err.to_string())
}

fn upsert_vec_row_in_tx(
    tx: &rusqlite::Transaction<'_>,
    dimensions: usize,
    rowid: i64,
    embedding: &[u8],
    pdf_document_id: i64,
    model: &str,
    content_hash: &str,
) -> Result<(), String> {
    let table_name = vec_table_name(dimensions);
    let sql = format!(
        r#"
        INSERT OR REPLACE INTO {table_name} (
            rowid,
            embedding,
            pdf_document_id,
            model,
            content_hash
        ) VALUES (
            ?1,
            ?2,
            ?3,
            ?4,
            ?5
        )
        "#
    );
    tx.execute(
        &sql,
        params![rowid, embedding, pdf_document_id, model, content_hash],
    )
    .map(|_| ())
    .map_err(|err| format!("写入 sqlite-vec 向量失败：{err}"))
}

fn delete_vec_row(conn: &Connection, dimensions: usize, rowid: i64) -> Result<(), String> {
    let table_name = vec_table_name(dimensions);
    let sql = format!("DELETE FROM {table_name} WHERE rowid = ?1");
    conn.execute(&sql, [rowid])
        .map(|_| ())
        .map_err(|err| format!("删除 sqlite-vec 向量失败：{err}"))
}

fn delete_vec_row_in_tx(
    tx: &rusqlite::Transaction<'_>,
    dimensions: usize,
    rowid: i64,
) -> Result<(), String> {
    let table_name = vec_table_name(dimensions);
    let sql = format!("DELETE FROM {table_name} WHERE rowid = ?1");
    tx.execute(&sql, [rowid])
        .map(|_| ())
        .map_err(|err| format!("删除 sqlite-vec 向量失败：{err}"))
}

fn search_pdf_vectors_blocking(
    pdf_document_id: i64,
    query: String,
    top_k: Option<usize>,
) -> Result<Vec<PdfVectorSearchResult>, String> {
    init_pdf_vector_tables()?;
    let clean_query = query.trim();
    if clean_query.is_empty() {
        return Err("请输入搜索内容".to_string());
    }

    let model = current_embedding_model()?;
    let model_name = stable_model_name(&model);
    let dimensions = embedding_dimensions(&model)?;
    let state = read_index_state(pdf_document_id, &model_name, dimensions)?;
    if state.status != "ready" {
        return Err("PDF 向量索引尚未就绪，请先生成向量索引".to_string());
    }

    let mut runtime = EmbeddingRuntime::new(model)?;
    let mut embeddings = runtime.embed(vec![format!("query: {clean_query}")])?;
    let query_embedding = embeddings
        .pop()
        .ok_or_else(|| "生成 query embedding 失败".to_string())?;
    let query_blob = embedding_to_blob(&query_embedding);
    let top_k = top_k
        .unwrap_or(DEFAULT_SEARCH_TOP_K)
        .clamp(1, MAX_SEARCH_TOP_K);

    let conn = open_db()?;
    ensure_vec_table(&conn, dimensions)?;
    let table_name = vec_table_name(dimensions);
    let sql = format!(
        r#"
        SELECT
            c.id,
            c.chunk_index,
            c.page_start,
            c.page_end,
            c.content,
            v.distance
        FROM {table_name} v
        JOIN pdf_chunk_embeddings e ON e.id = v.rowid
        JOIN pdf_chunks c ON c.id = e.pdf_chunk_id
        WHERE v.embedding MATCH ?1
          AND k = ?2
          AND v.pdf_document_id = ?3
          AND v.model = ?4
          AND v.content_hash = e.content_hash
          AND e.content_hash = c.content_hash
        ORDER BY v.distance
        LIMIT ?2
        "#
    );
    let mut stmt = conn.prepare(&sql).map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map(
            params![query_blob, top_k as i64, pdf_document_id, model_name],
            |row| {
                let distance = row.get::<_, f64>(5)?;
                Ok(PdfVectorSearchResult {
                    chunk_id: row.get(0)?,
                    chunk_index: row.get(1)?,
                    page_start: row.get(2)?,
                    page_end: row.get(3)?,
                    content: row.get(4)?,
                    distance,
                    score: distance_to_score(distance),
                })
            },
        )
        .map_err(|err| err.to_string())?;

    rows.map(|row| row.map_err(|err| err.to_string())).collect()
}

fn distance_to_score(distance: f64) -> f64 {
    (1.0 - (distance * distance / 2.0)).clamp(-1.0, 1.0)
}

fn read_index_state(
    pdf_document_id: i64,
    model: &str,
    dimensions: usize,
) -> Result<PdfVectorIndexState, String> {
    let conn = open_db()?;
    let chunk_count = conn
        .query_row(
            "SELECT COUNT(*) FROM pdf_chunks WHERE pdf_document_id = ?1",
            [pdf_document_id],
            |row| row.get::<_, i64>(0),
        )
        .map(|count| count.max(0) as usize)
        .map_err(|err| err.to_string())?;
    let embedding_count = conn
        .query_row(
            r#"
            SELECT COUNT(*)
            FROM pdf_chunk_embeddings e
            JOIN pdf_chunks c ON c.id = e.pdf_chunk_id
            WHERE e.pdf_document_id = ?1
              AND e.model = ?2
              AND e.dimensions = ?3
              AND e.content_hash = c.content_hash
            "#,
            (pdf_document_id, model, dimensions as i64),
            |row| row.get::<_, i64>(0),
        )
        .map(|count| count.max(0) as usize)
        .map_err(|err| err.to_string())?;
    let missing_embedding_count = chunk_count.saturating_sub(embedding_count);
    let status = if chunk_count == 0 {
        "empty"
    } else if missing_embedding_count == 0 {
        "ready"
    } else {
        "partial"
    };

    Ok(PdfVectorIndexState {
        pdf_document_id,
        status: status.to_string(),
        chunk_count,
        embedding_count,
        missing_embedding_count,
        model: model.to_string(),
        dimensions,
        cache_dir: embedding_cache_dir()?.to_string_lossy().into_owned(),
    })
}

fn validate_embedding(vector: &[f32], dimensions: usize) -> Result<(), String> {
    if vector.len() != dimensions {
        return Err(format!(
            "embedding 维度不一致：期望 {}，实际 {}",
            dimensions,
            vector.len()
        ));
    }
    if vector.iter().any(|value| !value.is_finite()) {
        return Err("embedding 包含非法数值".to_string());
    }
    Ok(())
}

fn normalize_embedding(vector: &mut [f32]) {
    let norm = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
    if norm <= f32::EPSILON {
        return;
    }
    for value in vector {
        *value /= norm;
    }
}

fn embedding_to_blob(vector: &[f32]) -> Vec<u8> {
    vector
        .iter()
        .flat_map(|value| value.to_le_bytes())
        .collect()
}

#[allow(dead_code)]
fn blob_to_embedding(blob: &[u8]) -> Result<Vec<f32>, String> {
    if blob.len() % 4 != 0 {
        return Err("embedding 数据损坏".to_string());
    }
    Ok(blob
        .chunks_exact(4)
        .map(|bytes| f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
        .collect())
}
