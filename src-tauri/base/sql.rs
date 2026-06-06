use rusqlite::{Connection, Result};
use std::sync::{LazyLock, Mutex};

const SQLITE_NAME: &str = "notepad.db";

static DB: LazyLock<Mutex<Connection>> =
    LazyLock::new(|| Mutex::new(Connection::open(SQLITE_NAME).expect("failed to open database")));

#[derive(serde::Serialize, Debug)]
pub struct NoteGroup {
    id: i64,
    label: String,
    sort: i32,
    created_at: i64,
}

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
pub fn add_groups(label: &str) -> Result<NoteGroup, String> {
    let conn = DB.lock().unwrap();
    let sql = "INSERT INTO note_groups (label, sort, created_at) VALUES (?1, 0, strftime('%s', 'now')) RETURNING id, label, sort, created_at";
    let res: NoteGroup = conn
        .query_row(sql, [label], |row| {
            Ok(NoteGroup {
                id: row.get(0)?,
                label: row.get(1)?,
                sort: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(res)
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
    rows.map(|row| row.map_err(|e| e.to_string())).collect()
}

#[tauri::command]
pub fn update_group(id: i64, label: &str) -> Result<NoteGroup, String> {
    let conn = DB.lock().unwrap();
    let sql_str = "UPDATE note_groups SET label = ?1, updated_at = strftime('%s', 'now') WHERE id = ?2 RETURNING id, label, sort, created_at";
    let res = conn
        .query_row(sql_str, (label, id), |row| {
            Ok(NoteGroup {
                id: row.get(0)?,
                label: row.get(1)?,
                sort: row.get(2)?,
                created_at: row.get(3)?,
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

