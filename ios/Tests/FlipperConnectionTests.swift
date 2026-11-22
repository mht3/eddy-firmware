import Foundation

@main
struct FlipperConnectionTests {
    @MainActor
    static func main() {
        let suite = "eddy.bluetooth.tests." + UUID().uuidString
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }

        func launchWithoutBluetooth() -> FlipperConnection {
            let connection = FlipperConnection(defaults: defaults) { _ in
                preconditionFailure("An idle launch must not create a Bluetooth manager")
            }
            connection.start(restoreBluetooth: false)
            return connection
        }
        precondition(launchWithoutBluetooth().selectedID == nil)

        // A previous installation with one selected Flipper should still reconnect automatically.
        let id = UUID()
        defaults.set(id.uuidString, forKey: "eddy.spotify.peripheral")
        let original = FlipperConnection(defaults: defaults)
        precondition(original.selectedID == id && original.savedDevices.map(\.id) == [id])

        original.disconnect()
        let relaunched = launchWithoutBluetooth()
        precondition(relaunched.selectedID == nil && relaunched.savedDevices.map(\.id) == [id])
        relaunched.forget(id)
        precondition(FlipperConnection(defaults: defaults).savedDevices.isEmpty)
        print("Fresh and explicitly disconnected launches leave Bluetooth idle; saved devices survive until forgotten.")
    }
}
