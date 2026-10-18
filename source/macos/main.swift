import Carbon
import Cocoa
import SwiftUI
import UserNotifications
import WebKit

@MainActor
final class NativeAppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate,
  UNUserNotificationCenterDelegate
{
  let updates = Updates()
  var store: DeskStore { DeskStore.shared }
  private var authOrigin: URL?
  private var authWindow: NSWindow?
  private var authWeb: WKWebView?
  private var popupWindows: [NSWindow] = []
  private var captureWindow: NSPanel?
  private var hotKey: EventHotKeyRef?
  private var eventHandler: EventHandlerRef?
  private var attached = false
  func applicationDidFinishLaunching(_ notification: Notification) {
    if let index = CommandLine.arguments.firstIndex(of: "--export-verification"),
      index + 1 < CommandLine.arguments.count
    {
      NSApp.setActivationPolicy(.prohibited)
      let destination = URL(fileURLWithPath: CommandLine.arguments[index + 1], isDirectory: true)
      Task {
        do {
          try await VerificationExport.run(to: destination)
          print("Private verification export completed.")
        } catch {
          fputs("Verification export failed: " + error.localizedDescription + "\n", stderr)
          exit(EXIT_FAILURE)
        }
        NSApp.terminate(nil)
      }
      return
    }
    let preview =
      CommandLine.arguments.contains("--native-preview")
      || CommandLine.arguments.contains("--offline-preview")
    let others = NSRunningApplication.runningApplications(
      withBundleIdentifier: Bundle.main.bundleIdentifier ?? "app.passforth.mac"
    ).filter { $0.processIdentifier != ProcessInfo.processInfo.processIdentifier }
    if !preview && !others.isEmpty {
      DistributedNotificationCenter.default().postNotificationName(
        Notification.Name((Bundle.main.bundleIdentifier ?? "app.passforth.mac") + ".show"),
        object: nil, userInfo: nil,
        deliverImmediately: true)
      NSApp.terminate(nil)
      return
    }
    NSApp.setActivationPolicy(.regular)
    DistributedNotificationCenter.default().addObserver(
      self, selector: #selector(openWorkspace),
      name: Notification.Name((Bundle.main.bundleIdentifier ?? "app.passforth.mac") + ".show"),
      object: nil)
    updates.start()
    updates.availabilityChanged = { [weak self] value in self?.store.updateAvailable = value }
    UNUserNotificationCenter.current().delegate = self
    attach()
    registerCaptureShortcut()
    if let index = CommandLine.arguments.firstIndex(of: "--workspace-file"),
      index + 1 < CommandLine.arguments.count
    {
      store.importConnection(URL(fileURLWithPath: CommandLine.arguments[index + 1]))
    }
  }
  func attach() {
    guard !attached else { return }
    attached = true
    store.signInAction = { [weak self] in self?.signIn() }
    store.quickCaptureAction = { [weak self] in self?.showQuickCapture() }
    store.showWorkspaceAction = { [weak self] in self?.openWorkspace() }
  }
  @objc func openWorkspace() {
    NSApp.activate(ignoringOtherApps: true)
    if let window = NSApp.windows.first(where: {
      $0.identifier?.rawValue == "main" || $0.title == "Passforth" && $0 !== authWindow
    }) {
      window.makeKeyAndOrderFront(nil)
    } else {
      store.openSceneAction?()
    }
  }
  func focusSearch() {
    openWorkspace()
    DispatchQueue.main.async {
      guard let window = NSApp.windows.first(where: { $0.identifier?.rawValue == "main" }) else {
        return
      }
      if let item = window.toolbar?.items.compactMap({ $0 as? NSSearchToolbarItem }).first {
        item.beginSearchInteraction()
        window.makeFirstResponder(item.searchField)
        item.searchField.selectText(nil)
        return
      }
      func find(_ view: NSView) -> NSSearchField? {
        if let search = view as? NSSearchField { return search }
        return view.subviews.lazy.compactMap { find($0) }.first
      }
      if let root = window.contentView?.superview, let search = find(root) {
        window.makeFirstResponder(search)
        search.selectText(nil)
      }
    }
  }
  @objc func showQuickCapture() {
    if let window = captureWindow {
      NSApp.activate(ignoringOtherApps: true)
      window.makeKeyAndOrderFront(nil)
      return
    }
    let panel = NSPanel(
      contentRect: NSRect(x: 0, y: 0, width: 520, height: 180),
      styleMask: [.titled, .closable, .utilityWindow], backing: .buffered, defer: false)
    panel.title = "Quick capture"
    panel.isReleasedWhenClosed = false
    panel.level = .floating
    panel.center()
    panel.contentViewController = NSHostingController(
      rootView: CaptureSheet(
        store: store,
        onSaved: { [weak self] in
          self?.captureWindow?.close()
          self?.captureWindow = nil
        },
        onClose: { [weak self] in
          self?.captureWindow?.close()
          self?.captureWindow = nil
        }))
    captureWindow = panel
    NotificationCenter.default.addObserver(
      forName: NSWindow.willCloseNotification, object: panel, queue: .main
    ) { [weak self] _ in MainActor.assumeIsolated { self?.captureWindow = nil } }
    NSApp.activate(ignoringOtherApps: true)
    panel.makeKeyAndOrderFront(nil)
  }
  private func registerCaptureShortcut() {
    var spec = EventTypeSpec(
      eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
    InstallEventHandler(
      GetApplicationEventTarget(),
      { _, _, pointer in
        guard let pointer else { return OSStatus(eventNotHandledErr) }
        let delegate = Unmanaged<NativeAppDelegate>.fromOpaque(pointer).takeUnretainedValue()
        Task { @MainActor in delegate.showQuickCapture() }
        return noErr
      }, 1, &spec, Unmanaged.passUnretained(self).toOpaque(), &eventHandler)
    let id = EventHotKeyID(signature: 0x444F_5444, id: 1)
    RegisterEventHotKey(
      UInt32(kVK_Space), UInt32(controlKey | optionKey), id, GetApplicationEventTarget(), 0, &hotKey
    )
  }
  func application(_ sender: NSApplication, openFiles filenames: [String]) {
    for filename in filenames { store.importConnection(URL(fileURLWithPath: filename)) }
    openWorkspace()
  }
  func signIn() {
    guard let origin = store.pendingConnection?.url ?? store.connection?.url else {
      store.connectionPresented = true
      openWorkspace()
      return
    }
    if authOrigin != nil && authOrigin != origin {
      authWindow?.close()
      authWindow = nil
      authWeb = nil
    }
    authOrigin = origin
    if let window = authWindow {
      NSApp.activate(ignoringOtherApps: true)
      window.makeKeyAndOrderFront(nil)
      return
    }
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .default()
    let web = WKWebView(frame: .zero, configuration: config)
    web.navigationDelegate = self
    web.uiDelegate = self
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 580, height: 730),
      styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
    window.title = "Sign in to Passforth"
    window.contentView = web
    window.isReleasedWhenClosed = false
    window.center()
    authWindow = window
    authWeb = web
    NotificationCenter.default.addObserver(
      forName: NSWindow.willCloseNotification, object: window, queue: .main
    ) { [weak self] _ in
      MainActor.assumeIsolated {
        self?.authWindow = nil
        self?.authWeb = nil
        Task { await self?.store.refresh() }
      }
    }
    NSApp.activate(ignoringOtherApps: true)
    window.makeKeyAndOrderFront(nil)
    web.load(
      URLRequest(
        url: URL(string: "signin-with-chatgpt?return_to=%2F", relativeTo: origin)!.absoluteURL
      ))
  }
  func webView(
    _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    guard let url = action.request.url, url.scheme == "https" || url.scheme == "about" else {
      decisionHandler(.cancel)
      return
    }
    decisionHandler(.allow)
  }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    guard webView.url?.host == authOrigin?.host, webView.url?.path == "/" else { return }
    Task {
      let connected: Bool
      if let pending = store.pendingConnection {
        connected = await store.connect(pending, openSignIn: false)
      } else {
        await store.refresh()
        connected = !store.needsSignIn && !store.account.isEmpty
      }
      if connected {
        authWindow?.close()
        popupWindows.forEach { $0.close() }
        popupWindows = []
        openWorkspace()
      }
    }
  }
  func webView(
    _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
    for action: WKNavigationAction, windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    let child = WKWebView(frame: .zero, configuration: configuration)
    child.navigationDelegate = self
    child.uiDelegate = self
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 580, height: 730),
      styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
    window.title = "Passforth sign-in"
    window.contentView = child
    window.isReleasedWhenClosed = false
    popupWindows.append(window)
    window.center()
    window.makeKeyAndOrderFront(nil)
    return child
  }
  func webViewDidClose(_ view: WKWebView) {
    popupWindows.first { $0.contentView === view }?.close()
  }
  func userNotificationCenter(
    _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse
  ) async {
    let info = response.notification.request.content.userInfo
    if let workspace = info["workspace"] as? String, workspace != store.connection?.cacheNamespace {
      store.connectionPresented = true
      openWorkspace()
      return
    }
    if let key = info["target_key"] as? String {
      if info["target_type"] as? String == "note" {
        store.openNote(key)
      } else if info["target_type"] as? String == "project" {
        store.route = "project:" + key
        store.selectedTask = nil
        openWorkspace()
      } else {
        store.route = "all"
        store.openTask(key)
      }
    }
  }
  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool
  {
    openWorkspace()
    return true
  }
  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
  func applicationWillTerminate(_ notification: Notification) {
    if let hotKey { UnregisterEventHotKey(hotKey) }
    if let eventHandler { RemoveEventHandler(eventHandler) }
  }
}

