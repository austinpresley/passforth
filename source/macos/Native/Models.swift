import Foundation

indirect enum JSONValue: Codable, Equatable {
  case string(String)
  case number(Double)
  case bool(Bool)
  case object([String: JSONValue])
  case array([JSONValue])
  case null
  init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if c.decodeNil() {
      self = .null
    } else if let v = try? c.decode(Bool.self) {
      self = .bool(v)
    } else if let v = try? c.decode(String.self) {
      self = .string(v)
    } else if let v = try? c.decode(Double.self) {
      self = .number(v)
    } else if let v = try? c.decode([String: JSONValue].self) {
      self = .object(v)
    } else {
      self = .array(try c.decode([JSONValue].self))
    }
  }
  func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self {
    case .string(let v): try c.encode(v)
    case .number(let v): try c.encode(v)
    case .bool(let v): try c.encode(v)
    case .object(let v): try c.encode(v)
    case .array(let v): try c.encode(v)
    case .null: try c.encodeNil()
    }
  }
  var text: String {
    if case .string(let v) = self { return v }
    return ""
  }
  var integer: Int {
    if case .number(let v) = self { return Int(v) }
    return 0
  }
  var flag: Bool {
    if case .bool(let v) = self { return v }
    return integer != 0
  }
  var object: [String: JSONValue] {
    if case .object(let v) = self { return v }
    return [:]
  }
  var array: [JSONValue] {
    if case .array(let v) = self { return v }
    return []
  }
  subscript(_ key: String) -> JSONValue { object[key] ?? .null }
  static func int(_ value: Int) -> JSONValue { .number(Double(value)) }
  static func parse(_ data: Data) throws -> JSONValue {
    try JSONDecoder().decode(JSONValue.self, from: data)
  }
  func data() throws -> Data { try JSONEncoder().encode(self) }
}
struct DeskRecord: Codable, Equatable, Identifiable {
  var fields: [String: JSONValue]
  init(_ fields: [String: JSONValue]) { self.fields = fields }
  init(from decoder: Decoder) throws {
    fields = try decoder.singleValueContainer().decode([String: JSONValue].self)
  }
  func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    try c.encode(fields)
  }
  var id: String {
    if fields["status"] != nil && !text("task_key").isEmpty { return text("task_key") }
    return text("id").isEmpty ? text("task_key") : text("id")
  }
  func text(_ key: String) -> String { fields[key]?.text ?? "" }
  func int(_ key: String) -> Int { fields[key]?.integer ?? 0 }
  var title: String { text("title") }
  var version: Int { int("version") }
  var done: Bool { ["completed", "cancelled"].contains(text("status")) }
  var waiting: Bool { ["waiting", "blocked"].contains(text("status")) }
  var needsYou: Bool { !done && waiting && text("action_owner") == "user" }
  var unread: Bool { int("attention_version") > int("read_version") }
  var archived: Bool { fields["archived"]?.flag ?? false }
  mutating func apply(_ changes: [String: JSONValue]) { fields.merge(changes) { _, new in new } }
  var searchText: String {
    [
      "title", "summary", "next_step", "blocker", "details", "tags", "conversation_search",
      "project_search", "note_search",
    ].map(text).joined(separator: " ").lowercased()
  }
}
struct DeskWorkspace: Codable, Equatable {
  var areas: [DeskRecord] = []
  var projects: [DeskRecord] = []
  var notes: [DeskRecord] = []
  var noteLinks: [DeskRecord] = []
  var savedViews: [DeskRecord] = []
  var timeBlocks: [DeskRecord] = []
  var subscribed = false
  var pendingNotifications = 0
  var failedNotifications = 0
  init() {}
  init(_ json: JSONValue) {
    func records(_ key: String) -> [DeskRecord] { json[key].array.map { DeskRecord($0.object) } }
    areas = records("areas")
    projects = records("projects")
    notes = records("notes")
    noteLinks = records("note_links")
    savedViews = records("saved_views")
    timeBlocks = records("time_blocks")
    subscribed = json["delivery"]["subscribed"].flag
    pendingNotifications = json["delivery"]["pending_notifications"].integer
    failedNotifications = json["delivery"]["failed_notifications"].integer
  }
}
struct DeskThread: Codable, Equatable {
  var comments: [DeskRecord] = []
  var attachments: [DeskRecord] = []
  init() {}
  init(_ value: JSONValue) {
    comments = value["comments"].array.map { DeskRecord($0.object) }
    attachments = value["attachments"].array.map { DeskRecord($0.object) }
  }
}
struct DeskSnapshot: Codable {
  var viewerKey = ""
  var tasks: [DeskRecord] = []
  var workspace = DeskWorkspace()
  var threads: [String: DeskThread] = [:]
  var checkedAt = ""
}
struct DeskMutation: Codable, Identifiable, Equatable {
  var id: String
  var account: String
  var path: String
  var body: [String: JSONValue]
  var targetType: String
  var targetKey: String
  var createdAt: String
  var error = ""
  var blocked = false
  var conflict = false
  var isTask: Bool { path == "/api/tasks" }
  var isComment: Bool { body["action"]?.text == "comment" }
}
enum DeskDates {
  static func day(_ date: Date = Date()) -> String {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.dateFormat = "yyyy-MM-dd"
    return f.string(from: date)
  }
  static func parse(_ text: String) -> Date? {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f.date(from: text) ?? ISO8601DateFormatter().date(from: text)
  }
  static func date(_ day: String) -> Date {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.dateFormat = "yyyy-MM-dd"
    return f.date(from: day) ?? Date()
  }
  static func iso(_ date: Date = Date()) -> String { ISO8601DateFormatter().string(from: date) }
  static func week(_ anchor: Date) -> [Date] {
    var c = Calendar.current
    c.firstWeekday = 2
    let offset = (c.component(.weekday, from: anchor) + 5) % 7
    let start = c.startOfDay(for: c.date(byAdding: .day, value: -offset, to: anchor)!)
    return (0..<7).map { c.date(byAdding: .day, value: $0, to: start)! }
  }
}
func labelMatches(_ tags: String, _ label: String) -> Bool {
  label.isEmpty
    || tags.lowercased().split(whereSeparator: { $0.isWhitespace }).contains {
      $0 == label.lowercased() || $0.hasPrefix(label.lowercased() + "/")
    }
}
func taskMatches(_ task: DeskRecord, view: String, today: String, blocks: [DeskRecord] = []) -> Bool
{
  if view == "all" { return true }
  if task.done { return view == "completed" && task.text("status") == "completed" }
  let planned = task.text("planned_on")
  let due = task.text("deadline")
  let timed = blocks.contains {
    !$0.archived && $0.text("task_key") == task.id
      && DeskDates.parse($0.text("starts_at")).map {
        view == "today"
          ? DeskDates.day($0) == today : view == "upcoming" && DeskDates.day($0) > today
      } == true
  }
  switch view {
  case "inbox":
    return task.text("area_id").isEmpty && task.text("project_id").isEmpty
      && task.text("status") == "paused"
  case "today":
    return (!planned.isEmpty && planned <= today) || (!due.isEmpty && due <= today) || timed
  case "upcoming":
    return (!planned.isEmpty && planned > today) || (!due.isEmpty && due > today) || timed
  case "you": return task.needsYou
  case "dot": return task.text("action_owner") == "dot"
  case "waiting": return task.waiting && task.text("action_owner") != "user"
  case "anytime": return planned.isEmpty && !["paused", "scheduled"].contains(task.text("status"))
  case "later": return task.text("status") == "paused"
  default: return false
  }
}
let deskViews: [(String, String, String)] = [
  ("inbox", "Inbox", "tray"), ("today", "Today", "star"), ("upcoming", "Upcoming", "calendar"),
  ("you", "Needs you", "person.crop.circle.badge.exclamationmark"),
  ("dot", "With Dot", "circle.dotted"), ("waiting", "Waiting", "clock"),
  ("anytime", "Anytime", "square.stack"), ("later", "Later", "archivebox"),
  ("all", "All work", "list.bullet"), ("completed", "Completed", "checkmark.circle"),
]
let deskStatuses = [
  ("paused", "Saved for later"), ("working", "Reported in progress"), ("waiting", "Waiting"),
  ("blocked", "Blocked"), ("scheduled", "Scheduled"), ("completed", "Completed"),
  ("cancelled", "Cancelled"),
]
