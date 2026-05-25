use rusqlite::{Connection, Result};

pub fn init_db() -> Result<Connection> {
    let conn = Connection::connect("notepad.db")?;
    conn.execute(
        r#"
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id INTEGER,
            title TEXT,
            content TEXT,
            is_deleted INTEGER,
            is_pinned INTEGER,
            created_at TEXT,
            updated_at TEXT,
            
        )
        "#,
        [],
    )?;
    Ok(conn)
}
