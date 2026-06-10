use rusqlite::{Connection, Result};
use std::sync::{LazyLock, Mutex};

const SQLITE_NAME: &str = "notepad.db";
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

#[derive(serde::Deserialize, Debug)]
pub struct NoteTermInput {
    term: String,
    explanation: String,
    context: String,
    sort: i64,
}

pub fn init_db() -> Result<()> {
    let conn = DB.lock().unwrap();

    conn.execute(
        r#"
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id INTEGER,
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

    Ok(())
}

#[tauri::command]
pub fn get_db_path() -> Result<String, String> {
    let path = std::env::current_dir()
        .map_err(|e| e.to_string())?
        .join(SQLITE_NAME);

    Ok(path.to_string_lossy().into_owned())
}

fn row_to_note(row: &rusqlite::Row<'_>) -> rusqlite::Result<Note> {
    Ok(Note {
        id: row.get(0)?,
        group_id: row.get(1)?,
        source_note_id: row.get(2)?,
        source_term: row.get(3)?,
        title: row.get(4)?,
        content: row.get(5)?,
        is_deleted: row.get::<_, i64>(6)? != 0,
        is_pinned: row.get::<_, i64>(7)? != 0,
        created_at: row.get(8)?,
    })
}

fn validate_group_label(label: &str) -> Result<(), String> {
    if label.trim().chars().count() > CATEGORY_NAME_MAX_LENGTH {
        return Err(format!("分类名称不能超过{}个字", CATEGORY_NAME_MAX_LENGTH));
    }
    Ok(())
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
            "SELECT id, group_id, source_note_id, source_term, title, content, is_deleted, is_pinned, created_at FROM notes WHERE is_deleted = 0 ORDER BY is_pinned DESC, created_at DESC, id DESC",
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
    title: &str,
    content: &str,
    source_note_id: Option<i64>,
    source_term: Option<String>,
) -> Result<Note, String> {
    let conn = DB.lock().unwrap();
    let sql_str = r#"
        INSERT INTO notes (
            group_id,
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
            0,
            0,
            strftime('%s', 'now')
        )
        RETURNING
            id,
            group_id,
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
            (group_id, source_note_id, source_term, title, content),
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
