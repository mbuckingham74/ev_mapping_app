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
        return mapView
    }

    func updateUIView(_ uiView: MKMapView, context: Context) {
        uiView.showsUserLocation = true
        if followUser {
            uiView.setUserTrackingMode(.follow, animated: true)
        } else if uiView.userTrackingMode != .none {
            uiView.setUserTrackingMode(.none, animated: true)
        }

        uiView.removeOverlays(uiView.overlays)
        let annotations = uiView.annotations.filter { !($0 is MKUserLocation) }
        uiView.removeAnnotations(annotations)

        if let route {
            let coordinates = route.coordinates
            if coordinates.count >= 2 {
                let polyline = MKPolyline(coordinates: coordinates, count: coordinates.count)
                uiView.addOverlay(polyline)

                let signature = routeSignature(for: coordinates)
                if context.coordinator.lastRouteSignature != signature && !followUser {
                    context.coordinator.lastRouteSignature = signature
                    let padding = UIEdgeInsets(top: 80, left: 60, bottom: 200, right: 60)
                    uiView.setVisibleMapRect(polyline.boundingMapRect, edgePadding: padding, animated: true)
                }
            }
        }

        for poi in pois {
            uiView.addAnnotation(POIAnnotation(poi: poi))
        }
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
            guard let poiAnnotation = annotation as? POIAnnotation else {
                return nil
            }

            let identifier = "poi"
            let view = mapView.dequeueReusableAnnotationView(withIdentifier: identifier) as? MKMarkerAnnotationView
                ?? MKMarkerAnnotationView(annotation: poiAnnotation, reuseIdentifier: identifier)
            view.canShowCallout = true
            view.markerTintColor = poiAnnotation.poi.kind == .truckStop ? UIColor.systemOrange : UIColor.systemGreen
            view.glyphImage = UIImage(systemName: poiAnnotation.poi.kind == .truckStop ? "truck.box" : "bolt.car")
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
