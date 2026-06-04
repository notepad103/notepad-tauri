use rusqlite::{Connection, Result};
use std::sync::{LazyLock, Mutex};

const SQLITE_NAME: &str = "notepad.db";

static DB: LazyLock<Mutex<Connection>> =
    LazyLock::new(|| Mutex::new(Connection::open(SQLITE_NAME).expect("failed to open database")));

pub fn init_db() -> Result<()> {
    let conn = DB.lock().unwrap();

    conn.execute(
        r#"
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id INTEGER,
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

    Ok(())
}

#[tauri::command]
pub fn add_groups(label: &str) -> Result<(), String> {
    let conn = DB.lock().unwrap();
    conn.execute(
        "INSERT INTO note_groups (label, sort, created_at) VALUES (?1, 0, strftime('%s', 'now'))",
        [label],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(serde::Serialize)]
pub struct NoteGroup {
    id: i64,
    label: String,
    sort: i32,
    created_at: i64,
}

#[tauri::command]
pub fn get_groups() -> Result<Vec<NoteGroup>, String> {
    let conn = DB.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, label, sort, created_at FROM note_groups ORDER BY sort, id")
        .map_err(|e| e.to_string())?;
    
    let rows = stmt
        .query_map([], |row| {
            Ok(NoteGroup {
                id: row.get(0)?,
                label: row.get(1)?,
                sort: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.map(|row| row.map_err(|e| e.to_string()))
        .collect()
}
