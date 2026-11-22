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
            Section {
                NavigationLink("Licenses and credits") { LicensesView() }
            }
        }
        .navigationTitle("Optional diagnostics")
    }
}

private struct LicensesView: View {
    var body: some View {
        List {
            document("Eddy and demo (GPLv3)", file: "LICENSE")
            document("Demo artwork credits", file: "CREDITS.txt", directory: "demo")
        }
        .navigationTitle("Licenses and credits")
    }

    private func document(_ title: String, file: String, directory: String? = nil) -> some View {
        NavigationLink(title) {
            Group {
                if let url = Bundle.main.url(forResource: file, withExtension: nil, subdirectory: directory),
                   let text = try? String(contentsOf: url, encoding: .utf8) {
                    ScrollView {
                        Text(verbatim: text).font(.body).textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading).padding()
                    }
                } else {
                    ContentUnavailableView("Document unavailable", systemImage: "doc")
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
