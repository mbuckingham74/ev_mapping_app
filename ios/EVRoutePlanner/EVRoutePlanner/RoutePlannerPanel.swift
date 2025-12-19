import SwiftUI

struct RoutePlannerPanel: View {
    @ObservedObject var viewModel: RouteViewModel
    @ObservedObject var tracker: RouteTracker
    @ObservedObject var notificationManager: NotificationManager

    @State private var showOptions = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Route")
                    .font(.headline)
                Spacer()
                if viewModel.isLoading {
                    ProgressView()
                }
            }

            TextField("Start", text: $viewModel.start)
                .textFieldStyle(.roundedBorder)
                .textInputAutocapitalization(.words)
                .autocorrectionDisabled()

            TextField("End", text: $viewModel.end)
                .textFieldStyle(.roundedBorder)
                .textInputAutocapitalization(.words)
                .autocorrectionDisabled()

            DisclosureGroup("Options", isExpanded: $showOptions) {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(viewModel.waypoints.indices, id: \.self) { index in
                        HStack {
                            TextField("Waypoint \(index + 1)", text: Binding(
                                get: { viewModel.waypoints[index] },
                                set: { viewModel.updateWaypoint(at: index, value: $0) }
                            ))
                            .textFieldStyle(.roundedBorder)
                            .textInputAutocapitalization(.words)
                            .autocorrectionDisabled()

                            Button {
                                viewModel.removeWaypoint(at: index)
                            } label: {
                                Image(systemName: "minus.circle")
                            }
                            .buttonStyle(.plain)
                        }
                    }

                    Button("Add waypoint") {
                        viewModel.addWaypoint()
                    }
                    .font(.subheadline)

                    HStack {
                        TextField("Corridor miles", text: $viewModel.corridorMilesText)
                            .textFieldStyle(.roundedBorder)
                            .keyboardType(.decimalPad)

                        Toggle("Auto corridor", isOn: $viewModel.autoCorridor)
                    }

                    Picker("Preference", selection: $viewModel.preference) {
                        ForEach(RoutePreference.allCases) { preference in
                            Text(preference.label).tag(preference)
                        }
                    }
                    .pickerStyle(.segmented)
                }
                .padding(.top, 6)
            }

            HStack(spacing: 12) {
                Button("Plan route") {
                    Task {
                        await viewModel.planRoute()
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(!canPlanRoute)

                Button("Clear") {
                    viewModel.clearRoute()
                }
                .buttonStyle(.bordered)
                .disabled(viewModel.route == nil && viewModel.errorMessage == nil)
            }

            Toggle("Follow and alert", isOn: trackingBinding)

            VStack(alignment: .leading, spacing: 4) {
                Text("Location: \(tracker.authorizationStatus.label)")
                Text("Alerts: \(notificationManager.authorizationStatus.label)")
            }
            .font(.footnote)
            .foregroundStyle(.secondary)

            if let summary = viewModel.summaryText {
                Text(summary)
                    .font(.subheadline)
            }

            if viewModel.poiCount > 0 {
                Text("Stops: \(viewModel.poiCount) (\(viewModel.stationCount) chargers, \(viewModel.truckStopCount) truck stops)")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            if let warning = viewModel.warningText {
                Text(warning)
                    .font(.footnote)
                    .foregroundStyle(.orange)
            }

            if let error = viewModel.errorMessage {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
            }
        }
        .padding(14)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .padding()
    }

    private var canPlanRoute: Bool {
        let trimmedStart = viewModel.start.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedEnd = viewModel.end.trimmingCharacters(in: .whitespacesAndNewlines)
        return !trimmedStart.isEmpty && !trimmedEnd.isEmpty && !viewModel.isLoading
    }

    private var trackingBinding: Binding<Bool> {
        Binding(
            get: { tracker.isTracking },
            set: { viewModel.setTracking($0) }
        )
    }
}
