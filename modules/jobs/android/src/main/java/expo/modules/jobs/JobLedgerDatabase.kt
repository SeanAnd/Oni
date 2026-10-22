package expo.modules.jobs

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

class JobLedgerDatabase(context: Context) :
  SQLiteOpenHelper(context, DATABASE_NAME, null, SCHEMA_VERSION) {
  override fun onConfigure(db: SQLiteDatabase) {
    db.setForeignKeyConstraintsEnabled(true)
  }

  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL(
      """
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        type TEXT NOT NULL,
        capability_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        status TEXT NOT NULL,
        parameters_json TEXT NOT NULL DEFAULT '{}',
        command_json TEXT,
        timeout_ms INTEGER,
        operation_id TEXT,
        exit_code INTEGER,
        error_key TEXT,
        error_detail TEXT,
        artifact_ids_json TEXT NOT NULL DEFAULT '[]',
        progress REAL,
        setup_json TEXT,
        observations_pending INTEGER NOT NULL DEFAULT 0,
        started_at TEXT,
        finished_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        cancel_requested INTEGER NOT NULL DEFAULT 0,
        result_ingested INTEGER NOT NULL DEFAULT 0
      );
      """.trimIndent(),
    )
    db.execSQL(
      """
      CREATE TABLE job_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        emitted_at TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        FOREIGN KEY(job_id) REFERENCES jobs(id)
      );
      """.trimIndent(),
    )
    db.execSQL(
      """
      CREATE TABLE job_ingestion_markers (
        job_id TEXT NOT NULL,
        marker TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (job_id, marker)
      );
      """.trimIndent(),
    )
    db.execSQL(
      """
      CREATE TABLE job_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT,
        action TEXT NOT NULL,
        detail_redacted TEXT,
        recorded_at TEXT NOT NULL
      );
      """.trimIndent(),
    )
    db.execSQL(
      """
      CREATE TABLE job_diagnostics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        line TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      );
      """.trimIndent(),
    )
    db.execSQL("CREATE INDEX idx_jobs_project ON jobs(project_id);")
    db.execSQL("CREATE INDEX idx_jobs_status ON jobs(status);")
    db.execSQL("CREATE INDEX idx_job_events_job ON job_events(job_id);")
    addIntegrityIndexes(db)
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
    if (oldVersion < 2) addIntegrityIndexes(db)
    if (oldVersion < 3) db.execSQL("ALTER TABLE jobs ADD COLUMN setup_json TEXT")
  }

  private fun addIntegrityIndexes(db: SQLiteDatabase) {
    // Preserve every historical event while repairing sequences written concurrently by v1.
    db.execSQL("UPDATE job_events SET sequence = (SELECT COUNT(*) FROM job_events e WHERE e.job_id = job_events.job_id AND e.id <= job_events.id)")
    db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS idx_job_event_sequence ON job_events(job_id, sequence)")
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_jobs_project_created ON jobs(project_id, created_at DESC)")
  }

  companion object {
    const val DATABASE_NAME = "skid_job_ledger.db"
    const val SCHEMA_VERSION = 3
    const val MAX_DIAGNOSTIC_LINES_PER_JOB = 200
  }
}
