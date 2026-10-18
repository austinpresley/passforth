import SwiftUI

struct NativeNotesList: View {
  @ObservedObject var store: DeskStore
  @State private var label = ""
  @State private var archived = false
  var notes: [DeskRecord] {
    store.workspace.notes.filter { note in
      (archived || !note.archived) && (store.route != "daily" || !note.text("daily_on").isEmpty)
        && labelMatches(note.text("tags"), label)
        && store.query.lowercased().split(whereSeparator: { $0.isWhitespace }).allSatisfy {
          (note.title + " " + note.text("body") + " " + note.text("tags")).lowercased().contains($0)
        }
    }.sorted { $0.text("updated_at") > $1.text("updated_at") }
  }
  var labels: [String] {
    var values = Set<String>()
    for note in store.workspace.notes {
      for tag in note.text("tags").split(whereSeparator: { $0.isWhitespace }) {
        let parts = tag.split(separator: "/")
        for count in 1...max(1, parts.count) {
          values.insert(parts.prefix(count).joined(separator: "/"))
        }
      }
    }
    return values.sorted()
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      VStack(alignment: .leading, spacing: 10) {
        HStack {
          Text(store.routeTitle).font(.title2.weight(.bold))
          Spacer()
          Button {
            store.showNewNote = true
          } label: {
            Image(systemName: "square.and.pencil")
          }.buttonStyle(.plain).help("New note")
        }
        Picker("Label", selection: $label) {
          Text("All labels").tag("")
          ForEach(labels, id: \.self) {
            Text($0.replacingOccurrences(of: "/", with: " / ")).tag($0)
          }
        }.labelsHidden()
        HStack {
          Button("Today's note") { openToday() }.buttonStyle(.link)
          Spacer()
          Toggle("Archived", isOn: $archived).toggleStyle(.checkbox).font(.caption)
        }
      }.padding(18)
      if notes.isEmpty {
        EmptyDeskView(
          title: "No notes here",
          message: "Keep a brief or reference here, then link it to the work that needs it.",
          symbol: "note.text")
      } else {
        List(selection: $store.selectedNote) {
          ForEach(notes) { note in
            VStack(alignment: .leading, spacing: 5) {
              Text(note.title).font(.body.weight(.medium))
              Text(note.text("daily_on").isEmpty ? note.text("tags") : note.text("daily_on")).font(
                .caption
              ).foregroundStyle(.secondary)
              Text(note.text("body")).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }.padding(.vertical, 7).tag(note.id)
          }
        }.listStyle(.inset)
      }
    }
  }
  func openToday() {
    let day = DeskDates.day()
    if let note = store.workspace.notes.first(where: { $0.text("daily_on") == day }) {
      store.selectedNote = note.id
    } else {
      store.route = "daily"
      store.showNewNote = true
    }
  }
}
struct NoteCreationSheet: View {
  @ObservedObject var store: DeskStore
  var daily: Bool
  @Environment(\.dismiss) var dismiss
  @State private var title = ""
  @State private var bodyText = ""
  @State private var day = Date()
  @State private var isDaily = false
  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("New note").font(.title2.weight(.semibold))
      TextField("Note title", text: $title).font(.title3).textFieldStyle(.roundedBorder)
      Toggle("Daily Note", isOn: $isDaily)
      if isDaily { DatePicker("Day", selection: $day, displayedComponents: .date) }
      TextEditor(text: $bodyText).frame(minHeight: 180).border(Color(nsColor: .separatorColor))
      HStack {
        Button("Close") { dismiss() }.keyboardShortcut(.cancelAction)
        Spacer()
        Button("Create note") { create() }.keyboardShortcut(.defaultAction).disabled(
          !isDaily && title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      }
    }.padding(22).frame(width: 570, height: 450).onAppear {
      isDaily = daily
      title = store.draft("new-note-title")
      bodyText = store.draft("new-note-body")
    }.onChange(of: title) { store.saveDraft("new-note-title", $0) }.onChange(of: bodyText) {
      store.saveDraft("new-note-body", $0)
    }
  }
  func create() {
    let date = DeskDates.day(day)
    if isDaily, let existing = store.workspace.notes.first(where: { $0.text("daily_on") == date }) {
      store.selectedNote = existing.id
      dismiss()
      return
    }
    let key = isDaily ? "daily-" + date : "note-" + UUID().uuidString.lowercased()
    let name = isDaily ? day.formatted(.dateTime.weekday(.wide).month(.wide).day().year()) : title
    let value: [String: JSONValue] = [
      "action": .string("note"), "id": .string(key), "title": .string(name),
      "body": .string(bodyText), "tags": .string(""), "daily_on": isDaily ? .string(date) : .null,
      "archived": .bool(false), "links": .array([]), "expected_version": .int(0),
      "event_id": .string(UUID().uuidString.lowercased()),
    ]
    if store.enqueue(path: "/api/workspace", body: value, type: "note", key: key) {
      store.route = isDaily ? "daily" : "notes"
      store.selectedNote = key
      store.saveDraft("new-note-title", "")
      store.saveDraft("new-note-body", "")
      dismiss()
    }
  }
}
struct NativeNoteDetail: View {
  @ObservedObject var store: DeskStore
  let note: DeskRecord
  @State private var fields: [String: JSONValue] = [:]
  @State private var base: [String: JSONValue] = [:]
  @State private var version = 0
  @State private var reading = false
  @State private var linkType = "task"
  @State private var linkKey = ""
  @State private var ownEvent = ""
  var dirty: Bool { fields != base }
  func text(_ key: String) -> Binding<String> {
    Binding(get: { fields[key]?.text ?? "" }, set: { fields[key] = .string($0) })
  }
  var links: [JSONValue] { fields["links"]?.array ?? [] }
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 18) {
        HStack {
          Text(note.text("daily_on").isEmpty ? "Reference note" : note.text("daily_on")).font(
            .callout
          ).foregroundStyle(.secondary)
          Spacer()
          Picker("Mode", selection: $reading) {
            Text("Write").tag(false)
            Text("Read").tag(true)
          }.pickerStyle(.segmented).frame(width: 135)
        }
        TextField("Note title", text: text("title")).font(.system(size: 25, weight: .semibold))
          .textFieldStyle(.plain).accessibilityLabel("Note title")
        if reading {
          NativeNoteText(text: fields["body"]?.text ?? "").frame(
            maxWidth: .infinity, alignment: .leading)
        } else {
          TextEditor(text: text("body")).font(.body).frame(minHeight: 280).accessibilityLabel(
            "Note body")
        }
        HStack {
          TextField("Labels, e.g. studio/portraits", text: text("tags")).textFieldStyle(
            .roundedBorder)
          Button("Save note", action: save).disabled(
            !dirty || store.pending("note", note.id)
              || (fields["title"]?.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                .isEmpty
          ).keyboardShortcut("s")
          if dirty { Text("Draft on this Mac").font(.caption).foregroundStyle(.secondary) }
        }
        if store.pending("note", note.id) {
          Text("Saved on this Mac. Waiting to sync.").font(.caption).foregroundStyle(.secondary)
        }
        if !links.isEmpty {
          VStack(alignment: .leading, spacing: 7) {
            Text("Linked work & notes").font(.headline)
            ForEach(Array(links.enumerated()), id: \.offset) { index, link in
              HStack {
                Button(linkTitle(link)) { open(link) }.buttonStyle(.link)
                Spacer()
                Button {
                  var values = links
                  values.remove(at: index)
                  fields["links"] = .array(values)
                } label: {
                  Image(systemName: "minus.circle")
                }.buttonStyle(.plain).help("Unlink")
              }
            }
          }
        }
        DisclosureGroup("Link a task, project or note") {
          HStack {
            Picker("Type", selection: $linkType) {
              Text("Task").tag("task")
              Text("Project").tag("project")
              Text("Note").tag("note")
            }.labelsHidden().frame(width: 100).onChange(of: linkType) { _ in linkKey = "" }
            Picker("Link to", selection: $linkKey) {
              Text("Choose an item").tag("")
              ForEach(targets) { Text($0.title).tag($0.id) }
            }.labelsHidden()
            Button("Add link") {
              let link: JSONValue = .object([
                "target_type": .string(linkType), "target_key": .string(linkKey),
              ])
              if !links.contains(link) { fields["links"] = .array(links + [link]) }
              linkKey = ""
            }.disabled(linkKey.isEmpty)
          }
        }
        LinkedNativeNotes(store: store, type: "note", key: note.id)
        if note.version > 0 { NativeConversation(store: store, type: "note", key: note.id) }
        Toggle(
          "Archived",
          isOn: Binding(
            get: { fields["archived"]?.flag ?? false }, set: { fields["archived"] = .bool($0) })
        ).toggleStyle(.checkbox).font(.callout)
      }.padding(24).frame(maxWidth: 800, alignment: .leading).frame(maxWidth: .infinity)
    }.background(Color(nsColor: .textBackgroundColor))
      .onAppear {
        reload()
        if let draft: [String: JSONValue] = store.loadDraft(
          "note-edit:" + note.id, as: [String: JSONValue].self)
        {
          version = draft["draft_version"]?.integer ?? note.version
          fields = draft.filter { $0.key != "draft_version" }
        }
      }
      .onChange(of: fields) { value in
        if value != base {
          var draft = value
          draft["draft_version"] = .int(version)
          store.persistDraft("note-edit:" + note.id, draft)
        }
      }
      .onChange(of: note.version) { _ in
        if !dirty {
          reload()
        } else if !ownEvent.isEmpty && note.text("last_change_id").hasSuffix(ownEvent) {
          version = note.version
        }
      }
  }
  var targets: [DeskRecord] {
    linkType == "task"
      ? store.displayTasks
      : linkType == "project"
        ? store.workspace.projects : store.workspace.notes.filter { $0.id != note.id }
  }
  func linkTitle(_ link: JSONValue) -> String {
    let type = link["target_type"].text
    let key = link["target_key"].text
    return
      (type == "task"
      ? store.displayTasks : type == "project" ? store.workspace.projects : store.workspace.notes)
      .first { $0.id == key }?.title ?? "Unavailable item"
  }
  func open(_ link: JSONValue) {
    let type = link["target_type"].text
    let key = link["target_key"].text
    if type == "task" {
      store.openTask(key)
    } else if type == "note" {
      store.openNote(key)
    } else {
      store.route = "project:" + key
      store.selectedTask = nil
    }
  }
  func reload() {
    version = note.version
    let links = store.workspace.noteLinks.filter { $0.text("note_id") == note.id }.map {
      JSONValue.object([
        "target_type": .string($0.text("target_type")),
        "target_key": .string($0.text("target_key")),
      ])
    }
    let value: [String: JSONValue] = [
      "title": .string(note.title), "body": .string(note.text("body")),
      "tags": .string(note.text("tags")), "archived": .bool(note.archived), "links": .array(links),
    ]
    base = value
    fields = value
  }
  func save() {
    // SwiftUI can coalesce the acknowledgement with the next edit. Use our own
    // confirmed receipt to advance the base, while retaining peer-change conflicts.
    if !ownEvent.isEmpty,
      let confirmed = store.snapshot.workspace.notes.first(where: { $0.id == note.id }),
      confirmed.text("last_change_id").hasSuffix(":" + ownEvent)
    {
      version = confirmed.version
    }
    ownEvent = UUID().uuidString.lowercased()
    var body = fields
    body["action"] = .string("note")
    body["id"] = .string(note.id)
    body["daily_on"] = note.text("daily_on").isEmpty ? .null : .string(note.text("daily_on"))
    body["expected_version"] = .int(version)
    body["event_id"] = .string(ownEvent)
    if store.enqueue(path: "/api/workspace", body: body, type: "note", key: note.id) {
      base = fields
      store.clearDraft("note-edit:" + note.id)
    }
  }
}
struct NativeNoteText: View {
  let text: String
  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      ForEach(Array(text.components(separatedBy: "\n").enumerated()), id: \.offset) { _, line in
        if line.hasPrefix("### ") {
          Text(String(line.dropFirst(4))).font(.headline).padding(.top, 8)
        } else if line.hasPrefix("## ") {
          Text(String(line.dropFirst(3))).font(.title3.weight(.semibold)).padding(.top, 10)
        } else if line.hasPrefix("# ") {
          Text(String(line.dropFirst(2))).font(.title2.weight(.semibold)).padding(.top, 12)
        } else {
          Text(line.hasPrefix("- ") ? "• " + String(line.dropFirst(2)) : line).textSelection(
            .enabled)
        }
      }
    }
  }
}
struct NativeWeekList: View {
  @ObservedObject var store: DeskStore
  @State private var blockEditor = false
  @State private var editingBlock: DeskRecord?
  var days: [Date] { DeskDates.week(store.weekAnchor) }
  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      VStack(alignment: .leading, spacing: 12) {
        HStack {
          Text("Week").font(.title2.weight(.bold))
          Spacer()
          Button {
            store.weekAnchor = Calendar.current.date(
              byAdding: .day, value: -7, to: store.weekAnchor)!
          } label: {
            Image(systemName: "chevron.left")
          }.buttonStyle(.plain)
          Button("Today") { store.weekAnchor = Date() }.buttonStyle(.link)
          Button {
            store.weekAnchor = Calendar.current.date(
              byAdding: .day, value: 7, to: store.weekAnchor)!
          } label: {
            Image(systemName: "chevron.right")
          }.buttonStyle(.plain)
        }
        Text(
          days[0].formatted(.dateTime.month(.abbreviated).day()) + " to "
            + days[6].formatted(.dateTime.month(.abbreviated).day())
        ).font(.callout).foregroundStyle(.secondary)
        Button("Add time block") {
          editingBlock = nil
          blockEditor = true
        }.disabled(store.displayTasks.filter { !$0.done }.isEmpty)
      }.padding(18)
      List(selection: $store.selectedTask) {
        ForEach(days, id: \.self) { day in
          Section {
            let key = DeskDates.day(day)
            ForEach(
              store.displayTasks.filter {
                !$0.done && ($0.text("planned_on") == key || $0.text("deadline") == key)
              }
            ) { task in
              VStack(alignment: .leading, spacing: 4) {
                TaskListRow(store: store, task: task)
                if task.text("deadline") == key {
                  Text("Due today").font(.caption).foregroundStyle(.orange)
                }
              }.tag(task.id)
            }
            ForEach(
              store.workspace.timeBlocks.filter {
                !$0.archived
                  && DeskDates.parse($0.text("starts_at")).map { DeskDates.day($0) == key } == true
              }
            ) { block in
              Button {
                editingBlock = block
              } label: {
                VStack(alignment: .leading, spacing: 4) {
                  Text(
                    (DeskDates.parse(block.text("starts_at")) ?? Date()).formatted(
                      .dateTime.hour().minute()) + " · \(block.int("duration_minutes"))m"
                  ).font(.caption).foregroundStyle(.secondary)
                  Text(
                    store.displayTasks.first { $0.id == block.text("task_key") }?.title ?? "Task"
                  ).font(.body.weight(.medium))
                  if overlaps(block) {
                    Text("Overlaps another block").font(.caption).foregroundStyle(.orange)
                  }
                }.padding(.vertical, 6)
              }.buttonStyle(.plain).contextMenu {
                Button("Open task") { store.openTask(block.text("task_key")) }
                Button("Edit time block") {
                  editingBlock = block
                }
              }
            }
          } header: {
            Text(day.formatted(.dateTime.weekday(.wide).day())).onDrop(
              of: ["public.text"], isTargeted: nil
            ) { providers in
              guard let first = providers.first else { return false }
              first.loadObject(ofClass: NSString.self) { value, _ in
                if let key = value as? String {
                  Task { @MainActor in
                    if let task = store.displayTasks.first(where: { $0.id == key }) {
                      _ = store.updateTask(task, ["planned_on": .string(DeskDates.day(day))])
                    }
                  }
                }
              }
              return true
            }
          }
        }
      }.listStyle(.inset)
    }.sheet(isPresented: $blockEditor) { TimeBlockSheet(store: store, block: nil) }
      .sheet(item: $editingBlock) { TimeBlockSheet(store: store, block: $0) }
  }
  func overlaps(_ value: DeskRecord) -> Bool {
    guard let start = DeskDates.parse(value.text("starts_at")) else { return false }
    let end = start.addingTimeInterval(Double(value.int("duration_minutes")) * 60)
    return store.workspace.timeBlocks.contains { other in
      guard other.id != value.id, !other.archived,
        let time = DeskDates.parse(other.text("starts_at"))
      else { return false }
      return start < time.addingTimeInterval(Double(other.int("duration_minutes")) * 60)
        && time < end
    }
  }
}
struct TimeBlockSheet: View {
  @ObservedObject var store: DeskStore
  let block: DeskRecord?
  @Environment(\.dismiss) var dismiss
  @State private var task = ""
  @State private var start = Date()
  @State private var minutes = 60
  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      Text(block == nil ? "New time block" : "Edit time block").font(.title2.weight(.semibold))
      Form {
        Picker("Task", selection: $task) {
          Text("Choose a task").tag("")
          ForEach(store.displayTasks.filter { !$0.done || $0.id == task }) {
            Text($0.title).tag($0.id)
          }
        }
        DatePicker("Start", selection: $start)
        Stepper("\(minutes) minutes", value: $minutes, in: 15...720, step: 15)
        Text(
          "Times use \(TimeZone.current.identifier). Moving a block keeps deadlines and promised check-ins unchanged."
        ).font(.caption).foregroundStyle(.secondary)
      }
      HStack {
        Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
        if block != nil { Button("Remove block", role: .destructive) { save(true) } }
        Spacer()
        Button("Save block") { save(false) }.keyboardShortcut(.defaultAction).disabled(task.isEmpty)
      }
    }.padding(22).frame(width: 530, height: 300).onAppear {
      let selected = store.displayTasks.first { $0.id == store.selectedTask && !$0.done }
      task = block?.text("task_key") ?? selected?.id ?? ""
      start = block.flatMap { DeskDates.parse($0.text("starts_at")) } ?? Date()
      minutes = block?.int("duration_minutes") ?? 60
    }
  }
  func save(_ archived: Bool) {
    let key = block?.id ?? "block-" + UUID().uuidString.lowercased()
    let body: [String: JSONValue] = [
      "action": .string("block"), "id": .string(key), "task_key": .string(task),
      "starts_at": .string(DeskDates.iso(start)), "duration_minutes": .int(minutes),
      "timezone": .string(TimeZone.current.identifier), "archived": .bool(archived),
      "expected_version": .int(block?.version ?? 0),
      "event_id": .string(UUID().uuidString.lowercased()),
    ]
    if store.enqueue(path: "/api/workspace", body: body, type: "block", key: key) { dismiss() }
  }
}

