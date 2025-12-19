import Foundation
import Combine
import UserNotifications

@MainActor
final class NotificationManager: ObservableObject {
    @Published private(set) var authorizationStatus: UNAuthorizationStatus = .notDetermined

    private let center = UNUserNotificationCenter.current()

    func refreshStatus() async {
        let settings = await center.notificationSettings()
        authorizationStatus = settings.authorizationStatus
    }

    func requestAuthorization() async {
        do {
            _ = try await center.requestAuthorization(options: [.alert, .sound, .badge])
        } catch {
            // Ignore errors; status refresh will reflect current state.
        }
        await refreshStatus()
    }

    func sendProximityAlert(for poi: RoutePOI, distanceMiles: Double) {
        guard authorizationStatus == .authorized || authorizationStatus == .provisional else {
            return
        }

        let milesText = formatDistance(distanceMiles)
        let content = UNMutableNotificationContent()
        content.title = "Approaching stop"
        content.body = "\(poi.name) in \(milesText) miles"
        content.sound = .default

        let request = UNNotificationRequest(identifier: poi.id, content: content, trigger: nil)
        center.add(request)
    }

    private func formatDistance(_ miles: Double) -> String {
        if miles < 1 {
            return String(format: "%.1f", miles)
        }
        if miles < 10 {
            return String(format: "%.1f", miles)
        }
        return String(format: "%.0f", miles)
    }
}
