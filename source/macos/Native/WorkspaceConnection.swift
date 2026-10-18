import CryptoKit
import Foundation

struct WorkspaceConnection: Codable, Equatable {
  var format = "passforth.workspace"
  var schemaVersion = 1
  var workspaceURL: String
  var projectID: String?
  var pluginID: String?
  var name: String?
  enum CodingKeys: String, CodingKey {
    case format, name
    case schemaVersion = "schema_version"
    case workspaceURL = "workspace_url"
    case projectID = "project_id"
    case pluginID = "plugin_id"
  }
  var url: URL { URL(string: workspaceURL)! }
  var cacheNamespace: String {
    "site-"
      + SHA256.hash(data: Data((projectID ?? workspaceURL).utf8)).map { String(format: "%02x", $0) }
      .joined()
  }
  func validated() throws -> WorkspaceConnection {
    guard format == "passforth.workspace", schemaVersion == 1,
      let parts = URLComponents(string: workspaceURL), parts.scheme == "https",
      let host = parts.host, !host.isEmpty, !host.hasSuffix(".invalid"),
      parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
      parts.port == nil || parts.port == 443, parts.path.isEmpty || parts.path == "/",
      (projectID?.count ?? 0) <= 250, (pluginID?.count ?? 0) <= 250, (name?.count ?? 0) <= 80
    else { throw ConnectionError.invalidFile }
    var value = self
    value.workspaceURL = "https://" + host.lowercased() + "/"
    return value
  }
  static func read(_ url: URL) throws -> WorkspaceConnection {
    let data = try Data(contentsOf: url)
    guard data.count <= 8192,
      let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      Set(json.keys).isSubset(of: [
        "format", "schema_version", "workspace_url", "project_id", "plugin_id", "name",
      ])
    else { throw ConnectionError.invalidFile }
    return try JSONDecoder().decode(Self.self, from: data).validated()
  }
  func confirmed(by value: JSONValue) throws -> WorkspaceConnection {
    guard value["product"].text == "passforth", value["api_version"].integer == 1,
      value["standard"].text == "passforth.setup.v1",
      Set(["tasks", "conversations", "notes", "planning", "files", "backups", "mcp-events"])
        .isSubset(of: Set(value["capabilities"].array.map(\.text))),
      !value["project_id"].text.isEmpty,
      projectID == nil || projectID == value["project_id"].text
    else { throw ConnectionError.incompatible }
    var result = self
    result.projectID = value["project_id"].text
    return result
  }
}

enum ConnectionError: LocalizedError {
  case invalidFile, incompatible, noWorkspace, busy
  var errorDescription: String? {
    switch self {
    case .invalidFile:
      return
        "Choose a Passforth connection file or an HTTPS workspace address. Connection files contain no passwords or tokens."
    case .incompatible:
      return
        "This workspace does not match the supported Passforth setup standard. Ask your setup agent to update and verify its backend."
    case .noWorkspace: return "Connect your private workspace to continue."
    case .busy:
      return
        "Finish syncing this workspace before changing connections. Your drafts and changes are kept."
    }
  }
}

@MainActor final class ConnectionPreferences {
  static let shared = ConnectionPreferences()
  private let defaults: UserDefaults
  private let key = "passforth.workspace.v1"
  init(defaults: UserDefaults = .standard) { self.defaults = defaults }
  var current: WorkspaceConnection? {
    guard let data = defaults.data(forKey: key),
      let decoded = try? JSONDecoder().decode(WorkspaceConnection.self, from: data)
    else { return nil }
    return try? decoded.validated()
  }
  func save(_ value: WorkspaceConnection) throws {
    defaults.set(try JSONEncoder().encode(value.validated()), forKey: key)
  }
}

@MainActor var dashboardURL: URL {
  ConnectionPreferences.shared.current?.url ?? URL(string: "https://unconfigured.invalid/")!
}
