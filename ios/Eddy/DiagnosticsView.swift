import SwiftUI
import UIKit

struct DiagnosticsPreferences: View {
    @AppStorage(Diagnostics.versionPreference) private var includeVersions = false

    var body: some View {
        Toggle("Include app and iOS versions", isOn: $includeVersions)
        Text("Eddy adds no personal information. Reports include only the issue you send and the versions you choose to share.")
            .font(.subheadline).foregroundStyle(.secondary)
    }
}

struct DiagnosticsView: View {
    @AppStorage(Diagnostics.versionPreference) private var includeVersions = false
    @Environment(\.openURL) private var openURL

    var body: some View {
        Form {
            Section { DiagnosticsPreferences() }
            Section {
                Button(includeVersions ? "Copy versions and report an issue" : "Report an issue on GitHub") {
                    if includeVersions {
                        UIPasteboard.general.setItems([["public.utf8-plain-text": Diagnostics.versionSummary]],
                            options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(600)])
                    }
                    openURL(URL(string: "https://github.com/mht3/eddy-firmware/issues/new?body=")!)
                }
            } footer: {
                Text(includeVersions
                     ? "Paste the versions into your issue. GitHub publishes it under your username."
                     : "GitHub publishes submitted issues under your username.")
            }
        }
        .navigationTitle("Optional diagnostics")
    }
}
