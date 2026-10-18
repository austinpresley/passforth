import Foundation
import SQLite3

@main struct NativeCoreTests {
  static func check(_ condition: @autoclosure () -> Bool, _ message: String) {
    precondition(condition(), message)
  }
  static func main() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let account = String(repeating: "a", count: 64)
    let other = String(repeating: "b", count: 64)
    var snapshot = DeskSnapshot()
    snapshot.viewerKey = account
    let task = DeskRecord([
      "task_key": .string("capture-test"), "title": .string("Original"),
      "version": .int(2), "status": .string("waiting"), "action_owner": .string("user"),
      "attention_version": .int(3), "read_version": .int(1),
      "unknown_future_field": .string("retained"),
    ])
    snapshot.tasks = [task]
    let note = DeskMutation(
      id: "change-1", account: account, path: "/api/workspace",
      body: [
        "action": .string("note"), "id": .string("note-test"), "title": .string("Offline brief"),
        "links": .array([.object(["target_type": .string("task"), "target_key": .string(task.id)])]
        ),
      ],
      targetType: "note", targetKey: "note-test", createdAt: DeskDates.iso())
    do {
      let cache = try LocalCache(directory: root)
      try cache.saveState(snapshot: snapshot, mutations: [note])
      try cache.write("draft:" + account + ":capture", "Local draft")
      var second = DeskSnapshot()
      second.viewerKey = other
      try cache.saveState(snapshot: second, mutations: [])
    }
    do {
      let cache = try LocalCache(directory: root)
      let restored: DeskSnapshot = try cache.read("snapshot:" + account)!
      check(
        restored.tasks[0].text("unknown_future_field") == "retained",
        "Preserve future server fields")
      let queue: [DeskMutation] = try cache.read("outbox:" + account)!
      check(queue == [note], "Outbox survives process restart without new save identifiers")
      let empty: [DeskMutation] = try cache.read("outbox:" + other)!
      let absent: String? = try cache.read("draft:" + other + ":capture")
      check(empty.isEmpty && absent == nil, "Accounts must not share outboxes or drafts")
      let draft = try cache.read("draft:" + account + ":capture", as: String.self)
      check(draft == "Local draft", "Draft survives restart")

      let reply = JSONValue.object([
        "record": .object([
          "id": .string("owner:note-test"),
          "title": .string("Offline brief"), "version": .int(1), "body": .string("Kept"),
        ])
      ])
      try snapshot.confirm(note, response: reply)
      try cache.saveState(snapshot: snapshot, mutations: [])
      let saved: DeskSnapshot = try cache.read("snapshot:" + account)!
      check(
        saved.workspace.notes.first?.id == "owner:note-test",
        "Confirmed note remains available without a follow-up fetch")
      check(
        saved.workspace.noteLinks.first?.text("note_id") == "owner:note-test",
        "Links follow canonical IDs")
      do {
        try snapshot.confirm(note, response: .object([:]))
        preconditionFailure("Malformed success removed a retry")
      } catch ConfirmationError.invalid {}

      // Force a failure between snapshot and outbox writes, then verify the entire transaction rolled back.
      var connection: OpaquePointer?
      check(
        sqlite3_open(root.appendingPathComponent("workspace.sqlite").path, &connection)
          == SQLITE_OK, "Open test fixture")
      defer { sqlite3_close(connection) }
      check(
        sqlite3_exec(
          connection,
          "CREATE TRIGGER reject_outbox BEFORE UPDATE ON values_store WHEN NEW.key LIKE 'outbox:%' BEGIN SELECT RAISE(ABORT,'test disk failure'); END",
          nil, nil, nil) == SQLITE_OK, "Install test failure")
      var changed = snapshot
      changed.tasks = []
      do {
        try cache.saveState(snapshot: changed, mutations: [note])
        preconditionFailure("Expected transaction failure")
      } catch LocalCache.CacheError.failed {}
      let unchanged: DeskSnapshot = try cache.read("snapshot:" + account)!
      check(
        unchanged.tasks.count == 1,
        "Failed commit cannot remove the snapshot independently of its outbox")
    }
    let mode =
      try FileManager.default.attributesOfItem(atPath: root.path)[.posixPermissions] as! NSNumber
    let fileMode =
      try FileManager.default.attributesOfItem(
        atPath: root.appendingPathComponent("workspace.sqlite").path)[.posixPermissions]
      as! NSNumber
    check(mode.intValue == 0o700 && fileMode.intValue == 0o600, "Private local cache permissions")

    let block = DeskMutation(
      id: "block-save", account: account, path: "/api/workspace",
      body: ["action": .string("block")], targetType: "block", targetKey: "block-new",
      createdAt: DeskDates.iso())
    try snapshot.confirm(
      block,
      response: .object([
        "record": .object([
          "id": .string("owner:block-new"),
          "task_key": .string(task.id), "version": .int(1),
        ])
      ]))
    check(
      snapshot.workspace.timeBlocks.first?.id == "owner:block-new",
      "A time block owns its ID independently of its linked task")
    let request = DeskMutation(
      id: "request-1", account: account, path: "/api/workspace",
      body: [
        "action": .string("comment"), "kind": .string("request"), "body": .string("Reply here"),
      ],
      targetType: "task", targetKey: task.id, createdAt: DeskDates.iso())
    let comment: JSONValue = .object([
      "comment": .object([
        "id": .string("owner:request-1"),
        "target_type": .string("task"), "target_key": .string(task.id),
        "body": .string("Reply here"), "kind": .string("request"),
      ])
    ])
    try snapshot.confirm(request, response: comment)
    check(
      snapshot.threads["task:" + task.id]!.comments[0].text("request_state") == "queued",
      "Saving is not agent acknowledgement")
    snapshot.threads["task:" + task.id]!.comments[0].fields["request_state"] = .string("answered")
    try snapshot.confirm(request, response: comment)
    check(
      snapshot.threads["task:" + task.id]!.comments.count == 1, "Retry cannot duplicate a comment")
    check(
      snapshot.threads["task:" + task.id]!.comments[0].text("request_state") == "answered",
      "Retry cannot downgrade a real reply")

    check(task.needsYou && task.unread, "Explicit user blocker is actionable and unread")
    var unknown = task
    unknown.fields["action_owner"] = .string("unknown")
    check(!unknown.needsYou, "Do not infer user ownership")
    var due = task
    due.fields["deadline"] = .string("2026-10-16")
    check(taskMatches(due, view: "today", today: "2026-10-18"), "Today includes overdue deadlines")
    due.fields["status"] = .string("completed")
    check(
      !taskMatches(due, view: "today", today: "2026-10-18"),
      "Completed work does not remain in Today")
    check(
      labelMatches("work/design personal", "work") && !labelMatches("workshop", "work"),
      "Nested labels respect boundaries")
    check(
      DeskDates.week(DeskDates.date("2026-10-18")).map { DeskDates.day($0) }.first == "2026-10-12",
      "Week starts on Monday")
    print(
      "Native storage, restart, account isolation, acknowledgement, transaction recovery and task semantics passed."
    )
  }
}
