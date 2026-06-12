use rusqlite::{Connection, OptionalExtension, Result};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

const SQLITE_NAME: &str = "notepad.db";
const PDF_STORAGE_DIR: &str = "pdfs";
const CATEGORY_NAME_MAX_LENGTH: usize = 20;

static DB: LazyLock<Mutex<Connection>> =
    LazyLock::new(|| Mutex::new(Connection::open(SQLITE_NAME).expect("failed to open database")));

#[derive(serde::Serialize, Debug)]
pub struct NoteGroup {
    id: i64,
    label: String,
    sort: i32,
    count: i64,
    created_at: i64,
}

#[derive(serde::Serialize, Debug)]
pub struct Note {
    id: i64,
    group_id: Option<i64>,
    note_type: String,
    pdf_document_id: Option<i64>,
    source_note_id: Option<i64>,
    source_term: Option<String>,
    title: String,
    content: String,
    is_deleted: bool,
    is_pinned: bool,
    created_at: Option<i64>,
}

#[derive(serde::Serialize, Debug)]
pub struct NoteTerm {
    id: i64,
    note_id: i64,
    term: String,
    explanation: String,
    context: String,
    sort: i64,
    created_at: i64,
}

#[derive(serde::Serialize, Debug)]
pub struct PdfDocument {
    pub id: i64,
    pub name: String,
    pub original_path: String,
    pub stored_path: String,
    pub size: i64,
    pub last_page: i64,
    pub page_count: i64,
    pub created_at: i64,
    pub updated_at: Option<i64>,
}

#[derive(serde::Serialize, Debug)]
pub struct PdfChunk {
    pub id: i64,
    pub pdf_document_id: i64,
    pub chunk_index: i64,
    pub page_start: i64,
    pub page_end: i64,
    pub content: String,
    pub char_count: i64,
    pub token_estimate: i64,
    pub content_hash: String,
    pub created_at: i64,
    pub updated_at: Option<i64>,
}

#[derive(Clone, serde::Serialize, Debug)]
pub struct PdfOutlineItem {
    pub id: i64,
    pub pdf_document_id: i64,
    pub parent_id: Option<i64>,
    pub title: String,
    pub level: i64,
    pub sort: i64,
    pub page_number: Option<i64>,
    pub dest: Option<String>,
    pub source: String,
    pub confidence: f64,
    pub created_at: i64,
}

#[derive(serde::Deserialize, Debug)]
pub struct NoteTermInput {
    term: String,
    explanation: String,
    context: String,
    sort: i64,
}

#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PdfChunkInput {
    chunk_index: i64,
    page_start: i64,
    page_end: i64,
    content: String,
}

#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PdfOutlineItemInput {
    client_id: String,
    parent_client_id: Option<String>,
    title: String,
    level: i64,
    sort: i64,
    page_number: Option<i64>,
    dest: Option<String>,
    source: String,
    confidence: f64,
}

