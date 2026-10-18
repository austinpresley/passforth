import CryptoKit
import Foundation

@MainActor enum VerificationExport {
  static func run(to directory: URL) async throws {
    guard let connection = ConnectionPreferences.shared.current else {
      throw ConnectionError.noWorkspace
    }
    if FileManager.default.fileExists(atPath: directory.path),
      !(try FileManager.default.contentsOfDirectory(atPath: directory.path)).isEmpty
    {
      throw ConnectionError.invalidFile
    }
    try FileManager.default.createDirectory(
      at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
    func save(_ data: Data, name: String) throws {
      let target = directory.appendingPathComponent(name)
      try data.write(to: target, options: .atomic)
      try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: target.path)
    }
    let api = DeskAPI()
    let metadata = try await api.request("/api/instance")
    _ = try connection.confirmed(by: metadata)
    try save(metadata.data(), name: "instance.json")
    let records = try await api.request("/api/workspace?export=1")
    try save(records.data(), name: "records.json")
    let space = try await api.request("/api/workspace")
    try save(space.data(), name: "workspace.json")
    let files = directory.appendingPathComponent("files", isDirectory: true)
    try FileManager.default.createDirectory(
      at: files, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let allowed = CharacterSet(
      charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~")
    var hashes: [String: JSONValue] = [:]
    for file in records["tables"]["attachments"].array {
      let id = file["id"].text
      guard !id.isEmpty, let encoded = id.addingPercentEncoding(withAllowedCharacters: allowed)
      else { throw ConnectionError.incompatible }
      let (bytes, _) = try await api.bytes("/api/files?id=" + encoded)
      try save(bytes, name: "files/" + encoded)
      hashes[id] = .string(SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined())
    }
    try save(JSONValue.object(hashes).data(), name: "files-sha256.json")
    let summary: JSONValue = .object([
      "verified_app_path": .string(Bundle.main.bundleURL.path),
      "standard": .string("passforth.setup.v1"),
      "client_version": .string(
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""),
      "workspace_url": .string(connection.workspaceURL),
      "cache_namespace": .string(connection.cacheNamespace),
      "project_id": .string(connection.projectID ?? ""),
      "task_count": .int(records["tables"]["tasks"].array.count),
      "attachment_count": .int(records["tables"]["attachments"].array.count),
    ])
    try save(summary.data(), name: "client.json")
  }
}