struct SavedViewSheet: View {
  @ObservedObject var store: DeskStore
  @Environment(\.dismiss) var dismiss
  @State private var title = ""
  @State private var query = ""
  @State private var view = "all"
  @State private var area = ""
  @State private var project = ""
  @State private var label = ""
  @State private var scope = "all"
  @State private var priority = 0
  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("Save a task view").font(.title2.weight(.semibold))
      Form {
        TextField("View name", text: $title)
        TextField("Search words", text: $query)
        Picker("Work", selection: $view) {
          ForEach(deskViews.filter { $0.0 != "completed" }, id: \.0) { Text($0.1).tag($0.0) }
        }
        Picker("Area", selection: $area) {
          Text("All areas").tag("")
          ForEach(store.workspace.areas.filter { !$0.archived }) { Text($0.title).tag($0.id) }
        }
        Picker("Project", selection: $project) {
          Text("All projects").tag("")
          ForEach(store.workspace.projects.filter { !$0.archived }) { Text($0.title).tag($0.id) }
        }
        TextField("Label", text: $label, prompt: Text("e.g. studio"))
        Picker("Updates", selection: $scope) {
          Text("All").tag("all")
          Text("Unread").tag("new")
          Text("Needs an owner").tag("unknown")
        }
        Picker("Minimum priority", selection: $priority) {
          Text("Any").tag(0)
          Text("Low").tag(1)
          Text("Medium").tag(2)
          Text("High").tag(3)
        }
      }
      HStack {
        Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
        Spacer()
        Button("Save view", action: save).keyboardShortcut(.defaultAction).disabled(
          title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      }
    }.padding(22).frame(width: 540, height: 440).onAppear {
      query = store.query
      if deskViews.contains(where: { $0.0 == store.route && $0.0 != "completed" }) {
        view = store.route
      }
      if store.route.hasPrefix("project:") { project = String(store.route.dropFirst(8)) }
      if store.route.hasPrefix("area:") { area = String(store.route.dropFirst(5)) }
    }
  }
  func save() {
    let key = "view-" + UUID().uuidString.lowercased()
    let filters: JSONValue = .object([
      "query": .string(query), "view": .string(view), "area_id": .string(area),
      "project_id": .string(project), "label": .string(label), "scope": .string(scope),
      "priority_min": .int(priority),
    ])
    let body: [String: JSONValue] = [
      "action": .string("view"), "id": .string(key), "title": .string(title), "filters": filters,
      "archived": .bool(false), "expected_version": .int(0),
      "event_id": .string(UUID().uuidString.lowercased()),
    ]
    if store.enqueue(path: "/api/workspace", body: body, type: "view", key: key) {
      store.route = "saved:" + key
      dismiss()
    }
  }
}
