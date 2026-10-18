import Foundation
import SQLite3

final class LocalCache {
  private var db: OpaquePointer?
  let directory: URL
  init(directory: URL? = nil, workspace: String? = nil) throws {
    self.directory =
      directory
      ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent(workspace == nil ? "Passforth" : "Passforth", isDirectory: true)
      .appendingPathComponent(workspace ?? "", isDirectory: true)
    try FileManager.default.createDirectory(
      at: self.directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    try FileManager.default.setAttributes(
      [.posixPermissions: 0o700], ofItemAtPath: self.directory.path)
    let path = self.directory.appendingPathComponent("workspace.sqlite").path
    guard
      sqlite3_open_v2(
        path, &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil)
        == SQLITE_OK
    else { throw CacheError.failed }
    sqlite3_busy_timeout(db, 3000)
    try run("PRAGMA journal_mode=WAL")
    try run("CREATE TABLE IF NOT EXISTS values_store(key TEXT PRIMARY KEY, value BLOB NOT NULL)")
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path)
  }
  deinit { sqlite3_close(db) }
  enum CacheError: LocalizedError {
    case failed
    var errorDescription: String? {
      "Local storage could not save this change. Keep the editor open and try again."
    }
  }
  private func run(_ sql: String) throws {
    guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw CacheError.failed }
  }
  func read<T: Decodable>(_ key: String, as: T.Type = T.self) throws -> T? {
    var statement: OpaquePointer?
    guard
      sqlite3_prepare_v2(db, "SELECT value FROM values_store WHERE key=?", -1, &statement, nil)
        == SQLITE_OK
    else { throw CacheError.failed }
    defer { sqlite3_finalize(statement) }
    sqlite3_bind_text(statement, 1, key, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
    guard sqlite3_step(statement) == SQLITE_ROW else { return nil }
    guard let bytes = sqlite3_column_blob(statement, 0) else { return nil }
    return try JSONDecoder().decode(
      T.self, from: Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 0))))
  }
  func write<T: Encodable>(_ key: String, _ value: T) throws {
    let data = try JSONEncoder().encode(value)
    var statement: OpaquePointer?
    guard
      sqlite3_prepare_v2(
        db,
        "INSERT INTO values_store(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        -1, &statement, nil) == SQLITE_OK
    else { throw CacheError.failed }
    defer { sqlite3_finalize(statement) }
    sqlite3_bind_text(statement, 1, key, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
    let result = data.withUnsafeBytes {
      sqlite3_bind_blob(
        statement, 2, $0.baseAddress, Int32(data.count),
        unsafeBitCast(-1, to: sqlite3_destructor_type.self))
    }
    guard result == SQLITE_OK, sqlite3_step(statement) == SQLITE_DONE else {
      throw CacheError.failed
    }
  }
  func remove(_ key: String) throws {
    var s: OpaquePointer?
    guard sqlite3_prepare_v2(db, "DELETE FROM values_store WHERE key=?", -1, &s, nil) == SQLITE_OK
    else { throw CacheError.failed }
    defer { sqlite3_finalize(s) }
    sqlite3_bind_text(s, 1, key, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
    guard sqlite3_step(s) == SQLITE_DONE else { throw CacheError.failed }
  }
  func importAccount(from legacy: LocalCache, account: String, origin: String) throws {
    let provenance = legacy.directory.appendingPathComponent("workspace-origin.json")
    guard let data = try? Data(contentsOf: provenance),
      let binding = try? JSONDecoder().decode([String: String].self, from: data),
      binding["workspace_url"] == origin,
      try legacy.read("active_account", as: String.self) == account,
      try read("snapshot:" + account, as: DeskSnapshot.self) == nil
    else { return }
    var statement: OpaquePointer?
    guard
      sqlite3_prepare_v2(legacy.db, "SELECT key,value FROM values_store", -1, &statement, nil)
        == SQLITE_OK
    else { throw CacheError.failed }
    defer { sqlite3_finalize(statement) }
    try run("BEGIN IMMEDIATE")
    do {
      var step = sqlite3_step(statement)
      while step == SQLITE_ROW {
        defer { step = sqlite3_step(statement) }
        let key = String(cString: sqlite3_column_text(statement, 0))
        guard
          key == "active_account"
            || ["snapshot:", "outbox:", "selection:", "discarded:", "draft:"].contains(where: {
              key == $0 + account || key.hasPrefix($0 + account + ":")
            })
        else { continue }
        guard let bytes = sqlite3_column_blob(statement, 1) else { continue }
        let value = Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 1)))
        var insert: OpaquePointer?
        guard
          sqlite3_prepare_v2(
            db, "INSERT OR IGNORE INTO values_store(key,value) VALUES(?,?)", -1, &insert, nil)
            == SQLITE_OK
        else { throw CacheError.failed }
        defer { sqlite3_finalize(insert) }
        sqlite3_bind_text(insert, 1, key, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
        let bound = value.withUnsafeBytes {
          sqlite3_bind_blob(
            insert, 2, $0.baseAddress, Int32(value.count),
            unsafeBitCast(-1, to: sqlite3_destructor_type.self))
        }
        guard bound == SQLITE_OK, sqlite3_step(insert) == SQLITE_DONE else {
          throw CacheError.failed
        }
      }
      guard step == SQLITE_DONE else { throw CacheError.failed }
      try run("COMMIT")
    } catch {
      try? run("ROLLBACK")
      throw error
    }
  }
  func saveState(snapshot: DeskSnapshot, mutations: [DeskMutation]) throws {
    try run("BEGIN IMMEDIATE")
    do {
      try write("snapshot:" + snapshot.viewerKey, snapshot)
      try write("outbox:" + snapshot.viewerKey, mutations)
      try write("active_account", snapshot.viewerKey)
      try run("COMMIT")
    } catch {
      try? run("ROLLBACK")
      throw error
    }
  }
}
