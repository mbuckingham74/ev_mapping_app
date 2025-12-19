import MapKit
import SwiftUI
import UIKit

struct RouteMapView: UIViewRepresentable {
    let route: RouteResponse?
    let pois: [RoutePOI]
    let followUser: Bool

    func makeUIView(context: Context) -> MKMapView {
        let mapView = MKMapView()
        mapView.delegate = context.coordinator
        mapView.showsUserLocation = true
        mapView.pointOfInterestFilter = .excludingAll
        mapView.isRotateEnabled = false

        // Enable annotation clustering
        mapView.register(
            MKMarkerAnnotationView.self,
            forAnnotationViewWithReuseIdentifier: MKMapViewDefaultAnnotationViewReuseIdentifier
        )
        mapView.register(
            MKMarkerAnnotationView.self,
            forAnnotationViewWithReuseIdentifier: MKMapViewDefaultClusterAnnotationViewReuseIdentifier
        )

        return mapView
    }

    func updateUIView(_ uiView: MKMapView, context: Context) {
        uiView.showsUserLocation = true
        if followUser {
            uiView.setUserTrackingMode(.follow, animated: true)
        } else if uiView.userTrackingMode != .none {
            uiView.setUserTrackingMode(.none, animated: true)
        }

        // Update route overlay only if changed
        let newRouteSignature = routeSignature(for: route?.coordinates ?? [])
        if context.coordinator.lastRouteSignature != newRouteSignature {
            context.coordinator.lastRouteSignature = newRouteSignature

            // Remove existing route overlay
            let existingOverlays = uiView.overlays
            uiView.removeOverlays(existingOverlays)

            // Add new route if present
            if let route, route.coordinates.count >= 2 {
                let polyline = MKPolyline(coordinates: route.coordinates, count: route.coordinates.count)
                uiView.addOverlay(polyline)

                if !followUser {
                    let padding = UIEdgeInsets(top: 80, left: 60, bottom: 200, right: 60)
                    uiView.setVisibleMapRect(polyline.boundingMapRect, edgePadding: padding, animated: true)
                }
            }
        }

        // Update annotations only if POIs changed
        updateAnnotationsIfNeeded(mapView: uiView, coordinator: context.coordinator)
    }

    private func updateAnnotationsIfNeeded(mapView: MKMapView, coordinator: Coordinator) {
        let newPOIIds = Set(pois.map(\.id))

        // Skip update if POIs haven't changed
        if newPOIIds == coordinator.currentPOIIds {
            return
        }

        let existingAnnotations = mapView.annotations.compactMap { $0 as? POIAnnotation }
        let existingIds = Set(existingAnnotations.map(\.poi.id))

        // Remove annotations that are no longer in the list
        let toRemove = existingAnnotations.filter { !newPOIIds.contains($0.poi.id) }
        if !toRemove.isEmpty {
            mapView.removeAnnotations(toRemove)
        }

        // Add new annotations that don't exist yet
        let idsToAdd = newPOIIds.subtracting(existingIds)
        let toAdd = pois.filter { idsToAdd.contains($0.id) }.map { POIAnnotation(poi: $0) }
        if !toAdd.isEmpty {
            mapView.addAnnotations(toAdd)
        }

        // Update tracking set
        coordinator.currentPOIIds = newPOIIds
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    private func routeSignature(for coordinates: [CLLocationCoordinate2D]) -> String {
        guard let first = coordinates.first, let last = coordinates.last else {
            return "empty"
        }
        return "\(coordinates.count)-\(first.latitude)-\(first.longitude)-\(last.latitude)-\(last.longitude)"
    }

    final class Coordinator: NSObject, MKMapViewDelegate {
        var lastRouteSignature: String?
        var currentPOIIds = Set<String>()

        // Cache system images for better performance
        private lazy var stationImage: UIImage? = UIImage(systemName: "bolt.car")
        private lazy var truckStopImage: UIImage? = UIImage(systemName: "truck.box")

        func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
            if let polyline = overlay as? MKPolyline {
                let renderer = MKPolylineRenderer(polyline: polyline)
                renderer.strokeColor = UIColor.systemBlue
                renderer.lineWidth = 4
                return renderer
            }
            return MKOverlayRenderer(overlay: overlay)
        }

        func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
            // Handle cluster annotations
            if let cluster = annotation as? MKClusterAnnotation {
                let identifier = "cluster"
                let view = mapView.dequeueReusableAnnotationView(withIdentifier: identifier) as? MKMarkerAnnotationView
                    ?? MKMarkerAnnotationView(annotation: cluster, reuseIdentifier: identifier)
                view.annotation = cluster
                view.markerTintColor = .systemBlue
                view.glyphText = "\(cluster.memberAnnotations.count)"
                return view
            }

            guard let poiAnnotation = annotation as? POIAnnotation else {
                return nil
            }

            let identifier = "poi"
            let view = mapView.dequeueReusableAnnotationView(withIdentifier: identifier) as? MKMarkerAnnotationView
                ?? MKMarkerAnnotationView(annotation: poiAnnotation, reuseIdentifier: identifier)
            view.annotation = poiAnnotation
            view.canShowCallout = true
            view.clusteringIdentifier = "poi-cluster"

            let isStation = poiAnnotation.poi.kind == .station
            view.markerTintColor = isStation ? UIColor.systemGreen : UIColor.systemOrange
            view.glyphImage = isStation ? stationImage : truckStopImage

            return view
        }
    }
}

final class POIAnnotation: NSObject, MKAnnotation {
    let poi: RoutePOI

    init(poi: RoutePOI) {
        self.poi = poi
    }

    var coordinate: CLLocationCoordinate2D {
        poi.coordinate
    }

    var title: String? {
        poi.name
    }

    var subtitle: String? {
        poi.kind == .truckStop ? "Truck stop" : "Charging station"
    }
}
