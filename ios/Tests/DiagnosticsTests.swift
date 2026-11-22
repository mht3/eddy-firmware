import Foundation

@main
struct DiagnosticsTests {
    static func main() throws {
        let suite = "eddy.tests." + UUID().uuidString
        let defaults = UserDefaults(suiteName: suite)!
        let caches = FileManager.default.temporaryDirectory.appendingPathComponent(suite)
        let legacy = caches.appendingPathComponent("EddyDiagnostics/counts.json")
        defer {
            defaults.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: caches)
        }
        try FileManager.default.createDirectory(at: legacy.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("old counts".utf8).write(to: legacy)
        defaults.set(true, forKey: "eddy.diagnostics.enabled")
        Diagnostics.removeLegacyCounts(defaults: defaults, caches: caches)
        precondition(!FileManager.default.fileExists(atPath: legacy.path))
        precondition(defaults.object(forKey: "eddy.diagnostics.enabled") == nil)
        precondition(!defaults.bool(forKey: Diagnostics.versionPreference))
        defaults.set(true, forKey: Diagnostics.versionPreference)
        Diagnostics.removeLegacyCounts(defaults: defaults, caches: caches)
        precondition(defaults.bool(forKey: Diagnostics.versionPreference))
        precondition(Diagnostics.versionSummary.range(of: #"^Eddy \S+ · iOS [0-9]+\.[0-9]+\.[0-9]+$"#, options: .regularExpression) != nil)
        print("Legacy count removal, separate opt-in and versions-only report passed.")
    }
}
