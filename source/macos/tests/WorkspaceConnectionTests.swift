import Foundation

@main struct WorkspaceConnectionTests {
  @MainActor static func main() throws {
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: folder) }
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let original = WorkspaceConnection(
      workspaceURL: "https://workspace.example.com", projectID: "project-one")
    let connection = try original.validated()
    precondition(connection.workspaceURL == "https://workspace.example.com/")
    let file = folder.appendingPathComponent("workspace.passforth")
    try JSONEncoder().encode(connection).write(to: file)
    let decoded = try WorkspaceConnection.read(file)
    precondition(decoded == connection)
    for bad in [
      "http://example.com", "https://token@example.com", "https://example.com/?secret=x",
      "https://example.com/api", "https://example.com:444", "https://unset.invalid",
    ] {
      do {
        _ = try WorkspaceConnection(workspaceURL: bad).validated()
        preconditionFailure("Unsafe URL was accepted")
      } catch ConnectionError.invalidFile {}
    }
    try Data(
      "{\"format\":\"passforth.workspace\",\"schema_version\":1,\"workspace_url\":\"https://example.com\",\"password\":\"secret\"}"
        .utf8
    ).write(to: file)
    do {
      _ = try WorkspaceConnection.read(file)
      preconditionFailure("Credential field was accepted")
    } catch ConnectionError.invalidFile {}
    let capabilities = [
      "tasks", "conversations", "notes", "planning", "files", "backups", "mcp-events",
    ].map(JSONValue.string)
    let metadata: JSONValue = .object([
      "product": .string("passforth"), "api_version": .int(1),
      "standard": .string("passforth.setup.v1"), "project_id": .string("project-one"),
      "capabilities": .array(capabilities),
    ])
    let confirmed = try connection.confirmed(by: metadata)
    precondition(confirmed == connection)
    var wrong = metadata.object
    wrong["project_id"] = .string("project-two")
    do {
      _ = try connection.confirmed(by: .object(wrong))
      preconditionFailure("Wrong backend was accepted")
    } catch ConnectionError.incompatible {}
    wrong = metadata.object
    wrong["api_version"] = .int(2)
    do {
      _ = try connection.confirmed(by: .object(wrong))
      preconditionFailure("Unsupported API was accepted")
    } catch ConnectionError.incompatible {}
    wrong = metadata.object
    wrong["capabilities"] = .array([])
    do {
      _ = try connection.confirmed(by: .object(wrong))
      preconditionFailure("Missing features were accepted")
    } catch ConnectionError.incompatible {}
    let other = try WorkspaceConnection(
      workspaceURL: "https://other.example.com", projectID: "project-two"
    ).validated()
    precondition(other.cacheNamespace != connection.cacheNamespace)

    let legacy = try LocalCache(directory: folder.appendingPathComponent("legacy"))
    var snapshot = DeskSnapshot()
    snapshot.viewerKey = String(repeating: "a", count: 64)
    snapshot.tasks = [
      DeskRecord([
        "task_key": .string("preserved"), "status": .string("paused"),
        "title": .string("Preserve my draft"), "version": .int(1),
      ])
    ]
    let mutation = DeskMutation(
      id: "stable-event", account: snapshot.viewerKey, path: "/api/tasks",
      body: ["task_key": .string("preserved")], targetType: "task", targetKey: "preserved",
      createdAt: DeskDates.iso())
    try legacy.saveState(snapshot: snapshot, mutations: [mutation])
    try JSONEncoder().encode(["workspace_url": connection.workspaceURL]).write(
      to: legacy.directory.appendingPathComponent("workspace-origin.json"))
    try legacy.write("draft:" + snapshot.viewerKey + ":capture", "Unsent local thought")
    try legacy.write("draft:another-account:capture", "Keep this separate")
    let destination = try LocalCache(
      directory: folder.appendingPathComponent(connection.cacheNamespace))
    try destination.importAccount(
      from: legacy, account: snapshot.viewerKey, origin: connection.workspaceURL)
    let restored: [DeskMutation] = try destination.read("outbox:" + snapshot.viewerKey)!
    let draft: String = try destination.read("draft:" + snapshot.viewerKey + ":capture")!
    let unrelated: String? = try destination.read("draft:another-account:capture")
    precondition(restored == [mutation] && draft == "Unsent local thought" && unrelated == nil)
    let untouched: String = try legacy.read("draft:" + snapshot.viewerKey + ":capture")!
    precondition(untouched == draft)
    let empty = try LocalCache(directory: folder.appendingPathComponent(other.cacheNamespace))
    try empty.importAccount(from: legacy, account: "different-viewer", origin: other.workspaceURL)
    let absent: String? = try empty.read("active_account")
    precondition(absent == nil)
    try destination.write("draft:" + snapshot.viewerKey + ":capture", "Newer destination draft")
    try destination.importAccount(
      from: legacy, account: snapshot.viewerKey, origin: connection.workspaceURL)
    let kept: String = try destination.read("draft:" + snapshot.viewerKey + ":capture")!
    precondition(kept == "Newer destination draft")
    print(
      "Workspace URL/file validation, API compatibility, cache isolation and lossless legacy migration passed."
    )
  }
}