struct MenuCompanion: View {
  @ObservedObject var store: DeskStore
  @Environment(\.openWindow) var openWindow
  @State private var title = ""
  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      Text("Quick capture").font(.headline)
      TextField("What do you want to remember?", text: $title).textFieldStyle(.roundedBorder)
        .onSubmit(capture).accessibilityLabel("Quick capture task")
      if !store.notice.isEmpty { Text(store.notice).font(.caption).foregroundStyle(.secondary) }
      Divider()
      HStack {
        Text("Needs you").font(.headline)
        Spacer()
        Text("\(store.needsYou.count)").foregroundStyle(.secondary)
      }
      if store.needsYou.isEmpty {
        Text("No requests need your answer.").font(.callout).foregroundStyle(.secondary)
      }
      ForEach(Array(store.needsYou.prefix(3))) { task in
        Button {
          store.selectedTask = task.id
          store.route = "you"
          open()
        } label: {
          VStack(alignment: .leading, spacing: 3) {
            Text(task.title).font(.body.weight(.medium))
            Text(task.text("blocker")).font(.caption).foregroundStyle(.secondary).lineLimit(2)
          }.frame(maxWidth: .infinity, alignment: .leading)
        }.buttonStyle(.plain)
      }
      Divider()
      HStack {
        Button("Open workspace", action: open).keyboardShortcut("o")
        Spacer()
        Menu {
          Button("Quick capture") { store.quickCaptureAction?() }
          Button("Sync now") { Task { await store.refresh() } }
          Button("Settings…") {
            open()
            store.settingsPresented = true
          }
          Divider()
          Button("Quit Passforth") { NSApp.terminate(nil) }
        } label: {
          Image(systemName: "ellipsis.circle")
        }.menuStyle(.borderlessButton).fixedSize()
      }
      Text(store.statusText).font(.caption2).foregroundStyle(.secondary)
    }.padding(18).frame(width: 340).onAppear { title = store.draft("capture") }.onChange(of: title)
    { store.saveDraft("capture", $0) }
  }
  func capture() {
    if store.capture(title) {
      title = ""
      store.saveDraft("capture", "")
    }
  }
  func open() {
    openWindow(id: "main")
    NSApp.activate(ignoringOtherApps: true)
  }
}

