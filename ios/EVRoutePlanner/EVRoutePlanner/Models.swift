import Foundation
import CoreLocation

enum RoutePreference: String, CaseIterable, Identifiable, Codable {
    case fastest = "fastest"
    case chargerOptimized = "charger_optimized"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .fastest:
            return "Fastest"
        case .chargerOptimized:
            return "Charger optimized"
        }
    }
}

struct RouteRequest: Encodable {
    let start: String
    let end: String
    let waypoints: [String]
    let corridorMiles: Double
    let autoCorridor: Bool
    let includeStations: Bool
    let preference: RoutePreference
}

struct RoutePoint: Decodable {
    let query: String
    let label: String
    let lat: Double
    let lng: Double
}

struct RouteSummary: Decodable {
    let distanceMeters: Double
    let durationSeconds: Double
    let elevationGainFt: Double?
    let elevationLossFt: Double?
}

struct RouteStation: Decodable, Identifiable {
    let id: Int
    let stationName: String
    let latitude: Double
    let longitude: Double
    let distanceAlongRouteMiles: Double?
}

struct TruckStopAlongRoute: Decodable, Identifiable {
    let id: Int
    let brand: String?
    let name: String
    let city: String?
    let state: String?
    let latitude: Double
    let longitude: Double
    let distanceAlongRouteMiles: Double?
}

struct RouteResponse: Decodable {
    let points: [RoutePoint]
    let summary: RouteSummary
    let geometry: [[Double]]
    let corridorMiles: Double?
    let stations: [RouteStation]?
    let truckStops: [TruckStopAlongRoute]?
    let warning: String?
}

enum RoutePOIKind: String {
    case station
    case truckStop
}

struct RoutePOI: Identifiable, Hashable {
    let id: String
    let name: String
    let kind: RoutePOIKind
    let coordinate: CLLocationCoordinate2D
    let distanceAlongRouteMiles: Double?

    var location: CLLocation {
        CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
    }

    static func == (lhs: RoutePOI, rhs: RoutePOI) -> Bool {
        lhs.id == rhs.id
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
}

extension RouteResponse {
    var coordinates: [CLLocationCoordinate2D] {
        geometry.compactMap { point in
            guard point.count >= 2 else { return nil }
            return CLLocationCoordinate2D(latitude: point[0], longitude: point[1])
        }
    }

    var allPOIs: [RoutePOI] {
        var items: [RoutePOI] = []
        if let stations {
            items.append(contentsOf: stations.map { station in
                RoutePOI(
                    id: "station-\(station.id)",
                    name: station.stationName,
                    kind: .station,
                    coordinate: CLLocationCoordinate2D(latitude: station.latitude, longitude: station.longitude),
                    distanceAlongRouteMiles: station.distanceAlongRouteMiles
                )
            })
        }

        if let truckStops {
            items.append(contentsOf: truckStops.map { stop in
                RoutePOI(
                    id: "truck-\(stop.id)",
                    name: truckStopName(stop),
                    kind: .truckStop,
                    coordinate: CLLocationCoordinate2D(latitude: stop.latitude, longitude: stop.longitude),
                    distanceAlongRouteMiles: stop.distanceAlongRouteMiles
                )
            })
        }

        return items.sorted { lhs, rhs in
            switch (lhs.distanceAlongRouteMiles, rhs.distanceAlongRouteMiles) {
            case let (left?, right?):
                return left < right
            case (nil, nil):
                return lhs.name < rhs.name
            case (_?, nil):
                return true
            case (nil, _?):
                return false
            }
        }
    }
}

private func truckStopName(_ stop: TruckStopAlongRoute) -> String {
    let trimmed = stop.name.trimmingCharacters(in: .whitespacesAndNewlines)
    if !trimmed.isEmpty {
        return trimmed
    }
    if let brand = stop.brand?.trimmingCharacters(in: .whitespacesAndNewlines), !brand.isEmpty {
        return brand
    }
    return "Truck stop"
}
