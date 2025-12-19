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
    @Published private(set) var cachedRoute: CachedRouteResponse?

    let tracker: RouteTracker
    let notificationManager: NotificationManager

    private let apiClient: APIClient
    private var currentRouteTask: Task<Void, Never>?

    // Debounce support
    private var planRouteSubject = PassthroughSubject<Void, Never>()
    private var cancellables = Set<AnyCancellable>()

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

    // Convenience accessor for the underlying RouteResponse
    var route: RouteResponse? {
        cachedRoute?.response
    }

    var poiCount: Int {
        cachedRoute?.allPOIs.count ?? 0
    }

    var stationCount: Int {
        route?.stations?.count ?? 0
    }

    var truckStopCount: Int {
        route?.truckStops?.count ?? 0
    }

    // Cached summary text to avoid repeated formatting
    private var _cachedSummaryText: String?
    private var _lastSummaryRoute: ObjectIdentifier?

    var summaryText: String? {
        guard let cached = cachedRoute else {
            _cachedSummaryText = nil
            _lastSummaryRoute = nil
            return nil
        }

        let currentId = ObjectIdentifier(cached)
        if currentId == _lastSummaryRoute, let text = _cachedSummaryText {
            return text
        }

        let summary = cached.response.summary
        let miles = summary.distanceMeters / 1609.344
        let hours = summary.durationSeconds / 3600
        let text = "\(formatMiles(miles)) mi | \(formatDuration(hours))"

        _cachedSummaryText = text
        _lastSummaryRoute = currentId
        return text
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
        // Cancel any in-flight request
        currentRouteTask?.cancel()

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

        let task = Task { @MainActor in
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

                // Check for cancellation before making request
                try Task.checkCancellation()

                let response = try await apiClient.planRoute(request: request)

                // Check for cancellation after receiving response
                try Task.checkCancellation()

                let cached = CachedRouteResponse(response)
                cachedRoute = cached
                tracker.updatePOIs(cached.allPOIs)

                if let corridor = response.corridorMiles {
                    corridorMilesText = String(format: "%.0f", corridor)
                }
            } catch is CancellationError {
                // Request was cancelled, don't update error message
            } catch {
                errorMessage = error.localizedDescription
            }
        }

        currentRouteTask = task
    }

    func clearRoute() {
        currentRouteTask?.cancel()
        cachedRoute = nil
        errorMessage = nil
        tracker.updatePOIs([])
        _cachedSummaryText = nil
        _lastSummaryRoute = nil
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
