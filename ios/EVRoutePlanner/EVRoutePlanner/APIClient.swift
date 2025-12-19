import Foundation

/// Thread-safe in-memory cache for route responses
final class RouteCache {
    static let shared = RouteCache()

    private let lock = NSLock()
    private var cache: [RouteRequest: CacheEntry] = [:]
    private let maxAge: TimeInterval = 300 // 5 minutes

    private struct CacheEntry {
        let response: RouteResponse
        let timestamp: Date
    }

    private init() {}

    func get(_ request: RouteRequest) -> RouteResponse? {
        lock.lock()
        defer { lock.unlock() }

        guard let entry = cache[request] else { return nil }

        // Check if cache entry is still valid
        if Date().timeIntervalSince(entry.timestamp) > maxAge {
            cache.removeValue(forKey: request)
            return nil
        }

        return entry.response
    }

    func set(_ request: RouteRequest, response: RouteResponse) {
        lock.lock()
        defer { lock.unlock() }

        // Limit cache size to prevent memory issues
        if cache.count > 20 {
            // Remove oldest entries
            let sorted = cache.sorted { $0.value.timestamp < $1.value.timestamp }
            for (key, _) in sorted.prefix(10) {
                cache.removeValue(forKey: key)
            }
        }

        cache[request] = CacheEntry(response: response, timestamp: Date())
    }

    func clear() {
        lock.lock()
        defer { lock.unlock() }
        cache.removeAll()
    }
}

struct APIClient {
    let baseURL = URL(string: "https://ev.tachyonfuture.com/api")!

    // Configured URLSession with caching
    private let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.requestCachePolicy = .returnCacheDataElseLoad
        config.urlCache = URLCache(
            memoryCapacity: 10 * 1024 * 1024,  // 10 MB memory
            diskCapacity: 50 * 1024 * 1024,     // 50 MB disk
            diskPath: "ev_route_cache"
        )
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        return URLSession(configuration: config)
    }()

    private let routeCache = RouteCache.shared

    func planRoute(request: RouteRequest) async throws -> RouteResponse {
        // Check in-memory cache first
        if let cached = routeCache.get(request) {
            return cached
        }

        var urlRequest = URLRequest(url: baseURL.appendingPathComponent("route"))
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.httpBody = try JSONEncoder().encode(request)

        let (data, response) = try await session.data(for: urlRequest)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            let message = parseAPIError(data: data) ?? "Request failed with status \(httpResponse.statusCode)"
            throw APIError.serverError(message)
        }

        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let routeResponse = try decoder.decode(RouteResponse.self, from: data)

        // Cache the successful response
        routeCache.set(request, response: routeResponse)

        return routeResponse
    }

    private func parseAPIError(data: Data) -> String? {
        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let error = json["error"] as? String {
            return error
        }

        if let text = String(data: data, encoding: .utf8), !text.isEmpty {
            return text
        }

        return nil
    }
}

enum APIError: LocalizedError {
    case invalidResponse
    case serverError(String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Invalid response from server."
        case .serverError(let message):
            return message
        }
    }
}
