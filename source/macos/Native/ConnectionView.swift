import SwiftUI
import UniformTypeIdentifiers

struct ConnectionView: View {
  @ObservedObject var store: DeskStore
  @Environment(\.dismiss) private var dismiss
  @State private var address = ""
  @State private var importing = false
  @State private var message = ""
  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      Image(systemName: "externaldrive.connected.to.line.below").font(.system(size: 30))
        .foregroundStyle(.tint)
      Text("Connect your workspace").font(.title2.weight(.semibold))
      Text(
        "Import the connection file from your setup agent, or enter your private workspace address. Your data stays in your own hosting account."
      )
      .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
      TextField("https://your-workspace…", text: $address).textFieldStyle(.roundedBorder)
        .accessibilityLabel("Workspace address").onSubmit(connect)
      if let current = store.connection {
        Text("Current workspace: " + (current.url.host ?? "")).font(.caption).foregroundStyle(
          .secondary)
      }
      if !message.isEmpty { Text(message).font(.callout).foregroundStyle(.orange) }
      if !store.connectionError.isEmpty {
        Text(store.connectionError).font(.callout).foregroundStyle(.orange)
      }
      HStack {
        Button("Import connection file…") { importing = true }
        Spacer()
        if store.connection != nil { Button("Close") { dismiss() }.keyboardShortcut(.cancelAction) }
        if store.connecting { ProgressView().controlSize(.small) }
        Button(store.pendingConnection == nil ? "Connect" : "Continue sign-in", action: connect)
          .keyboardShortcut(.defaultAction).disabled(
            store.connecting
              || address.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                && store.pendingConnection == nil
          )
      }
      Text(
        "The app checks the workspace version and your signed-in account before syncing. Existing unsynced work must finish before you change workspaces."
      )
      .font(.caption).foregroundStyle(.secondary)
    }.padding(26).frame(width: 520).onAppear {
      address = store.pendingConnection?.workspaceURL ?? ""
    }
    .fileImporter(
      isPresented: $importing, allowedContentTypes: [.json, .data], allowsMultipleSelection: false
    ) { result in
      do {
        guard let url = try result.get().first else { return }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let value = try WorkspaceConnection.read(url)
        address = value.workspaceURL
        Task { if await store.connect(value) { dismiss() } }
      } catch { message = error.localizedDescription }
    }
  }
  func connect() {
    do {
      let value = try
        (store.pendingConnection
        ?? WorkspaceConnection(
          workspaceURL: address.trimmingCharacters(in: .whitespacesAndNewlines))).validated()
      Task { if await store.connect(value) { dismiss() } }
    } catch { message = error.localizedDescription }
  }
}