pub fn init_db() -> Result<()> {
    let conn = DB.lock().unwrap();

    conn.execute(
        r#"
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id INTEGER,
            note_type TEXT NOT NULL DEFAULT 'normal',
            pdf_document_id INTEGER,
            source_note_id INTEGER,
            source_term TEXT,
            title TEXT,
            content TEXT,
            is_deleted INTEGER,
            is_pinned INTEGER,
            created_at INTEGER NOT NULL,
            updated_at TEXT
        )
        "#,
        [],
    )?;

    let _ = conn.execute("ALTER TABLE notes ADD COLUMN source_note_id INTEGER", []);
    let _ = conn.execute("ALTER TABLE notes ADD COLUMN source_term TEXT", []);
    let _ = conn.execute("ALTER TABLE notes ADD COLUMN pdf_document_id INTEGER", []);
    let _ = conn.execute(
        "ALTER TABLE notes ADD COLUMN note_type TEXT NOT NULL DEFAULT 'normal'",
        [],
    );

    conn.execute(
        r#"
        CREATE TABLE IF NOT EXISTS note_groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            label TEXT NOT NULL,
            sort INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at TEXT
        )
        "#,
        [],
    )?;

    conn.execute(
        r#"
        CREATE TABLE IF NOT EXISTS note_terms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            note_id INTEGER NOT NULL,
            term TEXT NOT NULL,
            explanation TEXT NOT NULL,
            context TEXT NOT NULL,
            sort INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at TEXT,
            FOREIGN KEY(note_id) REFERENCES notes(id)
        )
        "#,
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_note_terms_note_id ON note_terms(note_id, sort, id)",
        [],
    )?;

    conn.execute(
        r#"
        CREATE TABLE IF NOT EXISTS pdf_documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            original_path TEXT NOT NULL,
            stored_path TEXT NOT NULL,
            size INTEGER NOT NULL,
            last_page INTEGER NOT NULL DEFAULT 1,
            page_count INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER
        )
        "#,
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_pdf_documents_updated ON pdf_documents(updated_at DESC, created_at DESC, id DESC)",
        [],
    )?;

    conn.execute(
        r#"
        CREATE TABLE IF NOT EXISTS pdf_chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pdf_document_id INTEGER NOT NULL,
            chunk_index INTEGER NOT NULL,
            page_start INTEGER NOT NULL,
            page_end INTEGER NOT NULL,
            content TEXT NOT NULL,
            char_count INTEGER NOT NULL,
            token_estimate INTEGER NOT NULL,
            content_hash TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER,
            FOREIGN KEY(pdf_document_id) REFERENCES pdf_documents(id)
        )
        "#,
        [],
    )?;

    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_pdf_chunks_doc_index ON pdf_chunks(pdf_document_id, chunk_index)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_pdf_chunks_doc_pages ON pdf_chunks(pdf_document_id, page_start, page_end)",
        [],
    )?;

    conn.execute(
        r#"
        CREATE TABLE IF NOT EXISTS pdf_outline_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pdf_document_id INTEGER NOT NULL,
            parent_id INTEGER,
            title TEXT NOT NULL,
            level INTEGER NOT NULL,
            sort INTEGER NOT NULL,
            page_number INTEGER,
            dest TEXT,
            source TEXT NOT NULL,
            confidence REAL NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY(pdf_document_id) REFERENCES pdf_documents(id),
            FOREIGN KEY(parent_id) REFERENCES pdf_outline_items(id)
        )
        "#,
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_pdf_outline_doc_sort ON pdf_outline_items(pdf_document_id, sort, id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_pdf_outline_doc_page ON pdf_outline_items(pdf_document_id, page_number)",
        [],
    )?;

    Ok(())
}

#[tauri::command]
pub fn get_db_path() -> Result<String, String> {
    let path = app_data_dir()?.join(SQLITE_NAME);

    Ok(path.to_string_lossy().into_owned())
}

fn app_data_dir() -> Result<PathBuf, String> {
    std::env::current_dir().map_err(|e| e.to_string())
}

fn row_to_note(row: &rusqlite::Row<'_>) -> rusqlite::Result<Note> {
    Ok(Note {
        id: row.get(0)?,
        group_id: row.get(1)?,
        note_type: row.get(2)?,
        pdf_document_id: row.get(3)?,
        source_note_id: row.get(4)?,
        source_term: row.get(5)?,
        title: row.get(6)?,
        content: row.get(7)?,
        is_deleted: row.get::<_, i64>(8)? != 0,
        is_pinned: row.get::<_, i64>(9)? != 0,
        created_at: row.get(10)?,
    })
}

fn validate_group_label(label: &str) -> Result<(), String> {
    if label.trim().chars().count() > CATEGORY_NAME_MAX_LENGTH {
        return Err(format!("分类名称不能超过{}个字", CATEGORY_NAME_MAX_LENGTH));
    }
    Ok(())
}

