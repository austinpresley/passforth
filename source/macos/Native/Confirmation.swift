import Foundation

enum ConfirmationError: LocalizedError {
  case invalid
  var errorDescription: String? {
    "The save was not confirmed. Your change is kept on this Mac for retry."
  }
}

extension DeskSnapshot {
  /// Merge the acknowledged server record before removing its durable local retry.
  mutating func confirm(_ item: DeskMutation, response: JSONValue) throws {
    func upsert(_ record: DeskRecord, in rows: inout [DeskRecord]) {
      if let index = rows.firstIndex(where: { $0.id == record.id }) {
        rows[index] = record
      } else {
        rows.append(record)
      }
    }
    if item.isTask {
      let record = DeskRecord(response["task"].object)
      guard record.id == item.targetKey, record.version > 0 else { throw ConfirmationError.invalid }
      upsert(record, in: &tasks)
      return
    }
    if item.path == "/api/tasks/read" {
      guard response["task_key"].text == item.targetKey,
        response["read_version"].integer >= (item.body["attention_version"]?.integer ?? 0)
      else { throw ConfirmationError.invalid }
      if let index = tasks.firstIndex(where: { $0.id == item.targetKey }) {
        tasks[index].fields["read_version"] = .int(
          max(tasks[index].int("read_version"), response["read_version"].integer))
      }
      return
    }
    if item.isComment {
      var record = DeskRecord(response["comment"].object)
      guard record.id.hasSuffix(":" + item.id), record.text("target_type") == item.targetType,
        record.text("target_key") == item.targetKey, record.fields["body"] == item.body["body"],
        record.fields["kind"] == item.body["kind"]
      else { throw ConfirmationError.invalid }
      if record.text("kind") == "request" { record.fields["request_state"] = .string("queued") }
      let key = item.targetType + ":" + item.targetKey
      var thread = threads[key] ?? DeskThread()
      // A duplicate save must not downgrade a real acknowledgement already read from the server.
      if !thread.comments.contains(where: { $0.id == record.id }) { thread.comments.append(record) }
      threads[key] = thread
      return
    }
    let value = response["record"].object.isEmpty ? response : response["record"]
    let record = DeskRecord(value.object)
    guard !record.id.isEmpty, record.version > 0,
      record.id == item.targetKey || record.id.hasSuffix(":" + item.targetKey)
    else { throw ConfirmationError.invalid }
    switch item.targetType {
    case "note":
      upsert(record, in: &workspace.notes)
      workspace.noteLinks.removeAll {
        $0.text("note_id") == record.id || $0.text("note_id") == item.targetKey
      }
      for (index, link) in (item.body["links"]?.array ?? []).enumerated() {
        var fields = link.object
        fields["id"] = .string(item.id + ":" + String(index))
        fields["note_id"] = .string(record.id)
        workspace.noteLinks.append(DeskRecord(fields))
      }
    case "area": upsert(record, in: &workspace.areas)
    case "project": upsert(record, in: &workspace.projects)
    case "view": upsert(record, in: &workspace.savedViews)
    case "block": upsert(record, in: &workspace.timeBlocks)
    default: throw ConfirmationError.invalid
    }
  }
}
