import Cocoa
import Sparkle

@MainActor
// Sparkle's Objective-C UI delegate calls run on the main thread.
final class Updates: NSObject, NSMenuItemValidation, @preconcurrency SPUStandardUserDriverDelegate {
  private lazy var controller = SPUStandardUpdaterController(
    startingUpdater: false, updaterDelegate: nil, userDriverDelegate: self
  )
  private var updateAvailable = false
  var availabilityChanged: ((Bool) -> Void)?

  func check() { controller.checkForUpdates(nil) }
  var checksAutomatically: Bool {
    get { controller.updater.automaticallyChecksForUpdates }
    set { controller.updater.automaticallyChecksForUpdates = newValue }
  }
  var installsAutomatically: Bool {
    get { controller.updater.automaticallyDownloadsUpdates }
    set { controller.updater.automaticallyDownloadsUpdates = newValue }
  }

  func start() {
    controller.startUpdater()
  }

  func addMenuItems(to menu: NSMenu) {
    let check = NSMenuItem(
      title: updateAvailable ? "Install Update…" : "Check for Updates…",
      action: #selector(SPUStandardUpdaterController.checkForUpdates(_:)), keyEquivalent: ""
    )
    check.target = controller
    menu.addItem(check)
    for (title, action) in [
      ("Automatically check for updates", #selector(toggleChecks)),
      ("Automatically install updates", #selector(toggleDownloads)),
    ] {
      let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
      item.target = self
      menu.addItem(item)
    }
  }

  @objc private func toggleChecks() {
    controller.updater.automaticallyChecksForUpdates.toggle()
  }

  @objc private func toggleDownloads() {
    controller.updater.automaticallyDownloadsUpdates.toggle()
  }

  func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
    if menuItem.action == #selector(toggleChecks) {
      menuItem.state = controller.updater.automaticallyChecksForUpdates ? .on : .off
    } else if menuItem.action == #selector(toggleDownloads) {
      menuItem.state = controller.updater.automaticallyDownloadsUpdates ? .on : .off
      return controller.updater.automaticallyChecksForUpdates
    }
    return true
  }

  // Scheduled alerts stay out of the way. The menu bar icon indicates a pending update.
  var supportsGentleScheduledUpdateReminders: Bool { true }

  func standardUserDriverShouldHandleShowingScheduledUpdate(
    _ update: SUAppcastItem, andInImmediateFocus immediateFocus: Bool
  ) -> Bool {
    immediateFocus
  }

  func standardUserDriverWillHandleShowingUpdate(
    _ handleShowingUpdate: Bool, forUpdate update: SUAppcastItem, state: SPUUserUpdateState
  ) {
    setUpdateAvailable(!state.userInitiated)
  }

  func standardUserDriverDidReceiveUserAttention(forUpdate update: SUAppcastItem) {
    setUpdateAvailable(false)
  }

  func standardUserDriverWillFinishUpdateSession() {
    setUpdateAvailable(false)
  }

  private func setUpdateAvailable(_ available: Bool) {
    updateAvailable = available
    availabilityChanged?(available)
  }
}
