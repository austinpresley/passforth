import SwiftUI
import UniformTypeIdentifiers

struct EmptyDeskView: View {
  let title: String
  var message: String = ""
  var symbol: String = "tray"
  var body: some View {
    VStack(spacing: 12) {
      Image(systemName: symbol).font(.system(size: 32, weight: .light)).foregroundStyle(.secondary)
      Text(title).font(.title3.weight(.semibold))
      if !message.isEmpty {
        Text(message).foregroundStyle(.secondary).multilineTextAlignment(.center).frame(
          maxWidth: 300)
      }
    }.padding(30).frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}
struct NativeWorkspace: View {
  @ObservedObject var store: DeskStore
  @Environment(\.openWindow) private var openWindow
  @State private var columns: NavigationSplitViewVisibility = .all
  @State private var editingTask: DeskRecord?
  @State private var projectEditor = false
  @State private var savedViewEditor = false
  var body: some View {
    VStack(spacing: 0) {
      if store.needsSignIn {
        HStack {
          Image(systemName: "lock")
          Text("Sign in to sync your saved workspace.")
          Spacer()
          Button("Sign in") { store.signInAction?() }
        }.font(.callout).padding(10).background(.bar)
      }
      NavigationSplitView(columnVisibility: $columns) {
        sidebar.navigationSplitViewColumnWidth(min: 175, ideal: 205, max: 285)
      } content: {
        content.navigationSplitViewColumnWidth(min: 250, ideal: 330, max: 470)
      } detail: {
        detail.frame(minWidth: 340)
      }
      Divider()
      HStack(spacing: 7) {
        Circle().fill(store.needsSignIn || !store.online ? Color.orange : Color.green).frame(
          width: 6, height: 6)
        Text(store.statusText).font(.caption).foregroundStyle(.secondary)
        if !store.mutations.isEmpty {
          Button("Review") { store.queuePresented = true }.buttonStyle(.link).font(.caption)
        }
        Spacer()
        if !store.notice.isEmpty { Text(store.notice).font(.caption).foregroundStyle(.secondary) }
        if !store.error.isEmpty {
          Button {
            store.queuePresented = true
          } label: {
            Image(systemName: "exclamationmark.triangle").foregroundStyle(.orange)
          }.buttonStyle(.plain).help(store.error)
        }
        if store.refreshing { ProgressView().controlSize(.small) }
      }.padding(.horizontal, 14).padding(.vertical, 8)
    }
    .toolbar {
      ToolbarItemGroup(placement: .automatic) {
        Button {
          store.capturePresented = true
        } label: {
          Label("New task", systemImage: "plus")
        }.keyboardShortcut("n").help("New task")
        if store.route == "notes" || store.route == "daily" {
          Button {
            store.showNewNote = true
          } label: {
            Label("New note", systemImage: "square.and.pencil")
          }
        }
        Button {
          Task { await store.refresh() }
        } label: {
          Label("Sync", systemImage: "arrow.clockwise")
        }.help("Sync saved work").disabled(store.refreshing)
        Menu {
          Button("Save task view…") { savedViewEditor = true }.disabled(
            ["notes", "daily", "week"].contains(store.route))
          Button("Areas & projects") { projectEditor = true }
          Button("Sync changes") { store.queuePresented = true }
          Button("Settings…") { store.settingsPresented = true }
        } label: {
          Label("More", systemImage: "ellipsis.circle")
        }
      }
    }
    .searchable(
      text: $store.query,
      prompt: store.route == "notes" || store.route == "daily" ? "Search notes" : "Search work"
    )
    .sheet(isPresented: $store.connectionPresented) {
      ConnectionView(store: store).interactiveDismissDisabled(
        store.connection == nil || store.connecting)
    }
    .sheet(isPresented: $store.capturePresented) { CaptureSheet(store: store) }
    .sheet(isPresented: $store.settingsPresented) { DeskSettings(store: store) }
    .sheet(isPresented: $store.queuePresented) { SyncReview(store: store) }
    .sheet(isPresented: $projectEditor) { OrganizationSheet(store: store) }
    .sheet(isPresented: $savedViewEditor) { SavedViewSheet(store: store) }
    .sheet(isPresented: $store.showNewNote) {
      NoteCreationSheet(store: store, daily: store.route == "daily")
    }
    .frame(minWidth: 920, minHeight: 580)
    .onAppear {
      store.openSceneAction = {
        openWindow(id: "main")
        NSApp.activate(ignoringOtherApps: true)
      }
      store.start()
    }
    .onChange(of: store.route) { _ in store.query = "" }
  }
  private func archiveView(_ view: DeskRecord) {
    guard let data = view.text("filters").data(using: .utf8),
      let filters = try? JSONValue.parse(data)
    else {
      store.error = "Refresh this view before changing it."
      return
    }
    if store.enqueue(
      path: "/api/workspace",
      body: [
        "action": .string("view"), "id": .string(view.id), "title": .string(view.title),
        "filters": filters, "archived": .bool(true), "expected_version": .int(view.version),
        "event_id": .string(UUID().uuidString.lowercased()),
      ], type: "view", key: view.id), store.route == "saved:" + view.id
    {
      store.route = "all"
    }
  }
  private var sidebar: some View {
    List(selection: $store.route) {
      Section("My work") {
        ForEach(deskViews, id: \.0) { value in
          Label {
            HStack {
              Text(value.1)
              Spacer()
              if value.0 == "you", !store.needsYou.isEmpty {
                Text("\(store.needsYou.count)").foregroundStyle(.secondary).monospacedDigit()
              }
            }
          } icon: {
            Image(systemName: value.2)
          }.tag(value.0)
        }
      }
      Section("Library") {
        Label("Notes", systemImage: "note.text").tag("notes")
        Label("Daily Notes", systemImage: "book.closed").tag("daily")
        Label("Week", systemImage: "calendar.day.timeline.left").tag("week")
      }
      if !store.workspace.savedViews.filter({ !$0.archived }).isEmpty {
        Section("Saved views") {
          ForEach(store.workspace.savedViews.filter { !$0.archived }) { view in
            Label(view.title, systemImage: "line.3.horizontal.decrease.circle").tag(
              "saved:" + view.id
            )
            .contextMenu {
              Button("Archive view") { archiveView(view) }.disabled(store.pending("view", view.id))
            }
          }
        }
      }
      if !store.workspace.projects.filter({ !$0.archived }).isEmpty {
        Section("Projects") {
          ForEach(store.workspace.projects.filter { !$0.archived }) { project in
            Label(project.title, systemImage: "folder").tag("project:" + project.id)
          }
        }
      }
      if !store.workspace.areas.filter({ !$0.archived }).isEmpty {
        Section("Areas") {
          ForEach(store.workspace.areas.filter { !$0.archived }) { area in
            Label(area.title, systemImage: "square.grid.2x2").tag("area:" + area.id)
          }
        }
      }
    }.listStyle(.sidebar).navigationTitle("Passforth")
  }
  @ViewBuilder private var content: some View {
    if store.route == "notes" || store.route == "daily" {
      NativeNotesList(store: store)
    } else if store.route == "week" {
      NativeWeekList(store: store)
    } else {
      VStack(alignment: .leading, spacing: 0) {
        VStack(alignment: .leading, spacing: 4) {
          Text(store.routeTitle).font(.title2.weight(.bold))
          Text(Date(), format: .dateTime.weekday(.wide).month(.wide).day()).font(.callout)
            .foregroundStyle(.secondary)
        }.padding(18)
        if store.filteredTasks.isEmpty {
          EmptyDeskView(
            title: store.query.isEmpty ? "Nothing here yet" : "No matching work",
            message: store.query.isEmpty
              ? "Capture a task, or choose another view."
              : "Try a title, label, or a word from your notes.")
        } else {
          List(selection: $store.selectedTask) {
            ForEach(store.filteredTasks) { task in
              TaskListRow(store: store, task: task).tag(task.id).contextMenu {
                Button("Open") { store.openTask(task.id) }
                Button("Edit…") { editingTask = task }
                Button(task.done ? "Move to Later" : "Complete task") {
                  _ = store.updateTask(
                    task, ["status": .string(task.done ? "paused" : "completed")])
                }
                Divider()
                Button("Copy title") {
                  NSPasteboard.general.clearContents()
                  NSPasteboard.general.setString(task.title, forType: .string)
                }
              }
            }
          }.listStyle(.inset).onChange(of: store.selectedTask) { key in
            if let task = store.displayTasks.first(where: { $0.id == key }) { store.markRead(task) }
          }
        }
        Button {
          store.capturePresented = true
        } label: {
          Label("New task", systemImage: "plus").frame(maxWidth: .infinity, alignment: .leading)
        }.buttonStyle(.plain).foregroundStyle(.secondary).padding(16)
      }.sheet(item: $editingTask) { TaskEditSheet(store: store, task: $0) }
    }
  }
  @ViewBuilder private var detail: some View {
    if store.route == "notes" || store.route == "daily", let id = store.selectedNote,
      let note = store.workspace.notes.first(where: { $0.id == id })
    {
      NativeNoteDetail(store: store, note: note).id(note.id)
    } else if store.route == "notes" || store.route == "daily" {
      EmptyDeskView(
        title: "Your reference notes",
        message: "Choose a note or create one. A note can support several tasks and projects.",
        symbol: "note.text")
    } else if let key = store.selectedTask,
      let task = store.displayTasks.first(where: { $0.id == key })
    {
      NativeTaskDetail(store: store, task: task).id(task.id)
    } else if store.route.hasPrefix("project:"),
      let project = store.workspace.projects.first(where: {
        $0.id == String(store.route.dropFirst(8))
      })
    {
      NativeProjectDetail(store: store, project: project).id(project.id)
    } else {
      EmptyDeskView(
        title: "Choose a task",
        message: "Its context, files, and conversation with Dot appear here.",
        symbol: "rectangle.and.text.magnifyingglass")
    }
  }
}
struct TaskListRow: View {
  @ObservedObject var store: DeskStore
  let task: DeskRecord
  var body: some View {
    HStack(alignment: .top, spacing: 10) {
      Button {
        _ = store.updateTask(task, ["status": .string(task.done ? "paused" : "completed")])
      } label: {
        Image(systemName: task.done ? "checkmark.circle.fill" : "circle").font(.system(size: 16))
          .foregroundStyle(task.done ? Color.secondary : Color.accentColor)
      }.buttonStyle(.plain).disabled(store.pending("task", task.id)).accessibilityLabel(
        task.done ? "Reopen " + task.title : "Complete " + task.title)
      VStack(alignment: .leading, spacing: 5) {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
          if task.unread { Circle().fill(Color.accentColor).frame(width: 5, height: 5) }
          Text(task.title).font(.body.weight(.medium)).lineLimit(2).strikethrough(task.done)
        }
        Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(2)
        if store.pending("task", task.id) {
          Text("Saved on this Mac").font(.caption2).foregroundStyle(.secondary)
        }
      }
      Spacer(minLength: 0)
    }.padding(.vertical, 7).onDrag { NSItemProvider(object: task.id as NSString) }
  }
  var subtitle: String {
    if task.needsYou { return task.text("blocker") }
    if let project = store.workspace.projects.first(where: { $0.id == task.text("project_id") }) {
      return project.title
    }
    return task.text("summary")
  }
}
struct NativeTaskDetail: View {
  @ObservedObject var store: DeskStore
  let task: DeskRecord
  @State private var editing = false
  @State private var targeted = false
  @State private var titleDraft = ""
  @State private var titleVersion = 0
  @State private var titleBase = ""
  @FocusState private var titleFocused: Bool
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        HStack {
          Text(projectName).font(.callout).foregroundStyle(.secondary)
          Spacer()
          Button {
            editing = true
          } label: {
            Image(systemName: "slider.horizontal.3")
          }.buttonStyle(.plain).help("Edit task and plan")
        }
        TextField("Task title", text: $titleDraft).font(.system(size: 25, weight: .semibold))
          .textFieldStyle(.plain).focused($titleFocused).accessibilityLabel("Task title")
          .onSubmit { saveTitle() }
          .onExitCommand {
            titleDraft = task.title
            titleVersion = task.version
            titleFocused = false
            store.clearDraft("task-title:" + task.id)
          }
        if titleDraft != task.title && !store.pending("task", task.id) {
          Text("Title draft saved on this Mac. Press Return to save.").font(.caption)
            .foregroundStyle(.secondary)
        }
        HStack(spacing: 10) {
          Text(statusLabel).foregroundStyle(.secondary)
          if task.int("priority") > 0 {
            Label(["", "Low", "Medium", "High"][min(task.int("priority"), 3)], systemImage: "flag")
              .foregroundStyle(task.int("priority") == 3 ? Color.orange : Color.secondary)
          }
        }.font(.callout)
        if !task.text("summary").isEmpty { Text(task.text("summary")).textSelection(.enabled) }
        if task.needsYou || task.waiting {
          VStack(alignment: .leading, spacing: 6) {
            Text(task.needsYou ? "Your next action" : "What is needed").font(
              .callout.weight(.semibold))
            Text(task.text("blocker")).textSelection(.enabled)
          }.padding(12).frame(maxWidth: .infinity, alignment: .leading).background(
            .quaternary.opacity(0.45), in: RoundedRectangle(cornerRadius: 8))
        }
        if !task.text("next_step").isEmpty {
          Text(task.text("next_step")).font(.callout).foregroundStyle(.secondary).textSelection(
            .enabled)
        }
        planningSummary
        if !task.text("details").isEmpty {
          DisclosureGroup("Evidence & context") {
            Text(task.text("details")).font(.callout).textSelection(.enabled).frame(
              maxWidth: .infinity, alignment: .leading
            ).padding(.top, 8)
          }
        }
        if let data = task.text("checklist").data(using: .utf8),
          let value = try? JSONValue.parse(data), !value.array.isEmpty
        {
          VStack(alignment: .leading, spacing: 8) {
            Text("Checklist").font(.headline)
            ForEach(Array(value.array.enumerated()), id: \.offset) { index, item in
              Toggle(
                item["text"].text,
                isOn: Binding(
                  get: { item["done"].flag },
                  set: { checked in
                    var items = value.array
                    var object = items[index].object
                    object["done"] = .bool(checked)
                    items[index] = .object(object)
                    if let data = try? JSONValue.array(items).data() {
                      _ = store.updateTask(
                        task, ["checklist": .string(String(decoding: data, as: UTF8.self))])
                    }
                  })
              ).toggleStyle(.checkbox).disabled(store.pending("task", task.id))
            }
          }
        }
        HStack {
          if let url = URL(string: task.text("source_url")), url.scheme == "https" {
            Link(
              task.text("source_label").isEmpty ? "Open source" : task.text("source_label"),
              destination: url)
          }
          if let url = URL(string: task.text("conversation_url")), url.scheme == "https" {
            Link("Source conversation", destination: url)
          }
        }.font(.callout)
        LinkedNativeNotes(store: store, type: "task", key: task.id)
        NativeConversation(store: store, type: "task", key: task.id)
        HStack {
          Button(task.done ? "Move to Later" : "Complete task") {
            _ = store.updateTask(task, ["status": .string(task.done ? "paused" : "completed")])
          }.disabled(store.pending("task", task.id))
          Button("Edit…") { editing = true }
          Spacer()

        }
      }.padding(24).frame(maxWidth: 760, alignment: .leading).frame(maxWidth: .infinity)
    }
    .onAppear {
      titleVersion = task.version
      titleBase = task.title
      titleDraft = task.title
      if let draft: [String: JSONValue] = store.loadDraft(
        "task-title:" + task.id, as: [String: JSONValue].self)
      {
        titleDraft = draft["title"]?.text ?? task.title
        titleVersion = draft["version"]?.integer ?? task.version
      }
    }
    .onChange(of: titleDraft) { value in
      if value != task.title {
        store.persistDraft(
          "task-title:" + task.id,
          ["title": JSONValue.string(value), "version": .int(titleVersion)])
      }
    }
    .onChange(of: task.title) { value in
      if titleDraft == titleBase || titleDraft == value {
        titleDraft = value
        titleVersion = task.version
        titleBase = value
      }
    }
    .onChange(of: titleFocused) { value in
      if value && titleDraft == task.title { titleVersion = task.version }
    }
    .background(Color(nsColor: .textBackgroundColor)).sheet(isPresented: $editing) {
      TaskEditSheet(store: store, task: task)
    }
    .onDrop(of: [UTType.fileURL], isTargeted: $targeted) { providers in
      acceptFileDrop(providers, store: store, type: "task", key: task.id)
    }
    .overlay {
      if targeted {
        RoundedRectangle(cornerRadius: 8).stroke(Color.accentColor, lineWidth: 3).padding(4)
      }
    }
  }
  func saveTitle() {
    let title = titleDraft.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !title.isEmpty, title.count <= 200 else {
      store.error = "Use a title of 1 to 200 characters. Your draft is kept."
      return
    }
    guard title != task.title else {
      titleFocused = false
      return
    }
    var record = task
    record.fields["version"] = .int(titleVersion)
    if store.updateTask(record, ["title": .string(title)]) {
      store.clearDraft("task-title:" + task.id)
      titleFocused = false
    }
  }
  var projectName: String {
    store.workspace.projects.first { $0.id == task.text("project_id") }?.title ?? "Task"
  }
  var statusLabel: String {
    deskStatuses.first { $0.0 == task.text("status") }?.1 ?? task.text("status")
  }
  @ViewBuilder var planningSummary: some View {
    if !task.text("planned_on").isEmpty || !task.text("deadline").isEmpty
      || !task.text("tags").isEmpty
    {
      HStack(spacing: 12) {
        if !task.text("planned_on").isEmpty {
          Label(task.text("planned_on"), systemImage: "calendar")
        }
        if !task.text("deadline").isEmpty {
          Label("Due " + task.text("deadline"), systemImage: "flag")
        }
        if !task.text("tags").isEmpty { Text(task.text("tags")) }
      }.font(.caption).foregroundStyle(.secondary)
    }
  }
}
struct NativeConversation: View {
  @ObservedObject var store: DeskStore
  let type: String
  let key: String
  @State private var draft = ""
  @State private var initialized = false
  var body: some View {
    let thread = store.thread(type, key)
    VStack(alignment: .leading, spacing: 14) {
      Divider()
      HStack {
        Text("Conversation").font(.headline)
        Spacer()
        Button {
          Task { await store.loadThread(type, key) }
        } label: {
          Image(systemName: "arrow.clockwise")
        }.buttonStyle(.plain).help("Refresh conversation")
      }
      if thread.comments.isEmpty {
        Text("Leave context or send Dot a request.").font(.callout).foregroundStyle(.secondary)
      }
      ForEach(thread.comments) { comment in
        VStack(alignment: .leading, spacing: 6) {
          HStack {
            Text(comment.text("author_kind") == "agent" ? "Dot" : "You").font(
              .callout.weight(.semibold))
            if let date = DeskDates.parse(comment.text("created_at")) {
              Text(date, format: .dateTime.month(.abbreviated).day().hour().minute()).font(.caption)
                .foregroundStyle(.secondary)
            }
            Spacer()
          }
          Text(comment.text("body")).textSelection(.enabled)
          HStack {
            Text(receipt(comment)).font(.caption).foregroundStyle(
              comment.text("local_error").isEmpty ? Color.secondary : Color.orange)
            if comment.text("kind") == "request", comment.text("request_state") == "queued" {
              Button("Cancel request") {
                store.cancelRequest(comment.text("request_id"), type: type, key: key)
              }.buttonStyle(.link).font(.caption)
            }
          }
        }.padding(.vertical, 8)
      }
      if !thread.attachments.isEmpty {
        VStack(alignment: .leading, spacing: 8) {
          ForEach(thread.attachments) { file in
            Button {
              Task { await store.download(file) }
            } label: {
              Label(file.text("filename"), systemImage: "paperclip")
            }.buttonStyle(.link)
          }
        }
      }
      TextEditor(text: $draft).font(.body).frame(minHeight: 75, maxHeight: 160).padding(6)
        .background(Color(nsColor: .controlBackgroundColor)).clipShape(
          RoundedRectangle(cornerRadius: 7)
        ).overlay(RoundedRectangle(cornerRadius: 7).stroke(Color(nsColor: .separatorColor)))
        .accessibilityLabel("Reply or add context")
      HStack {
        Button("Send to Dot") { send(true) }.buttonStyle(.borderedProminent).disabled(
          draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || draft.count > 20000
        ).keyboardShortcut(.return, modifiers: .command)
        Button("Save as reference") { send(false) }.disabled(
          draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || draft.count > 20000)
        Spacer()
        Button {
          chooseFile(store: store, type: type, key: key)
        } label: {
          Image(systemName: "paperclip")
        }.help("Attach a file").disabled(!store.online || store.fileBusy)
      }
      Text("Reference notes keep context. Send to Dot asks for a response.").font(.caption)
        .foregroundStyle(.secondary)
    }.task(id: type + ":" + key) {
      draft = store.draft("comment:" + type + ":" + key)
      initialized = true
      await store.loadThread(type, key)
    }.onChange(of: draft) { text in
      if initialized { store.saveDraft("comment:" + type + ":" + key, text) }
    }
  }
  func send(_ request: Bool) {
    if store.comment(draft, type: type, key: key, request: request) {
      draft = ""
      store.saveDraft("comment:" + type + ":" + key, "")
    }
  }
  func receipt(_ c: DeskRecord) -> String {
    if c.fields["local_pending"]?.flag == true {
      return c.text("local_error").isEmpty
        ? "Saved on this Mac · Waiting to sync" : "Saved on this Mac · Needs review"
    }
    if c.text("kind") == "reference" { return "Reference" }
    switch c.text("request_state") {
    case "answered": return "Dot replied"
    case "acknowledged": return "Dot acknowledged"
    case "cancelled": return "Request cancelled"
    default: return "Saved · Awaiting Dot"
    }
  }
}
struct LinkedNativeNotes: View {
  @ObservedObject var store: DeskStore
  let type: String
  let key: String
  var body: some View {
    let notes = store.linkedNotes(type, key)
    if !notes.isEmpty {
      VStack(alignment: .leading, spacing: 8) {
        Text("Linked notes").font(.callout.weight(.semibold))
        ForEach(notes) { note in Button(note.title) { store.openNote(note.id) }.buttonStyle(.link) }
      }
    }
  }
}
@MainActor func chooseFile(store: DeskStore, type: String, key: String) {
  let panel = NSOpenPanel()
  panel.canChooseDirectories = false
  panel.allowsMultipleSelection = false
  if panel.runModal() == .OK, let url = panel.url {
    Task { await store.attach(url, type: type, key: key) }
  }
}
@MainActor func acceptFileDrop(
  _ providers: [NSItemProvider], store: DeskStore, type: String, key: String
) -> Bool {
  guard let provider = providers.first else { return false }
  provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { item, _ in
    let url =
      (item as? URL) ?? (item as? Data).flatMap { URL(dataRepresentation: $0, relativeTo: nil) }
    if let url { Task { @MainActor in await store.attach(url, type: type, key: key) } }
  }
  return true
}
