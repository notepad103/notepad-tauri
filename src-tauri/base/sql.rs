use rusqlite::{Connection, Result};
use std::sync::{LazyLock, Mutex};

const SQLITE_NAME: &str = "notepad.db";

static DB: LazyLock<Mutex<Connection>> = LazyLock::new(|| {
    Mutex::new(Connection::open(SQLITE_NAME).expect("failed to open database"))
});

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
        CREATE TABLE IF NOT EXISTS group (
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
pub fn add_group(label: &str) -> Result<(), String> {
    let conn = DB.lock().unwrap();
    conn.execute(
        "INSERT INTO group (label, sort, created_at) VALUES (?1, 0, strftime('%s', 'now'))",
        [label],
    ).map_err(|e| e.to_string());
    Ok(())
}
