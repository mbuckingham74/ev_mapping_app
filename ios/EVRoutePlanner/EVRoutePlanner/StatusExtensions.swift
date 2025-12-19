import CoreLocation
import UserNotifications

extension CLAuthorizationStatus {
    var label: String {
        switch self {
        case .authorizedAlways:
            return "Always"
        case .authorizedWhenInUse:
            return "When in use"
        case .denied:
            return "Denied"
        case .restricted:
            return "Restricted"
        case .notDetermined:
            return "Not determined"
        @unknown default:
            return "Unknown"
        }
    }
}

extension UNAuthorizationStatus {
    var label: String {
        switch self {
        case .authorized:
            return "Authorized"
        case .denied:
            return "Denied"
        case .notDetermined:
            return "Not determined"
        case .provisional:
            return "Provisional"
        case .ephemeral:
            return "Ephemeral"
        @unknown default:
            return "Unknown"
        }
    }
}
