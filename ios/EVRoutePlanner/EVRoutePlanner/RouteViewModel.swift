import Foundation
import Combine

@MainActor
final class RouteViewModel: ObservableObject {
    @Published var start = ""
    @Published var end = ""
    @Published var waypoints: [String] = []
    @Published var corridorMilesText = "30"
    @Published var autoCorridor = true
    @Published var preference: RoutePreference = .fastest
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var route: RouteResponse?

    let tracker: RouteTracker
    let notificationManager: NotificationManager

    private let apiClient: APIClient

    @MainActor
    init(apiClient: APIClient = APIClient()) {
        self.apiClient = apiClient
        
        // Create main actor-isolated dependencies
        self.notificationManager = NotificationManager()
        self.tracker = RouteTracker(notificationManager: notificationManager)

        Task { @MainActor in
            await notificationManager.refreshStatus()
        }
    }

    var poiCount: Int {
        route?.allPOIs.count ?? 0
    }

    var stationCount: Int {
        route?.stations?.count ?? 0
    }

    var truckStopCount: Int {
        route?.truckStops?.count ?? 0
    }

    var summaryText: String? {
        guard let summary = route?.summary else { return nil }
        let miles = summary.distanceMeters / 1609.344
        let hours = summary.durationSeconds / 3600
        return "\(formatMiles(miles)) mi | \(formatDuration(hours))"
    }

    var warningText: String? {
        route?.warning
    }

    func addWaypoint() {
        waypoints.append("")
    }

    func removeWaypoint(at index: Int) {
        guard waypoints.indices.contains(index) else { return }
        waypoints.remove(at: index)
    }

    func updateWaypoint(at index: Int, value: String) {
        guard waypoints.indices.contains(index) else { return }
        waypoints[index] = value
    }

    func planRoute() async {
        errorMessage = nil
        let trimmedStart = start.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedEnd = end.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedStart.isEmpty, !trimmedEnd.isEmpty else {
            errorMessage = "Start and end are required."
            return
        }

        let cleanedWaypoints = waypoints
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        isLoading = true
        defer { isLoading = false }

        do {
            let request = RouteRequest(
                start: trimmedStart,
                end: trimmedEnd,
                waypoints: cleanedWaypoints,
                corridorMiles: parseCorridorMiles(),
                autoCorridor: autoCorridor,
                includeStations: true,
                preference: preference
            )

            let response = try await apiClient.planRoute(request: request)
            route = response
            tracker.updatePOIs(response.allPOIs)

            if let corridor = response.corridorMiles {
                corridorMilesText = String(format: "%.0f", corridor)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func clearRoute() {
        route = nil
        errorMessage = nil
        tracker.updatePOIs([])
    }

    func setTracking(_ enabled: Bool) {
        tracker.setTracking(enabled)
    }

    private func parseCorridorMiles() -> Double {
        let trimmed = corridorMilesText.trimmingCharacters(in: .whitespacesAndNewlines)
        if let value = Double(trimmed), value >= 0 {
            return value
        }
        return 30
    }

    private func formatMiles(_ miles: Double) -> String {
        if miles < 10 {
            return String(format: "%.1f", miles)
        }
        return String(format: "%.0f", miles)
    }

    private func formatDuration(_ hours: Double) -> String {
        if hours < 1 {
            let minutes = Int(hours * 60)
            return "\(minutes) min"
        }
        if hours < 10 {
            return String(format: "%.1f hr", hours)
        }
        return String(format: "%.0f hr", hours)
    }
}
