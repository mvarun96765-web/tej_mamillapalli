import 'dart:convert';
import 'dart:io';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

import '../core/config.dart';

class ApiException implements Exception {
  final int? statusCode;
  final String message;
  ApiException(this.message, {this.statusCode});

  @override
  String toString() => message;
}

/// Thin HTTP client for the VARUN TEJ backend.
///
/// The server URL is resolved at runtime: Settings -> Server overrides the
/// build-time default. Tokens are kept in secure storage.
class ApiClient {
  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );

  static String _baseUrl = AppConfig.defaultBaseUrl;
  static String? _accessToken;
  static String? _refreshToken;

  static String get baseUrl => _baseUrl;

  static Future<void> init() async {
    _baseUrl = await _storage.read(key: 'server_url') ?? AppConfig.defaultBaseUrl;
    _accessToken = await _storage.read(key: 'access_token');
    _refreshToken = await _storage.read(key: 'refresh_token');
  }

  static Future<void> setServerUrl(String url) async {
    final normalized = url.trim().replaceAll(RegExp(r'/+$'), '');
    _baseUrl = normalized.isEmpty ? AppConfig.defaultBaseUrl : normalized;
    await _storage.write(key: 'server_url', value: _baseUrl);
  }

  static Future<void> setTokens({required String accessToken, required String refreshToken}) async {
    _accessToken = accessToken;
    _refreshToken = refreshToken;
    await _storage.write(key: 'access_token', value: accessToken);
    await _storage.write(key: 'refresh_token', value: refreshToken);
  }

  static Future<void> clearTokens() async {
    _accessToken = null;
    _refreshToken = null;
    await _storage.delete(key: 'access_token');
    await _storage.delete(key: 'refresh_token');
  }

  static Future<Map<String, dynamic>> _send(
    String method,
    String path, {
    Object? body,
    bool auth = true,
  }) async {
    final uri = Uri.parse('$_baseUrl$path');
    final headers = <String, String>{
      'Content-Type': 'application/json',
      if (auth && _accessToken != null) 'Authorization': 'Bearer $_accessToken',
    };

    late http.Response res;
    try {
      res = switch (method) {
        'GET' => await http.get(uri, headers: headers),
        'DELETE' => await http.delete(uri, headers: headers),
        _ => await http.post(uri, headers: headers, body: jsonEncode(body ?? {})),
      };
    } on SocketException {
      throw ApiException('Cannot reach the server. Check your internet / server URL.', statusCode: 0);
    } on http.ClientException {
      throw ApiException('Network error while contacting the server.', statusCode: 0);
    }

    Map<String, dynamic>? json;
    try {
      json = jsonDecode(res.body) as Map<String, dynamic>;
    } catch (_) {
      json = null;
    }

    if (res.statusCode == 401 && auth && _refreshToken != null) {
      // Session expired -> try refresh once.
      final refreshed = await _tryRefresh();
      if (refreshed) return _send(method, path, body: body, auth: auth);
      await clearTokens();
      throw ApiException('Session expired. Please log in again.', statusCode: 401);
    }

    if (res.statusCode >= 400 || (json != null && json['ok'] == false)) {
      final msg = (json?['error'] as String?) ??
          (json?['message'] as String?) ??
          'Request failed (${res.statusCode})';
      throw ApiException(msg, statusCode: res.statusCode);
    }
    return json ?? <String, dynamic>{};
  }

  static Future<bool> _tryRefresh() async {
    if (_refreshToken == null) return false;
    try {
      final res = await http.post(
        Uri.parse('$_baseUrl/api/auth/refresh'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'refreshToken': _refreshToken}),
      );
      if (res.statusCode != 200) return false;
      final json = jsonDecode(res.body) as Map<String, dynamic>;
      if (json['ok'] != true) return false;
      final s = json['session'] as Map<String, dynamic>;
      await setTokens(
        accessToken: s['accessToken'] as String,
        refreshToken: s['refreshToken'] as String,
      );
      return true;
    } catch (_) {
      return false;
    }
  }

  // ── typed helpers ────────────────────────────────────────────
  /// Open the live market SSE stream. The caller owns the returned
  /// StreamedResponse (must listen to / cancel its stream).
  static Future<http.StreamedResponse> openMarketStream() async {
    final uri = Uri.parse('$_baseUrl/api/market/stream');
    final req = http.Request('GET', uri);
    if (_accessToken != null) req.headers['Authorization'] = 'Bearer $_accessToken';
    try {
      final res = await http.Client().send(req);
      if (res.statusCode != 200) {
        res.stream.drain();
        throw ApiException('Market stream unavailable (${res.statusCode})', statusCode: res.statusCode);
      }
      return res;
    } on SocketException {
      throw ApiException('Cannot reach the server. Check your internet / server URL.', statusCode: 0);
    } on http.ClientException {
      throw ApiException('Network error while contacting the server.', statusCode: 0);
    }
  }

  static Future<Map<String, dynamic>> get(String path) => _send('GET', path);
  static Future<Map<String, dynamic>> post(String path, [Object? body]) => _send('POST', path, body: body);
  static Future<Map<String, dynamic>> put(String path, [Object? body]) async {
    final uri = Uri.parse('$_baseUrl$path');
    final headers = <String, String>{
      'Content-Type': 'application/json',
      if (_accessToken != null) 'Authorization': 'Bearer $_accessToken',
    };
    try {
      final res = await http.put(uri, headers: headers, body: jsonEncode(body ?? {}));
      Map<String, dynamic>? json;
      try {
        json = jsonDecode(res.body) as Map<String, dynamic>;
      } catch (_) {}
      if (res.statusCode >= 400) {
        throw ApiException(json?['error'] as String? ?? 'Request failed (${res.statusCode})', statusCode: res.statusCode);
      }
      return json ?? <String, dynamic>{};
    } on SocketException {
      throw ApiException('Cannot reach the server.', statusCode: 0);
    }
  }

  static Future<Map<String, dynamic>> delete(String path) => _send('DELETE', path);
}
