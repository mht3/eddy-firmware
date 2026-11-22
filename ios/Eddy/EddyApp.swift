import Combine
import SwiftUI
import UIKit

@MainActor
final class EddyPhone: ObservableObject {
    let account = SpotifyAccount()
    let flipper = FlipperConnection()
    @Published var clientID = ""
    private var bridge: LibraryBridge?
    private var activeAccount: String?
    private var accountObservation: AnyCancellable?

    init() {
        clientID = account.clientID
        Diagnostics.removeLegacyCounts()
        flipper.onConnect = { [weak self] in self?.attachLibrary() }
        flipper.onCommand = { [weak self] packet in self?.bridge?.receive(packet) }
        flipper.onDisconnect = { [weak self] in self?.clearLibrary() }
        accountObservation = account.$accountKey.sink { [weak self] key in self?.accountChanged(key) }
    }

    private func clearLibrary() {
        bridge?.stop()
        bridge = nil
    }

    private func attachLibrary() {
        clearLibrary()
        guard let key = account.accountKey else { return }
        let api = SpotifyLibrary { [account] force in
            do { return try await account.accessToken(forceRefresh: force) }
            catch let error as SpotifyAccountError {
                throw LibraryFailure(rawValue: UInt8(clamping: error.deviceCode)) ?? .offline
            }
        }
        let next = LibraryBridge(api: api)
        next.start(accountKey: key) { [flipper] data in try await flipper.write(data) }
        bridge = next
    }

    private func accountChanged(_ key: String?) {
        guard activeAccount != key else { return }
        if activeAccount != nil { flipper.setLibraryEnabled(false) }
        activeAccount = key
        clearLibrary()
        flipper.setLibraryEnabled(activeAccount != nil)
    }
}

@MainActor
private final class EddyAppDelegate: NSObject, UIApplicationDelegate {
    let phone = EddyPhone()

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        phone.flipper.start(restoreBluetooth: options?[.bluetoothCentrals] != nil)
        return true
    }
}

@main
@MainActor
struct EddyApp: App {
    @UIApplicationDelegateAdaptor(EddyAppDelegate.self) private var appDelegate
    var body: some Scene {
        WindowGroup {
            ConnectionView(phone: appDelegate.phone, account: appDelegate.phone.account, flipper: appDelegate.phone.flipper)
        }
    }
}

private let ocean = Color(red: 0.035, green: 0.10, blue: 0.17)
private let surf = Color(red: 0.58, green: 0.81, blue: 1)

@MainActor
private struct ConnectionView: View {
    private enum Tab { case devices, demo }
    @ObservedObject var phone: EddyPhone
    @ObservedObject var account: SpotifyAccount
    @ObservedObject var flipper: FlipperConnection
    @AppStorage("eddy.onboarded") private var onboarded = false
    @State private var step = 0
    @State private var tab = Tab.devices
    @State private var chooser = false
    @State private var accountSheet = false
    @State private var diagnosticsSheet = false
    @State private var didLaunch = false
    @FocusState private var editingClientID: Bool
    @Environment(\.scenePhase) private var phase
    @Environment(\.openURL) private var openURL

    private var nextLabel: String {
        if step == 4 { return "View devices" }
        if (step == 1 && flipper.connectedID == nil) || (step == 2 && !account.isSignedIn) {
            return "Set up later"
        }
        return "Continue"
    }

    var body: some View {
        Group {
            if onboarded {
                TabView(selection: $tab) {
                    devicesPage
                        .tabItem { Label("Devices", systemImage: "dot.radiowaves.left.and.right") }
                        .tag(Tab.devices)
                    NavigationStack {
                        SpotifyDemoView()
                            .background(SpotifyDemoView.canvasColor.ignoresSafeArea())
                            .navigationTitle("Spotify demo")
                            .navigationBarTitleDisplayMode(.inline)
                            .toolbarBackground(.hidden, for: .navigationBar, .tabBar)
                    }
                    .tabItem {
                        Label { Text("Demo") } icon: { Image("EddyMark").renderingMode(.template) }
                    }
                    .tag(Tab.demo)
                }
            } else { welcomeFlow }
        }
        .tint(surf)
        .preferredColorScheme(.dark)
        .onAppear {
            guard !didLaunch else { return }
            didLaunch = true
            if onboarded { flipper.refreshDevices() }
        }
        .onChange(of: step) { _, _ in editingClientID = false }
        .onChange(of: phase) { _, value in
            if value == .active && (onboarded || step == 1) { flipper.refreshDevices() }
        }
        .onChange(of: account.accountKey) { _, _ in
            if account.isSignedIn && step == 2 { withAnimation { step = 3 } }
        }
        .onChange(of: flipper.connectedID) { _, device in
            if device != nil { chooser = false }
        }
        .onOpenURL { url in
            if account.handleSpotifyCallback(url) { return }
            if url.scheme == "eddyspotify", url.host == "setup", onboarded {
                tab = .devices
                if !account.isSignedIn { accountSheet = true }
            }
        }
        .sheet(isPresented: $diagnosticsSheet) {
            NavigationStack {
                DiagnosticsView()
                    .toolbar { Button("Done") { diagnosticsSheet = false } }
            }
        }
        .sheet(isPresented: $chooser, onDismiss: { flipper.stopScanning() }) { deviceChooser }
        .sheet(isPresented: $accountSheet) {
            NavigationStack {
                Form { spotifyControls }
                    .navigationTitle("Spotify account")
                    .toolbar { Button("Done") { accountSheet = false } }
            }.preferredColorScheme(.dark)
        }
    }