@main struct DotDesk: App {
  @NSApplicationDelegateAdaptor(NativeAppDelegate.self) var delegate
  @StateObject private var store = DeskStore.shared
  @AppStorage("showMenuBarExtra") private var showMenuBarExtra = true
  var body: some Scene {
    Window("Passforth", id: "main") { NativeWorkspace(store: store).onAppear { delegate.attach() } }
      .defaultSize(width: 1160, height: 760)
      .commands {
        CommandGroup(replacing: .newItem) {
          Button("New Task…") {
            delegate.openWorkspace()
            store.capturePresented = true
          }.keyboardShortcut("n")
          Button("New Note…") {
            delegate.openWorkspace()
            store.route = "notes"
            store.showNewNote = true
          }.keyboardShortcut("n", modifiers: [.command, .shift])
        }
        CommandGroup(replacing: .appSettings) {
          Button("Settings…") {
            delegate.openWorkspace()
            store.settingsPresented = true
          }.keyboardShortcut(",")
        }
        CommandGroup(after: .appInfo) {
          Button("Check for Updates…") { delegate.updates.check() }
          Toggle(
            "Automatically check for updates",
            isOn: Binding(
              get: { delegate.updates.checksAutomatically },
              set: { delegate.updates.checksAutomatically = $0 }))
          Toggle(
            "Automatically install updates",
            isOn: Binding(
              get: { delegate.updates.installsAutomatically },
              set: { delegate.updates.installsAutomatically = $0 }))
        }
        CommandGroup(after: .textEditing) {
          Button("Find…") { delegate.focusSearch() }.keyboardShortcut("f")
        }
        CommandGroup(after: .toolbar) {
          Button("Sync saved work") { Task { await store.refresh() } }.keyboardShortcut("r")
          Button("Quick Capture…") { delegate.showQuickCapture() }.keyboardShortcut(
            .space, modifiers: [.control, .option])
        }
      }
    MenuBarExtra(isInserted: $showMenuBarExtra) {
      MenuCompanion(store: store)
    } label: {
      Label(
        store.needsYou.isEmpty ? "Passforth" : "\(store.needsYou.count)",
        systemImage: store.updateAvailable ? "arrow.down.circle" : "circle.dotted")
    }.menuBarExtraStyle(.window)
  }
}
