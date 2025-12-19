import Foundation

struct APIClient {
    let baseURL = URL(string: "https://ev.tachyonfuture.com/api")!

    func planRoute(request: RouteRequest) async throws -> RouteResponse {
        var urlRequest = URLRequest(url: baseURL.appendingPathComponent("route"))
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.httpBody = try JSONEncoder().encode(request)

        let (data, response) = try await URLSession.shared.data(for: urlRequest)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            let message = parseAPIError(data: data) ?? "Request failed with status \(httpResponse.statusCode)"
            throw APIError.serverError(message)
        }

        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode(RouteResponse.self, from: data)
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