    private var welcomeFlow: some View {
        VStack(spacing: 12) {
            TabView(selection: $step) {
                panel("Welcome to Eddy!", symbol: nil) {
                    Text("Connect your Flipper Zero and bring your Spotify library to its screen.")
                }.tag(0)
                panel("Connect your device", symbol: "antenna.radiowaves.left.and.right") {
                    Text("Turn on Bluetooth on your Flipper running Eddy firmware.")
                    if let name = flipper.connectedName {
                        Label(name, systemImage: "checkmark.circle.fill")
                    } else {
                        Button("Connect device") { openChooser() }.buttonStyle(.borderedProminent)
                    }
                }.tag(1)
                panel("Log in to Spotify", symbol: "music.note.list") { spotifyControls }.tag(2)
                panel("Optional diagnostics", symbol: "hand.raised.fill") {
                    DiagnosticsPreferences()
                }.tag(3)
                panel("You’re all set!", symbol: "checkmark.circle") {
                    if flipper.connectedID != nil && account.isSignedIn {
                        Text("Open Apps → Spotify on your Flipper to browse your playlists.")
                    } else {
                        Text("You can finish setting up your Flipper and Spotify in Devices.")
                    }
                }.tag(4)
            }
            #if os(iOS)
            .tabViewStyle(.page(indexDisplayMode: .never))
            #endif
            HStack(spacing: 7) {
                ForEach(0..<5) { index in
                    Capsule().fill(index == step ? surf : .white.opacity(0.3))
                        .frame(width: index == step ? 22 : 7, height: 7)
                }
            }.accessibilityElement(children: .ignore).accessibilityLabel("Step \(step + 1) of 5")
            Button(nextLabel) {
                if step == 4 { onboarded = true; flipper.refreshDevices() }
                else { withAnimation { step += 1 } }
            }
            .buttonStyle(.borderedProminent).controlSize(.large)
            .padding(.vertical, 4)
            Button("Diagnostics") { diagnosticsSheet = true }
                .font(.footnote).padding(.bottom, 6)
        }
        .background(ocean.ignoresSafeArea())
    }

    private func panel<Content: View>(_ title: String, symbol: String?, @ViewBuilder content: () -> Content) -> some View {
        ScrollView {
            VStack(spacing: 24) {
                if let symbol {
                    Image(systemName: symbol).font(.system(size: 58, weight: .light)).foregroundStyle(surf)
                        .frame(height: 100).accessibilityHidden(true)
                } else {
                    Image("EddyMark").resizable().scaledToFit().frame(height: 100).accessibilityHidden(true)
                }
                Text(title).font(.largeTitle.bold()).accessibilityAddTraits(.isHeader)
                content()
            }
            .frame(maxWidth: 420)
            .padding(.horizontal, 26)
            .padding(.vertical, 48)
            .frame(maxWidth: .infinity)
        }
        .multilineTextAlignment(.center)
    }

    @ViewBuilder private var spotifyControls: some View {
        if account.isSignedIn {
            Label("Spotify linked", systemImage: "checkmark.circle.fill")
            if onboarded {
                Link("Open Spotify", destination: URL(string: "https://open.spotify.com/")!)
                Button("Sign out", role: .destructive) { account.signOut() }
            }
        } else {
            if (try? SpotifyOAuth.clientID(phone.clientID)) == nil {
                Text("Copy your Client ID from your Spotify developer app and paste it here.")
            }
            TextField("Spotify Client ID", text: $phone.clientID)
                .textFieldStyle(.roundedBorder).autocorrectionDisabled()
                .focused($editingClientID)
                .submitLabel(.done)
                .onSubmit { editingClientID = false }
                #if os(iOS)
                .textInputAutocapitalization(.never).keyboardType(.asciiCapable)
                #endif
            Button(account.isSigningIn ? "Signing in…" : "Log in to Spotify") {
                Task { await account.signIn(clientID: phone.clientID) }
            }
            .disabled(account.isSigningIn || (try? SpotifyOAuth.clientID(phone.clientID)) == nil)
            .buttonStyle(.borderedProminent)
            Button("Use browser for sign-in") {
                Task { await account.signIn(clientID: phone.clientID, preferSpotifyApp: false) }
            }
            .disabled((account.isSigningIn && !account.waitingForSpotifyApp) || (try? SpotifyOAuth.clientID(phone.clientID)) == nil)
        }
        if !account.status.isEmpty { Text(account.status).font(.footnote).foregroundStyle(.secondary) }
    }

