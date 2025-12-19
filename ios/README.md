# iOS App

## Project Location
- Xcode project: `ios/EVRoutePlanner/EVRoutePlanner.xcodeproj`
- App sources: `ios/EVRoutePlanner/EVRoutePlanner/`

## Run Locally
1. Open the Xcode project.
2. Select the `EVRoutePlanner` target and a run destination (simulator or device).
3. Press Run.

## Background Tracking and Alerts
- Enable Background Modes -> Location updates under Signing & Capabilities.
- On device, grant Always location and notification permissions.
- Toggle "Follow and alert" in the app to start tracking.
- Alerts fire within 5 miles of any charger or truck stop on the planned route.
- Force quitting the app stops background updates and alerts.

## Configuration
- API base URL: `ios/EVRoutePlanner/EVRoutePlanner/APIClient.swift`.
