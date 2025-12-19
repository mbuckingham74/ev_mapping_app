//
//  ContentView.swift
//  EVRoutePlanner
//
//  Created by Michael Buckingham on 12/18/25.
//

import SwiftUI

@MainActor
struct ContentView: View {
    @StateObject private var viewModel: RouteViewModel

    init() {
        _viewModel = StateObject(wrappedValue: RouteViewModel())
    }

    var body: some View {
        ZStack(alignment: .top) {
            RouteMapView(
                route: viewModel.route,
                pois: viewModel.route?.allPOIs ?? [],
                followUser: viewModel.tracker.isTracking
            )
            .ignoresSafeArea()

            RoutePlannerPanel(
                viewModel: viewModel,
                tracker: viewModel.tracker,
                notificationManager: viewModel.notificationManager
            )
        }
    }
}

#Preview {
    ContentView()
}