    private func openChooser() { flipper.scan(); chooser = true }

    private var deviceChooser: some View {
        NavigationStack {
            List {
                Text(flipper.status).foregroundStyle(.secondary)
                ForEach(flipper.devices) { device in
                    let connected = flipper.connectedID == device.id
                    Button {
                        if connected { chooser = false }
                        else { flipper.select(device.id) }
                    } label: {
                        Label(device.name, systemImage: connected ? "checkmark.circle" : "dot.radiowaves.left.and.right")
                    }
                    .accessibilityValue(connected ? "Connected" : "")
                }
            }
            .navigationTitle("Connect device")
            .toolbar { Button("Done") { chooser = false } }
        }
        .preferredColorScheme(.dark)
    }

    private var otherFlippers: [FlipperConnection.Device] {
        let nearby = flipper.devices.filter { device in
            flipper.systemConnectedIDs.contains(device.id) && !flipper.savedDevices.contains { $0.id == device.id }
        }
        return (flipper.savedDevices + nearby).filter { $0.id != flipper.connectedID }
    }

    private var flipperCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 14) {
                Image("EddyMark").resizable().scaledToFit().frame(width: 42, height: 42)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(flipper.connectedName ?? "Flipper Zero")
                        .font(.title2.bold()).accessibilityAddTraits(.isHeader)
                    if flipper.connectedID != nil {
                        Label("Bluetooth connected", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(surf)
                    } else {
                        Text(flipper.status).foregroundStyle(.secondary)
                    }
                }
                .font(.subheadline)
                .frame(maxWidth: .infinity, alignment: .leading)
                if let device = flipper.connectedID {
                    Menu {
                        Button("Connect another device", systemImage: "plus") { openChooser() }
                        Button("Disconnect", systemImage: "antenna.radiowaves.left.and.right.slash") {
                            flipper.disconnect()
                        }
                        Button("Forget device", systemImage: "trash", role: .destructive) { flipper.forget(device) }
                    } label: {
                        Image(systemName: "ellipsis.circle").frame(minWidth: 44, minHeight: 44)
                    }
                    .accessibilityLabel("Manage connected Flipper")
                }
            }
            if flipper.connectedID == nil {
                Group {
                    switch flipper.bluetoothState {
                    case .unauthorized:
                        Button("Open Settings", systemImage: "gear") {
                            if let settings = URL(string: UIApplication.openSettingsURLString) { openURL(settings) }
                        }
                    case .unsupported:
                        Button("Try the demo", systemImage: "play") { tab = .demo }
                    default:
                        Button("Connect device", systemImage: "plus") { openChooser() }
                    }
                }
                .buttonStyle(ConnectionButtonStyle())
            } else if account.isSignedIn {
                Text(flipper.firmwareLibraryEnabled
                     ? "Open Apps → Spotify on your Flipper."
                     : "Connecting your Spotify library…")
                    .font(.callout)
            }
        }
        .padding(18)
        .listRowInsets(EdgeInsets())
        .listRowBackground(LinearGradient(colors: [Color(red: 0.08, green: 0.22, blue: 0.34), ocean],
                                           startPoint: .topLeading, endPoint: .bottomTrailing))
    }

    private var devicesPage: some View {
        NavigationStack {
            List {
                Section { flipperCard }
                if !otherFlippers.isEmpty {
                    Section(flipper.connectedID == nil ? "Saved and nearby" : "Other devices") {
                        ForEach(otherFlippers) { device in
                            Button { flipper.select(device.id) } label: {
                                LabeledContent {
                                    Text("Connect")
                                } label: {
                                    Text(device.name).foregroundStyle(.primary)
                                    Text(flipper.systemConnectedIDs.contains(device.id) ? "Connected to iPhone" : "Saved")
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .swipeActions {
                                if flipper.savedDevices.contains(where: { $0.id == device.id }) {
                                    Button("Forget", role: .destructive) { flipper.forget(device.id) }
                                }
                            }
                        }
                    }
                }
                Section {
                    Button { accountSheet = true } label: {
                        LabeledContent {
                            Text(account.isSignedIn ? "Linked" : "Log in").foregroundStyle(surf)
                        } label: {
                            Label("Spotify", systemImage: "music.note.list")
                        }
                    }
                    Link(destination: URL(string: "https://ko-fi.com/mhtaylor")!) {
                        Label("Buy me a Coffee", systemImage: "cup.and.saucer")
                    }
                    NavigationLink { DiagnosticsView() } label: {
                        Label("Diagnostics", systemImage: "stethoscope")
                    }
                }
                .listRowBackground(Color(red: 0.065, green: 0.15, blue: 0.23))
            }
            .scrollContentBackground(.hidden)
            .background(ocean)
            .navigationTitle("Devices")
        }
    }
}

private struct ConnectionButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline).foregroundStyle(ocean)
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(surf.opacity(configuration.isPressed ? 0.7 : 1), in: RoundedRectangle(cornerRadius: 12))
    }
}
