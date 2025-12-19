import CoreLocation
import Foundation
import Combine

@MainActor
final class RouteTracker: NSObject, ObservableObject {
    @Published private(set) var authorizationStatus: CLAuthorizationStatus
    @Published private(set) var lastLocation: CLLocation?
    @Published private(set) var isTracking = false

    private let locationManager = CLLocationManager()
    private let notificationManager: NotificationManager
    private var pois: [RoutePOI] = []
    private var notifiedPOIIds = Set<String>()

    // Spatial index: POIs grouped by grid cell for faster lookup
    private var poiGrid: [GridCell: [RoutePOI]] = [:]
    private let gridCellSizeDegrees: Double = 0.1 // ~11km at equator, ~7km at 45° latitude

    let alertDistanceMiles: Double = 5

    private var supportsBackgroundLocation: Bool {
        guard let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] else {
            return false
        }
        return modes.contains("location")
    }

    init(notificationManager: NotificationManager) {
        self.notificationManager = notificationManager
        authorizationStatus = locationManager.authorizationStatus
        super.init()

        locationManager.delegate = self
        locationManager.activityType = .automotiveNavigation
        locationManager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        locationManager.distanceFilter = 50
        locationManager.pausesLocationUpdatesAutomatically = false
        locationManager.allowsBackgroundLocationUpdates = false
    }

    func updatePOIs(_ newPOIs: [RoutePOI]) {
        pois = newPOIs
        notifiedPOIIds.removeAll()
        rebuildSpatialIndex()
    }

    func setTracking(_ enabled: Bool) {
        if enabled {
            startTracking()
        } else {
            stopTracking()
        }
    }

    func requestAuthorization() {
        locationManager.requestAlwaysAuthorization()
    }

    private func startTracking() {
        isTracking = true
        requestAuthorization()
        updateBackgroundLocationSetting()
        locationManager.startUpdatingLocation()

        Task {
            await notificationManager.requestAuthorization()
        }
    }

    private func stopTracking() {
        locationManager.stopUpdatingLocation()
        isTracking = false
    }

    private func updateBackgroundLocationSetting() {
        guard supportsBackgroundLocation else {
            locationManager.allowsBackgroundLocationUpdates = false
            return
        }
        locationManager.allowsBackgroundLocationUpdates = authorizationStatus == .authorizedAlways
    }

    // MARK: - Spatial Indexing

    private struct GridCell: Hashable {
        let latIndex: Int
        let lngIndex: Int
    }

    private func gridCell(for coordinate: CLLocationCoordinate2D) -> GridCell {
        GridCell(
            latIndex: Int(floor(coordinate.latitude / gridCellSizeDegrees)),
            lngIndex: Int(floor(coordinate.longitude / gridCellSizeDegrees))
        )
    }

    private func rebuildSpatialIndex() {
        poiGrid.removeAll()
        for poi in pois {
            let cell = gridCell(for: poi.coordinate)
            poiGrid[cell, default: []].append(poi)
        }
    }

    private func nearbyCells(for location: CLLocation, radiusMeters: Double) -> [GridCell] {
        // Calculate how many grid cells the radius spans
        // At equator: 1 degree ≈ 111km, so 0.1 degree ≈ 11km
        // Account for latitude compression of longitude
        let latDegrees = radiusMeters / 111_000
        let lngDegrees = radiusMeters / (111_000 * cos(location.coordinate.latitude * .pi / 180))

        let cellsLat = Int(ceil(latDegrees / gridCellSizeDegrees)) + 1
        let cellsLng = Int(ceil(lngDegrees / gridCellSizeDegrees)) + 1

        let centerCell = gridCell(for: location.coordinate)
        var cells: [GridCell] = []
        cells.reserveCapacity((2 * cellsLat + 1) * (2 * cellsLng + 1))

        for dLat in -cellsLat...cellsLat {
            for dLng in -cellsLng...cellsLng {
                cells.append(GridCell(
                    latIndex: centerCell.latIndex + dLat,
                    lngIndex: centerCell.lngIndex + dLng
                ))
            }
        }

        return cells
    }

    private func handleLocationUpdate(_ location: CLLocation) {
        lastLocation = location

        guard !pois.isEmpty else { return }

        let thresholdMeters = alertDistanceMiles * 1609.344

        // Only check POIs in nearby grid cells instead of all POIs
        let cells = nearbyCells(for: location, radiusMeters: thresholdMeters)
        var candidatePOIs: [RoutePOI] = []

        for cell in cells {
            if let poisInCell = poiGrid[cell] {
                candidatePOIs.append(contentsOf: poisInCell)
            }
        }

        // Now check only the nearby candidates
        for poi in candidatePOIs {
            guard !notifiedPOIIds.contains(poi.id) else { continue }
            let distanceMeters = location.distance(from: poi.location)
            if distanceMeters <= thresholdMeters {
                notifiedPOIIds.insert(poi.id)
                let distanceMiles = distanceMeters / 1609.344
                notificationManager.sendProximityAlert(for: poi, distanceMiles: distanceMiles)
            }
        }
    }
}

extension RouteTracker: CLLocationManagerDelegate {
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        authorizationStatus = manager.authorizationStatus
        updateBackgroundLocationSetting()
        if isTracking && (authorizationStatus == .authorizedAlways || authorizationStatus == .authorizedWhenInUse) {
            manager.startUpdatingLocation()
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let latest = locations.last else { return }
        handleLocationUpdate(latest)
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Keep the last known location; errors are surfaced in the UI via status.
    }
}
