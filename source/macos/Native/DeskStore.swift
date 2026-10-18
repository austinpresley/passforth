import Cocoa
import Combine
import Network
import UserNotifications

@MainActor final class DeskStore: ObservableObject {
  static let shared = DeskStore()
  @Published private(set) var connection = ConnectionPreferences.shared.current
  @Published var connectionPresented = false
  @Published var pendingConnection: WorkspaceConnection?
  @Published var connecting = false
  @Published var connectionError = ""
  private var connectionGeneration = 0
  @Published var snapshot = DeskSnapshot()
  @Published var mutations: [DeskMutation] = []
  @Published var route = "you" { didSet { rememberSelection() } }
  @Published var selectedTask: String? {
    didSet {
      rememberSelection()
      if let key = selectedTask { Task { await loadThread("task", key) } }
    }
  }
  @Published var selectedNote: String? {
    didSet {
      rememberSelection()
      if let key = selectedNote { Task { await loadThread("note", key) } }
    }
  }
  @Published var query = ""
  @Published var online = true
  @Published var refreshing = false
  @Published var needsSignIn = false
  @Published var error = ""
  @Published var notice = ""
  @Published var capturePresented = false
  @Published var settingsPresented = false
  @Published var queuePresented = false
  @Published var showNewNote = false
  @Published var weekAnchor = Date()
  @Published var fileBusy = false
  @Published var updateAvailable = false
  @Published private(set) var sendingId: String?
  let api = DeskAPI()
  private(set) var cache: LocalCache?
  private var verifiedAccount: String?
  private var flushing = false
  private var timer: Timer?
  private let monitor = NWPathMonitor()
  private var started = false
  private let forcedOffline = CommandLine.arguments.contains("--offline-preview")
  var signInAction: (() -> Void)?
  var quickCaptureAction: (() -> Void)?
  var showWorkspaceAction: (() -> Void)?
  var openSceneAction: (() -> Void)?
  init(cache: LocalCache? = nil) {
    do {
      self.cache = try cache ?? connection.map { try LocalCache(workspace: $0.cacheNamespace) }
      if let account: String = try self.cache?.read("active_account"), !account.isEmpty,
        let saved: DeskSnapshot = try self.cache?.read("snapshot:" + account)
      {
        snapshot = saved
        mutations = (try self.cache?.read("outbox:" + account)) ?? []
        restoreSelection()
      }
    } catch { self.error = error.localizedDescription }
  }
  var account: String { snapshot.viewerKey }
  var blockedCount: Int { mutations.filter(\.blocked).count }
  var statusText: String {
    if connection == nil { return "Connect your workspace" }
    if !error.isEmpty && cache == nil { return "Local storage unavailable" }
    if needsSignIn { return "Sign in to sync" }
    if blockedCount > 0 { return "\(blockedCount) changes need review" }
    if !error.isEmpty && online {
      return mutations.isEmpty
        ? "Saved on this Mac · Could not refresh" : "Saved on this Mac · Waiting to retry"
    }
    if !mutations.isEmpty {
      return online
        ? "\(mutations.count) changes syncing…" : "Saved on this Mac · Waiting for connection"
    }
    if !online { return snapshot.tasks.isEmpty ? "Offline" : "Saved on this Mac · Offline" }
    if verifiedAccount != account {
      return snapshot.tasks.isEmpty ? "Connecting…" : "Saved on this Mac · Connecting…"
    }
    return refreshing && snapshot.tasks.isEmpty
      ? "Connecting…" : snapshot.checkedAt.isEmpty ? "Connecting…" : "Saved on this Mac · Synced"
  }
  var displayTasks: [DeskRecord] {
    var tasks = snapshot.tasks
    for item in mutations where item.isTask {
      if let i = tasks.firstIndex(where: { $0.id == item.targetKey }) {
        tasks[i].apply(item.body)
      } else if item.body["title"] != nil {
        var fields = item.body
        fields["created_at"] = .string(item.createdAt)
        fields["version"] = .int(0)
        tasks.append(DeskRecord(fields))
      }
    }
    for item in mutations where item.path == "/api/tasks/read" {
      if let index = tasks.firstIndex(where: { $0.id == item.targetKey }) {
        tasks[index].fields["read_version"] = .int(
          max(tasks[index].int("read_version"), item.body["attention_version"]?.integer ?? 0))
      }
    }
    return tasks.sorted {
      if $0.done != $1.done { return !$0.done }
      return ($0.text("created_at"), $0.id) < ($1.text("created_at"), $1.id)
    }
  }
  var workspace: DeskWorkspace {
    var space = snapshot.workspace
    func merging(_ rows: [DeskRecord], _ item: DeskMutation) -> [DeskRecord] {
      var rows = rows
      var fields = item.body
      fields["id"] = .string(item.targetKey)
      if let index = rows.firstIndex(where: {
        $0.id == item.targetKey || $0.id.hasSuffix(":" + item.targetKey)
      }) {
        fields["id"] = .string(rows[index].id)
        rows[index].apply(fields)
      } else {
        fields["version"] = .int(0)
        rows.append(DeskRecord(fields))
      }
      return rows
    }
    for item in mutations where !item.isTask && !item.isComment {
      switch item.body["action"]?.text {
      case "note":
        space.notes = merging(space.notes, item)
        space.noteLinks.removeAll { $0.text("note_id") == item.targetKey }
        for (index, link) in (item.body["links"]?.array ?? []).enumerated() {
          var values = link.object
          values["id"] = .string(item.id + ":" + String(index))
          values["note_id"] = .string(item.targetKey)
          space.noteLinks.append(DeskRecord(values))
        }
      case "entity":
        if item.body["type"]?.text == "area" {
          space.areas = merging(space.areas, item)
        } else {
          space.projects = merging(space.projects, item)
        }
      case "view":
        var copy = item
        if let filters = item.body["filters"], let data = try? filters.data() {
          copy.body["filters"] = .string(String(decoding: data, as: UTF8.self))
        }
        space.savedViews = merging(space.savedViews, copy)
      case "block": space.timeBlocks = merging(space.timeBlocks, item)
      default: break
      }
    }
    return space
  }
  var needsYou: [DeskRecord] { displayTasks.filter(\.needsYou) }
  var routeTitle: String {
    if let view = deskViews.first(where: { $0.0 == route }) { return view.1 }
    if route == "notes" { return "Notes" }
    if route == "daily" { return "Daily Notes" }
    if route == "week" { return "Week" }
    if route.hasPrefix("project:") {
      return workspace.projects.first { $0.id == String(route.dropFirst(8)) }?.title ?? "Project"
    }
    if route.hasPrefix("area:") {
      return workspace.areas.first { $0.id == String(route.dropFirst(5)) }?.title ?? "Area"
    }
    if route.hasPrefix("saved:") {
      return workspace.savedViews.first { $0.id == String(route.dropFirst(6)) }?.title
        ?? "Saved view"
    }
    return "All work"
  }
  var filteredTasks: [DeskRecord] {
    let today = DeskDates.day()
    var filter: [String: JSONValue] = [:]
    if route.hasPrefix("saved:"),
      let saved = workspace.savedViews.first(where: { $0.id == String(route.dropFirst(6)) }),
      let data = saved.text("filters").data(using: .utf8)
    {
      filter = (try? JSONValue.parse(data))?.object ?? [:]
    }
    let text = (query + " " + (filter["query"]?.text ?? "")).lowercased().split(whereSeparator: {
      $0.isWhitespace
    })
    return displayTasks.filter { task in
      let match: Bool
      if route.hasPrefix("project:") {
        match = task.text("project_id") == String(route.dropFirst(8))
      } else if route.hasPrefix("area:") {
        match = task.text("area_id") == String(route.dropFirst(5))
      } else {
        match = taskMatches(
          task, view: filter["view"]?.text ?? route, today: today, blocks: workspace.timeBlocks)
      }
      return match && text.allSatisfy { task.searchText.contains($0) }
        && ((filter["area_id"]?.text ?? "").isEmpty
          || task.text("area_id") == filter["area_id"]?.text)
        && ((filter["project_id"]?.text ?? "").isEmpty
          || task.text("project_id") == filter["project_id"]?.text)
        && labelMatches(task.text("tags"), filter["label"]?.text ?? "")
        && task.int("priority") >= (filter["priority_min"]?.integer ?? 0)
        && (filter["scope"]?.text != "new" || task.unread)
        && (filter["scope"]?.text != "unknown"
          || task.waiting && ["", "unknown"].contains(task.text("action_owner")))
    }
  }
  @discardableResult func connect(_ candidate: WorkspaceConnection, openSignIn: Bool = true) async
    -> Bool
  {
    guard !connecting, !refreshing, !flushing, !fileBusy, mutations.isEmpty else {
      connectionError = ConnectionError.busy.localizedDescription
      return false
    }
    guard !forcedOffline else {
      connectionError = "Connect to the internet to add a workspace."
      return false
    }
    connecting = true
    connectionGeneration += 1
    defer { connecting = false }
    do {
      let candidate = try candidate.validated()
      pendingConnection = candidate
      let metadata = try await api.request("/api/instance", base: candidate.url)
      let confirmed = try candidate.confirmed(by: metadata)
      let records = try await api.request("/api/tasks", base: confirmed.url)
      let space = try await api.request("/api/workspace", base: confirmed.url)
      let viewer = records["viewer_key"].text
      guard viewer.count == 64 else { throw ConnectionError.incompatible }
      let destination = try LocalCache(workspace: confirmed.cacheNamespace)
      // The platform viewer digest is Site-specific. Import the legacy cache only
      // after this backend confirms the same account. Keep the legacy DB intact.
      if let legacy = try? LocalCache() {
        try destination.importAccount(from: legacy, account: viewer, origin: confirmed.workspaceURL)
      }
      var next: DeskSnapshot = (try destination.read("snapshot:" + viewer)) ?? DeskSnapshot()
      next.viewerKey = viewer
      next.tasks = records["tasks"].array.map { DeskRecord($0.object) }
      next.workspace = DeskWorkspace(space)
      next.checkedAt = records["checked_at"].text
      let outbox: [DeskMutation] = (try destination.read("outbox:" + viewer)) ?? []
      try destination.saveState(snapshot: next, mutations: outbox)
      try ConnectionPreferences.shared.save(confirmed)
      cache = destination
      connection = confirmed
      snapshot = next
      mutations = outbox
      selectedTask = nil
      selectedNote = nil
      restoreSelection()
      verifiedAccount = viewer
      needsSignIn = false
      pendingConnection = nil
      connectionError = ""
      error = ""
      online = true
      connectionPresented = false
      Task { await refresh() }
      return true
    } catch {
      connectionError = error.localizedDescription
      if let failure = error as? DeskAPIError, failure.authentication, openSignIn {
        connectionError =
          "Sign in to this workspace, then the app will finish checking the connection."
        signInAction?()
      }
      return false
    }
  }
  func importConnection(_ url: URL) {
    do {
      let value = try WorkspaceConnection.read(url)
      connectionPresented = true
      Task { await connect(value) }
    } catch {
      connectionError = error.localizedDescription
      connectionPresented = true
    }
  }
  func start() {
    guard !CommandLine.arguments.contains("--export-verification"), !started else { return }
    started = true
    if connection == nil { connectionPresented = true }
    if CommandLine.arguments.contains("--offline-preview") {
      online = false
      return
    }
    monitor.pathUpdateHandler = { [weak self] path in
      Task { @MainActor in
        self?.online = path.status == .satisfied
        if path.status == .satisfied { await self?.refresh() }
      }
    }
    monitor.start(queue: DispatchQueue(label: "com.apresley.dotdesk.connection"))
    timer = Timer.scheduledTimer(withTimeInterval: 20, repeats: true) { [weak self] _ in
      Task { @MainActor in
        await self?.refresh()
        if let key = self?.selectedTask { await self?.loadThread("task", key) }
        if let key = self?.selectedNote { await self?.loadThread("note", key) }
      }
    }
    Task { await refresh() }
  }
  func refresh() async {
    guard !forcedOffline else {
      online = false
      return
    }
    guard connection != nil, !connecting, !refreshing else { return }
    let generation = connectionGeneration
    refreshing = true
    defer { refreshing = false }
    do {
      if let connection { _ = try connection.confirmed(by: await api.request("/api/instance")) }
      let result = try await api.request("/api/tasks")
      guard generation == connectionGeneration else { return }
      let viewer = result["viewer_key"].text
      guard viewer.count == 64 else {
        throw DeskAPIError(status: 502, message: "The server did not confirm your account.")
      }
      if viewer != account {
        verifiedAccount = nil
        snapshot = (try cache?.read("snapshot:" + viewer)) ?? DeskSnapshot()
        snapshot.viewerKey = viewer
        mutations = (try cache?.read("outbox:" + viewer)) ?? []
        selectedTask = nil
        selectedNote = nil
        restoreSelection()
      }
      snapshot.tasks = result["tasks"].array.map { DeskRecord($0.object) }
      snapshot.checkedAt = result["checked_at"].text
      let space = try await api.request("/api/workspace")
      guard generation == connectionGeneration else { return }
      snapshot.workspace = DeskWorkspace(space)
      verifiedAccount = viewer
      needsSignIn = false
      online = true
      error = ""
      try persist()
      await flush()
      let awaiting = snapshot.threads.filter { _, thread in
        thread.comments.contains {
          $0.text("kind") == "request"
            && ["queued", "acknowledged"].contains($0.text("request_state"))
        }
      }.map(\.key)
      for target in awaiting.prefix(8) {
        let parts = target.split(separator: ":", maxSplits: 1).map(String.init)
        if parts.count == 2 { await loadThread(parts[0], parts[1]) }
      }
    } catch { if generation == connectionGeneration { handle(error) } }
  }
  func loadThread(_ type: String, _ key: String) async {
    guard !connecting, !forcedOffline, !key.isEmpty, !account.isEmpty else { return }
    if type == "task", !snapshot.tasks.contains(where: { $0.id == key }) { return }
    if type == "note", !snapshot.workspace.notes.contains(where: { $0.id == key }) { return }
    if type == "project", !snapshot.workspace.projects.contains(where: { $0.id == key }) { return }
    let generation = connectionGeneration
    let scope = account
    do {
      let result = try await api.request(
        "/api/workspace?target_type=" + type + "&target_key=" + key.addingPercentEncoding(
          withAllowedCharacters: .urlQueryAllowed)!)
      guard generation == connectionGeneration, scope == account else { return }
      let thread = DeskThread(result)
      let old = snapshot.threads[type + ":" + key]
      if old != nil {
        let oldIds = Set(old!.comments.map(\.id))
        for comment in thread.comments
        where comment.text("author_kind") == "agent" && !oldIds.contains(comment.id) {
          notifyReply(comment, type: type, key: key)
        }
      }
      snapshot.threads[type + ":" + key] = thread
      try persist()
    } catch { if generation == connectionGeneration && !(error is URLError) { handle(error) } }
  }
  func thread(_ type: String, _ key: String) -> DeskThread {
    var thread = snapshot.threads[type + ":" + key] ?? DeskThread()
    for mutation in mutations
    where mutation.isComment && mutation.targetType == type && mutation.targetKey == key {
      if !thread.comments.contains(where: { $0.id.hasSuffix(mutation.id) }) {
        thread.comments.append(
          DeskRecord([
            "id": .string("local:" + mutation.id), "body": mutation.body["body"] ?? .string(""),
            "kind": mutation.body["kind"] ?? .string("reference"), "author": .string("You"),
            "author_kind": .string("user"), "created_at": .string(mutation.createdAt),
            "local_pending": .bool(true), "local_error": .string(mutation.error),
          ]))
      }
    }
    return thread
  }
  @discardableResult func enqueue(
    path: String, body: [String: JSONValue], type: String, key: String
  ) -> Bool {
    guard !connecting else {
      error = "Finish connecting before saving. Your draft is kept."
      return false
    }
    guard cache != nil else {
      error = "Local storage is unavailable. Your draft is kept in the editor."
      return false
    }
    guard !account.isEmpty else {
      error = "Sign in once before saving work on this Mac."
      return false
    }
    if body["action"]?.text != "comment",
      mutations.contains(where: { $0.targetKey == key && $0.targetType == type && !$0.isComment })
    {
      error = "This item has an unsynced change. Open Sync changes to review it first."
      queuePresented = true
      return false
    }
    let id = body["event_id"]?.text ?? UUID().uuidString.lowercased()
    let mutation = DeskMutation(
      id: id, account: account, path: path, body: body, targetType: type, targetKey: key,
      createdAt: DeskDates.iso())
    let next = mutations + [mutation]
    do {
      try cache!.saveState(snapshot: snapshot, mutations: next)
      mutations = next
      error = ""
      Task { await refresh() }
      return true
    } catch {
      self.error = error.localizedDescription
      return false
    }
  }
  @discardableResult func capture(_ title: String) -> Bool {
    let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !title.isEmpty, title.count <= 200 else { return false }
    let key = "capture-" + UUID().uuidString.lowercased()
    let ok = enqueue(
      path: "/api/tasks",
      body: [
        "task_key": .string(key), "title": .string(title), "status": .string("paused"),
        "summary": .string("Saved for later. Dot has not accepted this task."),
        "action_owner": .string("unknown"), "expected_version": .int(0),
        "event_id": .string(UUID().uuidString.lowercased()),
      ], type: "task", key: key)
    if ok { showNotice("Saved in Inbox") }
    return ok
  }
  @discardableResult func updateTask(_ task: DeskRecord, _ changes: [String: JSONValue]) -> Bool {
    var body = changes
    body["task_key"] = .string(task.id)
    body["expected_version"] = .int(task.version)
    body["event_id"] = .string(UUID().uuidString.lowercased())
    return enqueue(path: "/api/tasks", body: body, type: "task", key: task.id)
  }
  @discardableResult func comment(_ text: String, type: String, key: String, request: Bool) -> Bool
  {
    let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty, text.count <= 20000 else { return false }
    if pending(type, key) {
      error = "Sync this item's changes before sending a comment. Your draft is kept on this Mac."
      return false
    }
    return enqueue(
      path: "/api/workspace",
      body: [
        "action": .string("comment"), "body": .string(text), "target_type": .string(type),
        "target_key": .string(key), "kind": .string(request ? "request" : "reference"),
        "event_id": .string(UUID().uuidString.lowercased()),
      ], type: type, key: key)
  }
  func flush() async {
    guard !connecting, connection != nil, !flushing, verifiedAccount == account, !needsSignIn else {
      return
    }
    let generation = connectionGeneration
    flushing = true
    defer { flushing = false }
    while let item = mutations.first(where: { !$0.blocked }) {
      guard generation == connectionGeneration, item.account == account, verifiedAccount == account,
        !needsSignIn
      else { return }
      sendingId = item.id
      defer { sendingId = nil }
      do {
        let result = try await api.request(item.path, body: item.body)
        guard generation == connectionGeneration, item.account == account else { return }
        let previousSnapshot = snapshot
        let previousMutations = mutations
        do {
          try snapshot.confirm(item, response: result)
          let record = result["record"].object.isEmpty ? result : result["record"]
          if !item.isTask && !item.isComment && item.path != "/api/tasks/read",
            record["id"].text != item.targetKey
          {
            remap(item.targetKey, to: record["id"].text, version: record["version"].integer)
          }
          mutations.removeAll { $0.id == item.id }
          try persist()
        } catch {
          snapshot = previousSnapshot
          mutations = previousMutations
          throw error
        }
        // The acknowledgement and outbox removal are committed before any follow-up read.
        if item.isComment { await loadThread(item.targetType, item.targetKey) }

      } catch {
        guard generation == connectionGeneration, item.account == account else { return }
        if let index = mutations.firstIndex(where: { $0.id == item.id }) {
          mutations[index].error = error.localizedDescription
          if let failure = error as? DeskAPIError, failure.permanent {
            mutations[index].blocked = true
            mutations[index].conflict = failure.status == 409
          }
          try? persist()
        }
        handle(error)
        return
      }
    }
  }
  func retry(_ item: DeskMutation, rebase: Bool = false) {
    guard item.id != sendingId, let index = mutations.firstIndex(where: { $0.id == item.id }) else {
      return
    }
    if rebase {
      let records: [DeskRecord]
      switch item.targetType {
      case "task": records = snapshot.tasks
      case "note": records = snapshot.workspace.notes
      case "area": records = snapshot.workspace.areas
      case "view": records = snapshot.workspace.savedViews
      case "block": records = snapshot.workspace.timeBlocks
      default: records = snapshot.workspace.projects
      }
      guard let record = records.first(where: { $0.id == item.targetKey }) else { return }
      mutations[index].body["expected_version"] = .int(record.version)
      let id = UUID().uuidString.lowercased()
      mutations[index].id = id
      if mutations[index].body["event_id"] != nil {
        mutations[index].body["event_id"] = .string(id)
      }
    }
    mutations[index].blocked = false
    mutations[index].error = ""
    do {
      try persist()
      Task { await refresh() }
    } catch { self.error = error.localizedDescription }
  }
  func discard(_ item: DeskMutation) {
    guard item.id != sendingId, let cache else { return }
    do {
      var history: [DeskMutation] = (try cache.read("discarded:" + account)) ?? []
      history.removeAll { $0.id == item.id }
      history.append(item)
      try cache.write("discarded:" + account, history)
      let next = mutations.filter { $0.id != item.id }
      try cache.saveState(snapshot: snapshot, mutations: next)
      mutations = next
      NSApp.keyWindow?.undoManager?.registerUndo(withTarget: self) { target in
        Task { @MainActor in target.restoreDiscarded(item) }
      }
      NSApp.keyWindow?.undoManager?.setActionName("Remove Local Retry")
    } catch { self.error = error.localizedDescription }
  }
  var discardedChanges: [DeskMutation] {
    ((try? cache?.read("discarded:" + account, as: [DeskMutation].self)) ?? []).reversed()
  }
  func restoreDiscarded(_ item: DeskMutation) {
    guard item.account == account, !mutations.contains(where: { $0.id == item.id }), let cache
    else { return }
    do {
      var value = item
      value.blocked = true
      value.error = "Restored local change. Review before retrying."
      let next = mutations + [value]
      try cache.saveState(snapshot: snapshot, mutations: next)
      mutations = next
      var history: [DeskMutation] = (try cache.read("discarded:" + account)) ?? []
      history.removeAll { $0.id == item.id }
      try cache.write("discarded:" + account, history)
    } catch { self.error = error.localizedDescription }
  }
  func pending(_ type: String, _ key: String) -> Bool {
    mutations.contains {
      $0.targetType == type && ($0.targetKey == key || key.hasSuffix(":" + $0.targetKey))
        && !$0.isComment
    }
  }
  func markRead(_ task: DeskRecord) {
    guard task.unread, task.int("attention_version") > 0, let cache, !account.isEmpty else {
      return
    }
    var nextSnapshot = snapshot
    guard let index = nextSnapshot.tasks.firstIndex(where: { $0.id == task.id }) else { return }
    nextSnapshot.tasks[index].fields["read_version"] = .int(task.int("attention_version"))
    var next = mutations
    let body: [String: JSONValue] = [
      "task_key": .string(task.id), "attention_version": .int(task.int("attention_version")),
    ]
    if let i = next.firstIndex(where: {
      $0.path == "/api/tasks/read" && $0.targetKey == task.id && $0.id != sendingId
    }) {
      next[i].body = body
    } else {
      next.append(
        DeskMutation(
          id: UUID().uuidString.lowercased(), account: account, path: "/api/tasks/read", body: body,
          targetType: "read", targetKey: task.id, createdAt: DeskDates.iso()))
    }
    do {
      try cache.saveState(snapshot: nextSnapshot, mutations: next)
      snapshot = nextSnapshot
      mutations = next
      Task { await refresh() }
    } catch { self.error = error.localizedDescription }
  }
  func draft(_ key: String) -> String {
    (try? cache?.read("draft:" + account + ":" + key, as: String.self)) ?? ""
  }
  func saveDraft(_ key: String, _ text: String) {
    guard !account.isEmpty else { return }
    do { try cache?.write("draft:" + account + ":" + key, text) } catch {
      self.error = error.localizedDescription
    }
  }
  func loadDraft<T: Decodable>(_ key: String, as: T.Type) -> T? {
    try? cache?.read("draft:" + account + ":" + key, as: T.self)
  }
  func persistDraft<T: Encodable>(_ key: String, _ value: T) {
    do { try cache?.write("draft:" + account + ":" + key, value) } catch {
      self.error = error.localizedDescription
    }
  }
  func clearDraft(_ key: String) { try? cache?.remove("draft:" + account + ":" + key) }
  func linkedNotes(_ type: String, _ key: String) -> [DeskRecord] {
    workspace.notes.filter { note in
      !note.archived
        && workspace.noteLinks.contains {
          $0.text("note_id") == note.id && $0.text("target_type") == type
            && $0.text("target_key") == key
        }
    }
  }
  func openTask(_ key: String) {
    if ["notes", "daily"].contains(route) {
      route = "all"
      query = ""
    }
    selectedTask = key
    showWorkspaceAction?()
  }
  func openNote(_ key: String) {
    route = "notes"
    query = ""
    selectedNote = key
    showWorkspaceAction?()
  }
  private func remap(_ old: String, to new: String, version: Int) {
    if var draft: [String: JSONValue] = try? cache?.read("draft:" + account + ":note-edit:" + old) {
      draft["draft_version"] = .int(version)
      try? cache?.write("draft:" + account + ":note-edit:" + new, draft)
      try? cache?.remove("draft:" + account + ":note-edit:" + old)
    }
    if selectedNote == old { selectedNote = new }
    if route == "project:" + old { route = "project:" + new }
    if route == "area:" + old { route = "area:" + new }
    if route == "saved:" + old { route = "saved:" + new }
    for index in mutations.indices {
      if mutations[index].targetKey == old { mutations[index].targetKey = new }
      for field in ["id", "area_id", "project_id", "target_key"]
      where mutations[index].body[field]?.text == old {
        mutations[index].body[field] = .string(new)
      }
      if let links = mutations[index].body["links"]?.array {
        mutations[index].body["links"] = .array(
          links.map { link in
            var value = link.object
            if value["target_key"]?.text == old { value["target_key"] = .string(new) }
            return .object(value)
          })
      }
    }
  }
  func showNotice(_ message: String) {
    notice = message
    Task {
      try? await Task.sleep(nanoseconds: 4_000_000_000)
      if notice == message { notice = "" }
    }
  }
  func persist() throws { try cache?.saveState(snapshot: snapshot, mutations: mutations) }
  func handle(_ failure: Error) {
    if let api = failure as? DeskAPIError, api.authentication {
      needsSignIn = true
      verifiedAccount = nil
    }
    if failure is URLError { online = false }
    error = failure.localizedDescription
  }
  private func rememberSelection() {
    guard !connecting, !account.isEmpty else { return }
    try? cache?.write(
      "selection:" + account,
      ["route": route, "task": selectedTask ?? "", "note": selectedNote ?? ""])
  }
  private func restoreSelection() {
    if let saved: [String: String] = try? cache?.read("selection:" + account) {
      route = saved["route"] ?? "you"
      selectedTask = saved["task"].flatMap { $0.isEmpty ? nil : $0 }
      selectedNote = saved["note"].flatMap { $0.isEmpty ? nil : $0 }
    }
  }
  func enableNotifications() {
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) {
      granted, _ in UserDefaults.standard.set(granted, forKey: "nativeReplyNotifications")
    }
  }
  private func notifyReply(_ comment: DeskRecord, type: String, key: String) {
    guard UserDefaults.standard.bool(forKey: "nativeReplyNotifications"), !NSApp.isActive else {
      return
    }
    let content = UNMutableNotificationContent()
    content.title = "Dot replied"
    content.body = "Open Passforth to read the reply."
    content.userInfo = [
      "target_type": type, "target_key": key, "workspace": connection?.cacheNamespace ?? "",
    ]
    UNUserNotificationCenter.current().add(
      UNNotificationRequest(identifier: comment.id, content: content, trigger: nil))
  }
  func attach(_ url: URL, type: String, key: String) async {
    guard !connecting, online, !forcedOffline, !needsSignIn else {
      error = "Connect to attach a file. Your comment draft is kept."
      return
    }
    guard !fileBusy else { return }
    fileBusy = true
    defer { fileBusy = false }
    do {
      try await api.upload(url, type: type, key: key)
      await loadThread(type, key)
      notice = "File attached"
    } catch {
      self.error =
        "Upload not confirmed. Refresh the conversation before retrying. "
        + error.localizedDescription
      await loadThread(type, key)
    }
  }
  func download(_ file: DeskRecord) async {
    do {
      let encoded = file.id.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed)!
      let (data, _) = try await api.bytes("/api/files?id=" + encoded)
      let panel = NSSavePanel()
      panel.nameFieldStringValue = (file.text("filename") as NSString).lastPathComponent
      if panel.runModal() == .OK, let url = panel.url { try data.write(to: url, options: .atomic) }
    } catch { self.error = error.localizedDescription }
  }
  func cancelRequest(_ id: String, type: String, key: String) {
    Task {
      do {
        _ = try await api.request(
          "/api/workspace", body: ["action": .string("cancel_request"), "request_id": .string(id)])
        await loadThread(type, key)
      } catch { self.error = error.localizedDescription }
    }
  }
}
