import Foundation

enum Diagnostics {
    static let versionPreference = "eddy.diagnostics.includeVersions"

    static var versionSummary: String {
        let app = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown"
        let ios = ProcessInfo.processInfo.operatingSystemVersion
        return "Eddy \(app) · iOS \(ios.majorVersion).\(ios.minorVersion).\(ios.patchVersion)"
    }

    // Early prototypes kept optional event counts. Discard that data on upgrade.
    static func removeLegacyCounts(defaults: UserDefaults = .standard, caches: URL? = nil) {
        defaults.removeObject(forKey: "eddy.diagnostics.enabled")
        let base = caches ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        try? FileManager.default.removeItem(at: base.appendingPathComponent("EddyDiagnostics/counts.json"))
    }
}
