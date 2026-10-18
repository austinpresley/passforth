import SwiftUI

struct CaptureSheet: View {
  @ObservedObject var store: DeskStore
  @Environment(\.dismiss) var dismiss
  @State private var title = ""
  @FocusState private var focused: Bool
  var onSaved: (() -> Void)? = nil
  var onClose: (() -> Void)? = nil
  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("Quick capture").font(.title3.weight(.semibold))
      TextField("What do you want to remember?", text: $title).textFieldStyle(.roundedBorder)
        .focused($focused).onSubmit(save).accessibilityLabel("Task title")
      HStack {
        Text("Saved in Inbox. Send Dot a request when you want action.").font(.caption)
          .foregroundStyle(.secondary)
        Spacer()
        Button("Cancel") {
          onClose?()
          dismiss()
        }.keyboardShortcut(.cancelAction)
        Button("Save", action: save).keyboardShortcut(.defaultAction).disabled(
          title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || title.count > 200)
      }
      if !store.error.isEmpty { Text(store.error).font(.caption).foregroundStyle(.orange) }
    }.padding(22).frame(width: 500).onAppear {
      title = store.draft("capture")
      focused = true
    }.onChange(of: title) { store.saveDraft("capture", $0) }
  }
  func save() {
    if store.capture(title) {
      store.saveDraft("capture", "")
      onSaved?()
      dismiss()
    }
  }
}
struct TaskEditSheet: View {
  @ObservedObject var store: DeskStore
  let task: DeskRecord
  @Environment(\.dismiss) var dismiss
  @State private var fields: [String: JSONValue]
  @State private var baseVersion: Int
  @State private var planned: Bool
  @State private var plannedDate: Date
  @State private var deadline: Bool
  @State private var deadlineDate: Date
  @State private var checkin: Bool
  @State private var checkinDate: Date
  @State private var didSave = false
  init(store: DeskStore, task: DeskRecord) {
    self.store = store
    self.task = task
    let saved = store.loadDraft("task-edit:" + task.id, as: [String: JSONValue].self)
    let value = task.fields.merging(saved ?? [:]) { _, new in new }
    _fields = State(initialValue: value)
    _baseVersion = State(initialValue: saved?["draft_version"]?.integer ?? task.version)
    _planned = State(initialValue: !(value["planned_on"]?.text ?? "").isEmpty)
    _plannedDate = State(initialValue: DeskDates.date(value["planned_on"]?.text ?? ""))
    _deadline = State(initialValue: !(value["deadline"]?.text ?? "").isEmpty)
    _deadlineDate = State(initialValue: DeskDates.date(value["deadline"]?.text ?? ""))
    _checkin = State(initialValue: !(value["next_check_at"]?.text ?? "").isEmpty)
    _checkinDate = State(
      initialValue: DeskDates.parse(value["next_check_at"]?.text ?? "")
        ?? Date().addingTimeInterval(3600))
  }
  func text(_ key: String) -> Binding<String> {
    Binding(get: { fields[key]?.text ?? "" }, set: { fields[key] = .string($0) })
  }
  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Text("Edit task").font(.title3.weight(.semibold))
        Spacer()
        Text("Draft saved on this Mac").font(.caption).foregroundStyle(.secondary)
      }.padding(20)
      Form {
        Section {
          TextField("Title", text: text("title"))
          TextField("Summary", text: text("summary"), axis: .vertical).lineLimit(2...5)
          Picker("Status", selection: text("status")) {
            ForEach(deskStatuses, id: \.0) { Text($0.1).tag($0.0) }
          }
          Picker("Who can act", selection: text("action_owner")) {
            Text("You").tag("user")
            Text("Dot").tag("dot")
            Text("Someone else").tag("external")
            Text("Not specified").tag("unknown")
          }
          if ["waiting", "blocked"].contains(fields["status"]?.text ?? "") {
            TextField("What is needed", text: text("blocker"), axis: .vertical).lineLimit(2...4)
          }
          TextField("Next step", text: text("next_step"), axis: .vertical).lineLimit(1...3)
        }
        Section("Organization") {
          Picker("Area", selection: text("area_id")) {
            Text("No area").tag("")
            ForEach(store.workspace.areas.filter { !$0.archived }) { Text($0.title).tag($0.id) }
          }
          Picker("Project", selection: text("project_id")) {
            Text("No project").tag("")
            ForEach(store.workspace.projects.filter { !$0.archived }) { Text($0.title).tag($0.id) }
          }.onChange(of: fields["project_id"]?.text) { key in
            if let project = store.workspace.projects.first(where: { $0.id == key }) {
              fields["area_id"] = .string(project.text("area_id"))
            }
          }
          Picker(
            "Priority",
            selection: Binding(
              get: { fields["priority"]?.integer ?? 0 }, set: { fields["priority"] = .int($0) })
          ) {
            Text("None").tag(0)
            Text("Low").tag(1)
            Text("Medium").tag(2)
            Text("High").tag(3)
          }
          TextField("Labels", text: text("tags"))
        }
        Section("Planning") {
          Toggle("Plan a day", isOn: $planned)
          if planned {
            DatePicker("Planned day", selection: $plannedDate, displayedComponents: .date)
          }
          Toggle("Finish by a deadline", isOn: $deadline)
          if deadline {
            DatePicker("Deadline", selection: $deadlineDate, displayedComponents: .date)
          }
          Toggle("Promised check-in", isOn: $checkin)
          if checkin { DatePicker("Check-in", selection: $checkinDate) }
          Text("A planned day, deadline and check-in are separate commitments.").font(.caption)
            .foregroundStyle(.secondary)
        }
        Section("Checklist") {
          TextEditor(
            text: Binding(
              get: {
                guard let data = fields["checklist"]?.text.data(using: .utf8),
                  let value = try? JSONValue.parse(data)
                else { return "" }
                return value.array.map { $0["text"].text }.joined(separator: "\n")
              },
              set: { value in
                let old =
                  fields["checklist"]?.text.data(using: .utf8).flatMap { try? JSONValue.parse($0) }?
                  .array ?? []
                let items = value.components(separatedBy: "\n").map { line in
                  JSONValue.object([
                    "text": .string(line),
                    "done": .bool(old.first { $0["text"].text == line }?["done"].flag ?? false),
                  ])
                }
                if let data = try? JSONValue.array(items).data() {
                  fields["checklist"] = .string(String(decoding: data, as: UTF8.self))
                }
              })
          ).frame(minHeight: 100)
          Text("One step per line.").font(.caption).foregroundStyle(.secondary)
        }
        Section("Evidence & context") {
          TextEditor(text: text("details")).frame(minHeight: 120)
          TextField("Source URL", text: text("source_url"))
          TextField("Link label", text: text("source_label"))
        }
      }.formStyle(.grouped).frame(minHeight: 430)
      HStack {
        Button("Reload saved task") {
          let task = store.snapshot.tasks.first { $0.id == self.task.id } ?? self.task
          fields = task.fields
          baseVersion = task.version
          planned = !task.text("planned_on").isEmpty
          plannedDate = DeskDates.date(task.text("planned_on"))
          deadline = !task.text("deadline").isEmpty
          deadlineDate = DeskDates.date(task.text("deadline"))
          checkin = !task.text("next_check_at").isEmpty
          checkinDate = DeskDates.parse(task.text("next_check_at")) ?? Date()
        }
        Spacer()
        Button("Close") { dismiss() }.keyboardShortcut(.cancelAction)
        Button("Save changes", action: save).keyboardShortcut(.defaultAction).disabled(
          (fields["title"]?.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || (fields["summary"]?.text ?? "").isEmpty || store.pending("task", task.id)
            || fields["status"]?.text == "scheduled" && !checkin)
      }.padding(20)
    }.frame(width: 590, height: 700).onChange(of: draft) { value in
      if !didSave { store.persistDraft("task-edit:" + task.id, value) }
    }.onDisappear {
      if !didSave { store.persistDraft("task-edit:" + task.id, draft) }
    }
  }
  var draft: [String: JSONValue] {
    var values = fields
    values["planned_on"] = planned ? .string(DeskDates.day(plannedDate)) : .null
    values["deadline"] = deadline ? .string(DeskDates.day(deadlineDate)) : .null
    values["next_check_at"] = checkin ? .string(DeskDates.iso(checkinDate)) : .null
    values["draft_version"] = .int(baseVersion)
    return values
  }
  func save() {
    let keys = [
      "title", "summary", "status", "action_owner", "blocker", "next_step", "area_id", "project_id",
      "priority", "tags", "details", "source_url", "source_label", "planned_on", "deadline",
      "next_check_at", "checklist",
    ]
    var body: [String: JSONValue] = [:]
    let values = draft
    for key in keys { if let value = values[key] { body[key] = value } }
    if let data = body["checklist"]?.text.data(using: .utf8), let list = try? JSONValue.parse(data),
      let encoded = try? JSONValue.array(
        list.array.filter {
          !$0["text"].text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
      ).data()
    {
      body["checklist"] = .string(String(decoding: encoded, as: UTF8.self))
    }
    var base = task
    base.fields["version"] = .int(baseVersion)
    if store.updateTask(base, body) {
      didSave = true
      store.clearDraft("task-edit:" + task.id)
      dismiss()
    }
  }
}
struct SyncReview: View {
  @ObservedObject var store: DeskStore
  @Environment(\.dismiss) var dismiss
  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack {
        Text("Sync changes").font(.title2.weight(.semibold))
        Spacer()
        Button("Done") { dismiss() }.keyboardShortcut(.cancelAction)
      }
      if !store.error.isEmpty { Text(store.error).font(.callout).foregroundStyle(.orange) }
      if store.mutations.isEmpty {
        EmptyDeskView(
          title: "Your changes are synced",
          message: store.needsSignIn
            ? "Sign in to refresh saved reports."
            : "Local drafts stay on this Mac until you save or send them.",
          symbol: "checkmark.circle")
      } else {
        ScrollView {
          VStack(alignment: .leading, spacing: 18) {
            ForEach(store.mutations) { item in
              VStack(alignment: .leading, spacing: 8) {
                Text(
                  item.isComment ? "Comment or request" : item.targetType.capitalized + " change"
                ).font(.headline)
                Text(item.body["title"]?.text ?? item.body["body"]?.text ?? item.targetKey).font(
                  .callout
                ).lineLimit(4)
                if !item.error.isEmpty {
                  Text(item.error).font(.caption).foregroundStyle(.orange)
                } else {
                  Text("Saved on this Mac. Waiting to sync.").font(.caption).foregroundStyle(
                    .secondary)
                }
                HStack {
                  Button("Retry") { store.retry(item) }
                  if item.conflict, item.body["expected_version"] != nil {
                    Button("Apply my changes to current version") {
                      store.retry(item, rebase: true)
                    }
                  }
                  Button("Discard local change", role: .destructive) { store.discard(item) }
                }.disabled(store.sendingId == item.id)
                Divider()
              }
            }
          }
        }
      }
      if !store.discardedChanges.isEmpty {
        DisclosureGroup("Recently removed changes") {
          ForEach(store.discardedChanges) { item in
            HStack {
              Text(item.body["title"]?.text ?? item.targetType.capitalized + " change").lineLimit(1)
              Spacer()
              Button("Restore for review") { store.restoreDiscarded(item) }
            }
          }
        }
      }
      HStack {
        Button("Refresh saved work") { Task { await store.refresh() } }
        if store.needsSignIn { Button("Sign in") { store.signInAction?() } }
        Spacer()
      }
    }.padding(22).frame(width: 650, height: 470)
  }
}
struct DeskSettings: View {
  @ObservedObject var store: DeskStore
  @Environment(\.dismiss) var dismiss
  @AppStorage("nativeReplyNotifications") var notifications = false
  @AppStorage("showMenuBarExtra") var showMenuBarExtra = true
  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      HStack {
        Text("Passforth settings").font(.title2.weight(.semibold))
        Spacer()
        Button("Done") { dismiss() }.keyboardShortcut(.cancelAction)
      }
      Form {
        Section("Connection") {
          LabeledContent("Workspace", value: store.connection?.url.host ?? "Not connected")
          Button("Connect or change workspace…") {
            dismiss()
            store.connectionPresented = true
          }
          LabeledContent("Setup standard", value: "passforth.setup.v1")
          LabeledContent(
            "Dot monitoring", value: store.workspace.subscribed ? "Connected" : "Not connected")
          LabeledContent("Sync", value: store.statusText)
          Button("Sign in or reconnect") { store.signInAction?() }
        }
        Section("On this Mac") {
          Text(
            "Tasks, notes, drafts and unsynced changes are kept privately in Application Support. Account data stays separate."
          ).font(.callout).foregroundStyle(.secondary)
          Toggle("Show Passforth in the menu bar", isOn: $showMenuBarExtra)
          Toggle(
            "Notify me about Dot replies",
            isOn: Binding(
              get: { notifications },
              set: { value in
                if value { store.enableNotifications() } else { notifications = false }
              }))
          Text(
            "Notifications appear while Passforth is running. Reply text is hidden on the notification."
          ).font(.caption).foregroundStyle(.secondary)
          LabeledContent("Quick capture", value: "Control–Option–Space")
          Text("Use Command-N for a new task and Command-F to search.").font(.caption)
            .foregroundStyle(.secondary)
        }
        Section("Recovery") {
          Button("Review unsynced changes") {
            store.queuePresented = true
            dismiss()
          }
          Button("Open web workspace") { NSWorkspace.shared.open(dashboardURL) }
          Button("Create verified private backup") {
            Task {
              do {
                _ = try await store.api.request(
                  "/api/workspace", body: ["action": .string("backup")])
                store.notice = "Private backup saved and verified"
              } catch { store.error = error.localizedDescription }
            }
          }
        }
      }.formStyle(.grouped)
    }.padding(22).frame(width: 580, height: 570)
  }
}
struct NativeProjectDetail: View {
  @ObservedObject var store: DeskStore
  let project: DeskRecord
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        Text(project.title).font(.title.weight(.semibold))
        if !project.text("notes").isEmpty { Text(project.text("notes")).textSelection(.enabled) }
        LinkedNativeNotes(store: store, type: "project", key: project.id)
        NativeConversation(store: store, type: "project", key: project.id)
      }.padding(24).frame(maxWidth: 760, alignment: .leading).frame(maxWidth: .infinity)
    }.background(Color(nsColor: .textBackgroundColor))
  }
}
struct OrganizationSheet: View {
  @ObservedObject var store: DeskStore
  @Environment(\.dismiss) var dismiss
  @State private var selection = ""
  @State private var type = "project"
  @State private var title = ""
  @State private var notes = ""
  @State private var area = ""
  @State private var archived = false
  @State private var version = 0
  @State private var key = UUID().uuidString.lowercased()
  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack {
        Text("Areas & projects").font(.title2.weight(.semibold))
        Spacer()
        Button("Done") { dismiss() }.keyboardShortcut(.cancelAction)
      }
      HStack {
        Button("New project") { reset("project") }
        Button("New area") { reset("area") }
      }
      Picker("Existing item", selection: $selection) {
        Text("New item").tag("")
        ForEach(store.workspace.areas) { Text("Area: " + $0.title).tag("area:" + $0.id) }
        ForEach(store.workspace.projects) { Text("Project: " + $0.title).tag("project:" + $0.id) }
      }.onChange(of: selection) { value in
        guard let separator = value.firstIndex(of: ":") else { return }
        type = String(value[..<separator])
        key = String(value[value.index(after: separator)...])
        let record = (type == "area" ? store.workspace.areas : store.workspace.projects).first {
          $0.id == key
        }
        title = record?.title ?? ""
        notes = record?.text("notes") ?? ""
        area = record?.text("area_id") ?? ""
        version = record?.version ?? 0
        archived = record?.archived ?? false
      }
      Form {
        TextField(type == "area" ? "Area name" : "Project outcome", text: $title)
        if type == "project" {
          Picker("Area", selection: $area) {
            Text("No area").tag("")
            ForEach(store.workspace.areas.filter { !$0.archived }) { Text($0.title).tag($0.id) }
          }
          TextEditor(text: $notes).frame(minHeight: 150)
        }
        Toggle("Archived", isOn: $archived)
      }
      HStack {
        Text("\(type.capitalized) changes sync with your existing workspace.").font(.caption)
          .foregroundStyle(.secondary)
        Spacer()
        Button("Save \(type)") {
          let body: [String: JSONValue] = [
            "action": .string("entity"), "type": .string(type), "id": .string(key),
            "title": .string(title), "notes": .string(notes), "area_id": .string(area),
            "archived": .bool(archived), "expected_version": .int(version),
          ]
          if store.enqueue(path: "/api/workspace", body: body, type: type, key: key) { dismiss() }
        }.disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      }
    }.padding(22).frame(width: 580, height: 500)
  }
  func reset(_ kind: String) {
    selection = ""
    type = kind
    title = ""
    notes = ""
    area = ""
    archived = false
    version = 0
    key = UUID().uuidString.lowercased()
  }
}
