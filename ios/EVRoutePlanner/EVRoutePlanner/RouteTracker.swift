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

    private func handleLocationUpdate(_ location: CLLocation) {
        lastLocation = location

        guard !pois.isEmpty else { return }

        let thresholdMeters = alertDistanceMiles * 1609.344
        for poi in pois {
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