fn row_to_pdf_document(row: &rusqlite::Row<'_>) -> rusqlite::Result<PdfDocument> {
    Ok(PdfDocument {
        id: row.get(0)?,
        name: row.get(1)?,
        original_path: row.get(2)?,
        stored_path: row.get(3)?,
        size: row.get(4)?,
        last_page: row.get(5)?,
        page_count: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn row_to_pdf_chunk(row: &rusqlite::Row<'_>) -> rusqlite::Result<PdfChunk> {
    Ok(PdfChunk {
        id: row.get(0)?,
        pdf_document_id: row.get(1)?,
        chunk_index: row.get(2)?,
        page_start: row.get(3)?,
        page_end: row.get(4)?,
        content: row.get(5)?,
        char_count: row.get(6)?,
        token_estimate: row.get(7)?,
        content_hash: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn row_to_pdf_outline_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<PdfOutlineItem> {
    Ok(PdfOutlineItem {
        id: row.get(0)?,
        pdf_document_id: row.get(1)?,
        parent_id: row.get(2)?,
        title: row.get(3)?,
        level: row.get(4)?,
        sort: row.get(5)?,
        page_number: row.get(6)?,
        dest: row.get(7)?,
        source: row.get(8)?,
        confidence: row.get(9)?,
        created_at: row.get(10)?,
    })
}

fn estimate_tokens(text: &str) -> i64 {
    let chars = text.chars().count() as i64;
    ((chars as f64) / 1.8).ceil().max(1.0) as i64
}

fn stable_content_hash(text: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in text.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

fn validate_pdf_path(path: &Path) -> Result<(), String> {
    if path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| !ext.eq_ignore_ascii_case("pdf"))
        .unwrap_or(true)
    {
        return Err("请选择 PDF 文件".to_string());
    }

    let metadata = fs::metadata(path).map_err(|err| format!("读取 PDF 失败：{err}"))?;
    if !metadata.is_file() {
        return Err("请选择 PDF 文件".to_string());
    }

    Ok(())
}

fn sanitize_file_stem(stem: &str) -> String {
    let sanitized: String = stem
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = sanitized.trim_matches('_');
    if trimmed.is_empty() {
        "document".to_string()
    } else {
        trimmed.chars().take(80).collect()
    }
}

fn next_pdf_storage_path(source_path: &Path) -> Result<PathBuf, String> {
    let storage_dir = app_data_dir()?.join(PDF_STORAGE_DIR);
    fs::create_dir_all(&storage_dir).map_err(|err| format!("创建 PDF 存储目录失败：{err}"))?;

    let stem = source_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .map(sanitize_file_stem)
        .unwrap_or_else(|| "document".to_string());
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| err.to_string())?
        .as_secs();

    for index in 0..1000 {
        let suffix = if index == 0 {
            String::new()
        } else {
            format!("-{index}")
        };
        let candidate = storage_dir.join(format!("{timestamp}-{stem}{suffix}.pdf"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err("无法生成 PDF 存储文件名".to_string())
}

#[tauri::command]
pub fn import_pdf_file(path: String) -> Result<PdfDocument, String> {
    let source_path = Path::new(&path);
    validate_pdf_path(source_path)?;

    let conn = DB.lock().unwrap();
    if let Some(document) = conn
        .query_row(
            r#"
            SELECT id, name, original_path, stored_path, size, last_page, page_count, created_at, updated_at
            FROM pdf_documents
            WHERE original_path = ?1
            LIMIT 1
            "#,
            [&path],
            row_to_pdf_document,
        )
        .optional()
        .map_err(|err| err.to_string())?
    {
        if Path::new(&document.stored_path).exists() {
            return Ok(document);
        }
    }
    drop(conn);

    let stored_path = next_pdf_storage_path(source_path)?;
    fs::copy(source_path, &stored_path).map_err(|err| format!("保存 PDF 失败：{err}"))?;
    let metadata = fs::metadata(&stored_path).map_err(|err| format!("读取 PDF 失败：{err}"))?;
    let name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("未命名 PDF")
        .to_string();
    let stored_path = stored_path.to_string_lossy().into_owned();

    let conn = DB.lock().unwrap();
    conn.query_row(
        r#"
        INSERT INTO pdf_documents (
            name,
            original_path,
            stored_path,
            size,
            last_page,
            page_count,
            created_at,
            updated_at
        ) VALUES (
            ?1,
            ?2,
            ?3,
            ?4,
            1,
            0,
            strftime('%s', 'now'),
            strftime('%s', 'now')
        )
        RETURNING id, name, original_path, stored_path, size, last_page, page_count, created_at, updated_at
        "#,
        (name, path, stored_path, metadata.len() as i64),
        row_to_pdf_document,
    )
    .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn get_pdf_documents() -> Result<Vec<PdfDocument>, String> {
    let conn = DB.lock().unwrap();
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id, name, original_path, stored_path, size, last_page, page_count, created_at, updated_at
            FROM pdf_documents
            ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
            "#,
        )
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map([], row_to_pdf_document)
        .map_err(|err| err.to_string())?;

    rows.map(|row| row.map_err(|err| err.to_string())).collect()
}

pub fn get_pdf_document(id: i64) -> Result<PdfDocument, String> {
    let conn = DB.lock().unwrap();
    conn.query_row(
        r#"
        SELECT id, name, original_path, stored_path, size, last_page, page_count, created_at, updated_at
        FROM pdf_documents
        WHERE id = ?1
        "#,
        [id],
        row_to_pdf_document,
    )
    .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn read_pdf_document_file(id: i64) -> Result<Vec<u8>, String> {
    let conn = DB.lock().unwrap();
    let stored_path: String = conn
        .query_row(
            "SELECT stored_path FROM pdf_documents WHERE id = ?1",
            [id],
            |row| row.get(0),
        )
        .map_err(|err| err.to_string())?;
    drop(conn);

    fs::read(&stored_path).map_err(|err| format!("读取 PDF 失败：{err}"))
}

#[tauri::command]
pub fn update_pdf_reading_position(
    id: i64,
    last_page: i64,
    page_count: i64,
) -> Result<PdfDocument, String> {
    let page_count = page_count.max(0);
    let last_page = if page_count > 0 {
        last_page.clamp(1, page_count)
    } else {
        last_page.max(1)
    };
    let conn = DB.lock().unwrap();
    conn.query_row(
        r#"
        UPDATE pdf_documents
        SET last_page = ?1,
            page_count = ?2,
            updated_at = strftime('%s', 'now')
        WHERE id = ?3
        RETURNING id, name, original_path, stored_path, size, last_page, page_count, created_at, updated_at
        "#,
        (last_page, page_count, id),
        row_to_pdf_document,
    )
    .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn get_pdf_chunks(pdf_document_id: i64) -> Result<Vec<PdfChunk>, String> {
    let conn = DB.lock().unwrap();
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id, pdf_document_id, chunk_index, page_start, page_end, content,
                   char_count, token_estimate, content_hash, created_at, updated_at
            FROM pdf_chunks
            WHERE pdf_document_id = ?1
            ORDER BY chunk_index, id
            "#,
        )
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map([pdf_document_id], row_to_pdf_chunk)
        .map_err(|err| err.to_string())?;

    rows.map(|row| row.map_err(|err| err.to_string())).collect()
}

#[tauri::command]
pub fn delete_pdf_chunks(pdf_document_id: i64) -> Result<(), String> {
    let conn = DB.lock().unwrap();
    conn.execute(
        "DELETE FROM pdf_chunks WHERE pdf_document_id = ?1",
        [pdf_document_id],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn save_pdf_chunks(
    pdf_document_id: i64,
    chunks: Vec<PdfChunkInput>,
) -> Result<Vec<PdfChunk>, String> {
    if chunks.is_empty() {
        return Err("没有可保存的 PDF 文本切片".to_string());
    }

    let mut conn = DB.lock().unwrap();
    let exists = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pdf_documents WHERE id = ?1)",
            [pdf_document_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|err| err.to_string())?
        == 1;
    if !exists {
        return Err("PDF 文档不存在".to_string());
    }

    let tx = conn.transaction().map_err(|err| err.to_string())?;
    tx.execute(
        "DELETE FROM pdf_chunks WHERE pdf_document_id = ?1",
        [pdf_document_id],
    )
    .map_err(|err| err.to_string())?;

    for chunk in chunks {
        let content = chunk.content.trim();
        if content.is_empty() {
            continue;
        }

        let page_start = chunk.page_start.max(1);
        let page_end = chunk.page_end.max(page_start);
        let char_count = content.chars().count() as i64;
        let token_estimate = estimate_tokens(content);
        let content_hash = stable_content_hash(content);

        tx.execute(
            r#"
            INSERT INTO pdf_chunks (
                pdf_document_id,
                chunk_index,
                page_start,
                page_end,
                content,
                char_count,
                token_estimate,
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
                ?7,
                ?8,
                strftime('%s', 'now'),
                strftime('%s', 'now')
            )
            "#,
            (
                pdf_document_id,
                chunk.chunk_index,
                page_start,
                page_end,
                content,
                char_count,
                token_estimate,
                content_hash,
            ),
        )
        .map_err(|err| err.to_string())?;
    }

    tx.commit().map_err(|err| err.to_string())?;
    drop(conn);
    get_pdf_chunks(pdf_document_id)
}

#[tauri::command]
pub fn get_pdf_outline_items(pdf_document_id: i64) -> Result<Vec<PdfOutlineItem>, String> {
    let conn = DB.lock().unwrap();
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id, pdf_document_id, parent_id, title, level, sort, page_number,
                   dest, source, confidence, created_at
            FROM pdf_outline_items
            WHERE pdf_document_id = ?1
            ORDER BY sort, id
            "#,
        )
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map([pdf_document_id], row_to_pdf_outline_item)
        .map_err(|err| err.to_string())?;

    rows.map(|row| row.map_err(|err| err.to_string())).collect()
}

#[tauri::command]
pub fn delete_pdf_outline_items(pdf_document_id: i64) -> Result<(), String> {
    let conn = DB.lock().unwrap();
    conn.execute(
        "DELETE FROM pdf_outline_items WHERE pdf_document_id = ?1",
        [pdf_document_id],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn save_pdf_outline_items(
    pdf_document_id: i64,
    items: Vec<PdfOutlineItemInput>,
) -> Result<Vec<PdfOutlineItem>, String> {
    let mut conn = DB.lock().unwrap();
    let exists = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pdf_documents WHERE id = ?1)",
            [pdf_document_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|err| err.to_string())?
        == 1;
    if !exists {
        return Err("PDF 文档不存在".to_string());
    }

    let tx = conn.transaction().map_err(|err| err.to_string())?;
    tx.execute(
        "DELETE FROM pdf_outline_items WHERE pdf_document_id = ?1",
        [pdf_document_id],
    )
    .map_err(|err| err.to_string())?;

    let mut id_by_client_id = HashMap::new();
    for item in items {
        let title = item.title.trim();
        if title.is_empty() {
            continue;
        }

        let parent_id = item
            .parent_client_id
            .as_ref()
            .and_then(|client_id| id_by_client_id.get(client_id))
            .copied();
        let page_number = item.page_number.map(|page| page.max(1));
        let source = if item.source.trim().is_empty() {
            "pdf_outline"
        } else {
            item.source.trim()
        };
        let confidence = item.confidence.clamp(0.0, 1.0);

        tx.execute(
            r#"
            INSERT INTO pdf_outline_items (
                pdf_document_id,
                parent_id,
                title,
                level,
                sort,
                page_number,
                dest,
                source,
                confidence,
                created_at
            ) VALUES (
                ?1,
                ?2,
                ?3,
                ?4,
                ?5,
                ?6,
                ?7,
                ?8,
                ?9,
                strftime('%s', 'now')
            )
            "#,
            (
                pdf_document_id,
                parent_id,
                title,
                item.level.max(1),
                item.sort.max(0),
                page_number,
                item.dest.as_deref(),
                source,
                confidence,
            ),
        )
        .map_err(|err| err.to_string())?;

        id_by_client_id.insert(item.client_id, tx.last_insert_rowid());
    }

    tx.commit().map_err(|err| err.to_string())?;
    drop(conn);
    get_pdf_outline_items(pdf_document_id)
}

#[tauri::command]
pub fn add_groups(label: &str) -> Result<NoteGroup, String> {
    validate_group_label(label)?;

    let conn = DB.lock().unwrap();
    let sql = "INSERT INTO note_groups (label, sort, created_at) VALUES (?1, 0, strftime('%s', 'now')) RETURNING id, label, sort, 0, created_at";
    let res: NoteGroup = conn
        .query_row(sql, [label], |row| {
            Ok(NoteGroup {
                id: row.get(0)?,
                label: row.get(1)?,
                sort: row.get(2)?,
                count: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(res)
}

#[tauri::command]
pub fn get_groups() -> Result<Vec<NoteGroup>, String> {
    let conn = DB.lock().unwrap();
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
                note_groups.id,
                note_groups.label,
                note_groups.sort,
                COUNT(notes.id) AS count,
                note_groups.created_at
            FROM note_groups
            LEFT JOIN notes
                ON notes.group_id = note_groups.id
                AND notes.is_deleted = 0
            GROUP BY note_groups.id
            ORDER BY note_groups.sort, note_groups.id
            "#,
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(NoteGroup {
                id: row.get(0)?,
                label: row.get(1)?,
                sort: row.get(2)?,
                count: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.map(|row| row.map_err(|e| e.to_string())).collect()
}

#[tauri::command]
pub fn get_notes() -> Result<Vec<Note>, String> {
    let conn = DB.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT id, group_id, note_type, pdf_document_id, source_note_id, source_term, title, content, is_deleted, is_pinned, created_at FROM notes WHERE is_deleted = 0 ORDER BY is_pinned DESC, created_at DESC, id DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], row_to_note).map_err(|e| e.to_string())?;
    rows.map(|row| row.map_err(|e| e.to_string())).collect()
}

#[tauri::command]
pub fn update_group(id: i64, label: &str) -> Result<NoteGroup, String> {
    validate_group_label(label)?;

    let conn = DB.lock().unwrap();
    let sql_str = r#"
        UPDATE note_groups
        SET label = ?1,
            updated_at = strftime('%s', 'now')
        WHERE id = ?2
        RETURNING
            id,
            label,
            sort,
            (SELECT COUNT(*) FROM notes WHERE group_id = ?2 AND is_deleted = 0),
            created_at
    "#;
    let res = conn
        .query_row(sql_str, (label, id), |row| {
            Ok(NoteGroup {
                id: row.get(0)?,
                label: row.get(1)?,
                sort: row.get(2)?,
                count: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|err| err.to_string())?;

    Ok(res)
}

#[tauri::command]
pub fn delete_group(id: i64) -> Result<(), String> {
    println!("delete_group");
    let conn = DB.lock().unwrap();
    conn.execute("DELETE FROM note_groups WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn add_notes(
    group_id: Option<i64>,
    note_type: Option<String>,
    title: &str,
    content: &str,
    source_note_id: Option<i64>,
    source_term: Option<String>,
    pdf_document_id: Option<i64>,
) -> Result<Note, String> {
    let conn = DB.lock().unwrap();
    let note_type = note_type.unwrap_or_else(|| "normal".to_string());
    let sql_str = r#"
        INSERT INTO notes (
            group_id,
            note_type,
            pdf_document_id,
            source_note_id,
            source_term,
            title,
            content,
            is_deleted,
            is_pinned,
            created_at
        ) VALUES (
            ?1,
            ?2,
            ?3,
            ?4,
            ?5,
            ?6,
            ?7,
            0,
            0,
            strftime('%s', 'now')
        )
        RETURNING
            id,
            group_id,
            note_type,
            pdf_document_id,
            source_note_id,
            source_term,
            title,
            content,
            is_deleted,
            is_pinned,
            created_at
    "#;
    let res = conn
        .query_row(
            sql_str,
            (
                group_id,
                note_type,
                pdf_document_id,
                source_note_id,
                source_term,
                title,
                content,
            ),
            row_to_note,
        )
        .map_err(|e| e.to_string())?;
    Ok(res)
}

#[tauri::command]
pub fn update_notes(id: i64, title: &str, content: &str) -> Result<Note, String> {
    let conn = DB.lock().unwrap();
    let sql_str = r#"
        UPDATE notes
        SET title = ?1,
            content = ?2,
            updated_at = strftime('%s', 'now')
        WHERE id = ?3
        RETURNING
            id,
            group_id,
            note_type,
            pdf_document_id,
            source_note_id,
            source_term,
            title,
            content,
            is_deleted,
            is_pinned,
            created_at
    "#;
    let res = conn
        .query_row(sql_str, (title, content, id), row_to_note)
        .map_err(|e| e.to_string())?;
    Ok(res)
}

#[tauri::command]
pub fn update_note_group(id: i64, group_id: Option<i64>) -> Result<Note, String> {
    let conn = DB.lock().unwrap();
    let sql_str = r#"
        UPDATE notes
        SET group_id = ?1,
            updated_at = strftime('%s', 'now')
        WHERE id = ?2
        RETURNING
            id,
            group_id,
            note_type,
            pdf_document_id,
            source_note_id,
            source_term,
            title,
            content,
            is_deleted,
            is_pinned,
            created_at
    "#;
    let res = conn
        .query_row(sql_str, (group_id, id), row_to_note)
        .map_err(|e| e.to_string())?;
    Ok(res)
}

#[tauri::command]
pub fn update_note_pinned(id: i64, is_pinned: bool) -> Result<Note, String> {
    let conn = DB.lock().unwrap();
    let sql_str = r#"
        UPDATE notes
        SET is_pinned = ?1,
            updated_at = strftime('%s', 'now')
        WHERE id = ?2
        RETURNING
            id,
            group_id,
            note_type,
            pdf_document_id,
            source_note_id,
            source_term,
            title,
            content,
            is_deleted,
            is_pinned,
            created_at
    "#;
    let res = conn
        .query_row(sql_str, (is_pinned as i64, id), row_to_note)
        .map_err(|e| e.to_string())?;
    Ok(res)
}

#[tauri::command]
pub fn delete_notes(id: i64) -> Result<(), String> {
    let conn = DB.lock().unwrap();
    conn.execute(
        "UPDATE notes SET is_deleted = 1, updated_at = strftime('%s', 'now') WHERE id = ?1",
        [id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_note_terms(note_id: i64) -> Result<Vec<NoteTerm>, String> {
    let conn = DB.lock().unwrap();
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id, note_id, term, explanation, context, sort, created_at
            FROM note_terms
            WHERE note_id = ?1
            ORDER BY sort, id
            "#,
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([note_id], |row| {
            Ok(NoteTerm {
                id: row.get(0)?,
                note_id: row.get(1)?,
                term: row.get(2)?,
                explanation: row.get(3)?,
                context: row.get(4)?,
                sort: row.get(5)?,
                created_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.map(|row| row.map_err(|e| e.to_string())).collect()
}

#[tauri::command]
pub fn save_note_terms(note_id: i64, terms: Vec<NoteTermInput>) -> Result<Vec<NoteTerm>, String> {
    let mut conn = DB.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute("DELETE FROM note_terms WHERE note_id = ?1", [note_id])
        .map_err(|e| e.to_string())?;

    for term in terms {
        let clean_term = term.term.trim();
        if clean_term.is_empty() {
            continue;
        }

        tx.execute(
            r#"
            INSERT INTO note_terms (
                note_id,
                term,
                explanation,
                context,
                sort,
                created_at
            ) VALUES (
                ?1,
                ?2,
                ?3,
                ?4,
                ?5,
                strftime('%s', 'now')
            )
            "#,
            (
                note_id,
                clean_term,
                term.explanation.trim(),
                term.context.trim(),
                term.sort,
            ),
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    drop(conn);
    get_note_terms(note_id)
}
