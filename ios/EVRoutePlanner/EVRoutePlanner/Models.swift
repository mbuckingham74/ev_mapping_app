import Foundation
import CoreLocation

enum RoutePreference: String, CaseIterable, Identifiable, Codable, Hashable {
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

struct RouteRequest: Encodable, Hashable {
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

/// Thread-safe cache for RouteResponse computed properties
final class RouteResponseCache {
    static let shared = RouteResponseCache()

    private let lock = NSLock()
    private var coordinatesCache: [ObjectIdentifier: [CLLocationCoordinate2D]] = [:]
    private var poisCache: [ObjectIdentifier: [RoutePOI]] = [:]

    private init() {}

    func coordinates(for response: RouteResponse, id: ObjectIdentifier) -> [CLLocationCoordinate2D] {
        lock.lock()
        defer { lock.unlock() }

        if let cached = coordinatesCache[id] {
            return cached
        }

        let result = response.geometry.compactMap { point -> CLLocationCoordinate2D? in
            guard point.count >= 2 else { return nil }
            return CLLocationCoordinate2D(latitude: point[0], longitude: point[1])
        }
        coordinatesCache[id] = result
        return result
    }

    func allPOIs(for response: RouteResponse, id: ObjectIdentifier) -> [RoutePOI] {
        lock.lock()
        defer { lock.unlock() }

        if let cached = poisCache[id] {
            return cached
        }

        let result = computeAllPOIs(for: response)
        poisCache[id] = result
        return result
    }

    private func computeAllPOIs(for response: RouteResponse) -> [RoutePOI] {
        var items: [RoutePOI] = []
        items.reserveCapacity((response.stations?.count ?? 0) + (response.truckStops?.count ?? 0))

        if let stations = response.stations {
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

        if let truckStops = response.truckStops {
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

    func clearCache() {
        lock.lock()
        defer { lock.unlock() }
        coordinatesCache.removeAll()
        poisCache.removeAll()
    }
}

/// Wrapper class for RouteResponse to enable caching with stable identity
final class CachedRouteResponse {
    let response: RouteResponse

    init(_ response: RouteResponse) {
        self.response = response
    }

    private lazy var _coordinates: [CLLocationCoordinate2D] = {
        response.geometry.compactMap { point -> CLLocationCoordinate2D? in
            guard point.count >= 2 else { return nil }
            return CLLocationCoordinate2D(latitude: point[0], longitude: point[1])
        }
    }()

    private lazy var _allPOIs: [RoutePOI] = {
        var items: [RoutePOI] = []
        items.reserveCapacity((response.stations?.count ?? 0) + (response.truckStops?.count ?? 0))

        if let stations = response.stations {
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

        if let truckStops = response.truckStops {
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
    }()

    var coordinates: [CLLocationCoordinate2D] { _coordinates }
    var allPOIs: [RoutePOI] { _allPOIs }

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
}

struct RouteResponse: Decodable {
    let points: [RoutePoint]
    let summary: RouteSummary
    let geometry: [[Double]]
    let corridorMiles: Double?
    let stations: [RouteStation]?
    let truckStops: [TruckStopAlongRoute]?
    let warning: String?

    var coordinates: [CLLocationCoordinate2D] {
        geometry.compactMap { point -> CLLocationCoordinate2D? in
            guard point.count >= 2 else { return nil }
            return CLLocationCoordinate2D(latitude: point[0], longitude: point[1])
        }
    }
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
