import '../models/models.dart';
import 'api_client.dart';

export 'api_client.dart' show ApiClient, ApiException;

class AuthApi {
  static Future<bool> checkUsername(String username) async {
    final r = await ApiClient.post('/api/auth/signup/username/check', {'username': username});
    return r['available'] == true;
  }

  static Future<void> signup({
    required String username,
    required String email,
    required String dob,
    required String password,
  }) async {
    await ApiClient.post('/api/auth/signup', {
      'username': username,
      'email': email,
      'dob': dob,
      'password': password,
      'confirmPassword': password,
    });
  }

  static Future<(String, String, User)> login(String username, String password) async {
    final r = await ApiClient.post('/api/auth/login', {'username': username, 'password': password});
    final s = r['session'] as Map<String, dynamic>;
    return (
      s['accessToken'] as String,
      s['refreshToken'] as String,
      User.fromJson(r['user'] as Map<String, dynamic>),
    );
  }

  static Future<User> me() async {
    final r = await ApiClient.get('/api/auth/me');
    return User.fromJson(r['user'] as Map<String, dynamic>);
  }

  static Future<void> logout() async {
    try {
      await ApiClient.post('/api/auth/logout');
    } catch (_) {}
    await ApiClient.clearTokens();
  }

  /// Forgot password step 1: verify identity with username/email + date of birth.
  /// Returns a short-lived reset token when the DOB matches.
  static Future<String> forgotVerify(String identifier, String dob) async {
    final r = await ApiClient.post('/api/auth/forgot/verify', {
      'identifier': identifier,
      'dob': dob,
    });
    return r['resetToken'] as String? ?? '';
  }

  /// Forgot password step 2: set the new password with the reset token.
  static Future<void> forgotReset(String resetToken, String newPassword) async {
    await ApiClient.post('/api/auth/forgot/reset', {
      'resetToken': resetToken,
      'newPassword': newPassword,
      'confirmPassword': newPassword,
    });
  }
}

class MarketApi {
  static Future<Indices> indices() async {
    final r = await ApiClient.get('/api/market/indices');
    return Indices.fromJson(r['data'] as Map<String, dynamic>);
  }

  static Future<List<Gainer>> stockGainers({int limit = 10}) async {
    final r = await ApiClient.get('/api/market/gainers/stocks?limit=$limit');
    return (r['data'] as List? ?? [])
        .map((e) => Gainer.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  static Future<List<Gainer>> optionGainers({int limit = 10}) async {
    final r = await ApiClient.get('/api/market/gainers/options?limit=$limit');
    return (r['data'] as List? ?? [])
        .map((e) => Gainer.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  static Future<List<Gainer>> stockLosers({int limit = 10}) async {
    final r = await ApiClient.get('/api/market/losers/stocks?limit=$limit');
    return (r['data'] as List? ?? [])
        .map((e) => Gainer.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  static Future<List<Gainer>> optionLosers({int limit = 10}) async {
    final r = await ApiClient.get('/api/market/losers/options?limit=$limit');
    return (r['data'] as List? ?? [])
        .map((e) => Gainer.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  static Future<Map<String, dynamic>> dashboard() => ApiClient.get('/api/market/dashboard');

  static Future<List<InstrumentSearchResult>> search(String q) async {
    final r = await ApiClient.get('/api/market/search?q=${Uri.encodeQueryComponent(q)}');
    return (r['data'] as List? ?? [])
        .map((e) => InstrumentSearchResult.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Candlestick history for a stock or option (live graph data).
  static Future<List<Candle>> candles({
    required String symbol,
    String kind = 'stock',
    String interval = 'ONE_DAY',
    int days = 120,
  }) async {
    final r = await ApiClient.get(
        '/api/market/candles?symbol=${Uri.encodeQueryComponent(symbol)}&kind=$kind&interval=$interval&days=$days');
    return (r['data']?['candles'] as List? ?? [])
        .map((e) => Candle.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Detail screen payload: live quote + today's range + 52-week range + fundamentals.
  static Future<InstrumentDetails> details({
    required String symbol,
    String kind = 'stock',
  }) async {
    final r = await ApiClient.get(
        '/api/market/details?symbol=${Uri.encodeQueryComponent(symbol)}&kind=$kind');
    return InstrumentDetails.fromJson(r['data'] as Map<String, dynamic>);
  }
}

class NewsApi {
  static Future<List<NewsHistoryEntry>> history({int limit = 200}) async {
    final r = await ApiClient.get('/api/news/history?limit=$limit');
    return (r['history'] as List? ?? [])
        .map((e) => NewsHistoryEntry.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  static Future<List<NewsArticle>> optionNews(String company, {int limit = 10}) async {
    final r = await ApiClient.get('/api/news/option/${Uri.encodeComponent(company)}?limit=$limit');
    return (r['news'] as List? ?? [])
        .map((e) => NewsArticle.fromJson(e as Map<String, dynamic>))
        .toList();
  }
}

class ProfileApi {
  static Future<void> updateName(String name) => ApiClient.put('/api/profile/name', {'name': name});
  static Future<void> updateUsername(String username) => ApiClient.put('/api/profile/username', {'username': username});
  static Future<bool> usernameAvailable(String username) async {
    final r = await ApiClient.post('/api/profile/username/check', {'username': username});
    return r['available'] == true;
  }

  static Future<void> updatePicture(String base64) => ApiClient.put('/api/profile/picture', {'profilePic': base64});
  static Future<void> removePicture() => ApiClient.delete('/api/profile/picture');

  static Future<void> savePin(String pin) => ApiClient.put('/api/profile/pin', {'pin': pin});
  static Future<void> setBiometric(bool enabled) => ApiClient.put('/api/profile/biometric', {'enabled': enabled});
  static Future<bool> verifyPin(String pin) async {
    final r = await ApiClient.post('/api/profile/pin/verify', {'pin': pin});
    return r['ok'] == true;
  }

  static Future<Map<String, dynamic>> getSettings() => ApiClient.get('/api/profile/settings');
  static Future<void> saveSettings({String? theme, String? serverUrl}) =>
      ApiClient.put('/api/profile/settings', {'theme': theme, 'serverUrl': serverUrl});
}

class NotificationApi {
  static Future<Map<String, bool>> preferences() async {
    final r = await ApiClient.get('/api/notifications/preferences');
    return (r['preferences'] as Map<String, dynamic>).map((k, v) => MapEntry(k, v == true));
  }

  static Future<void> savePreferences(Map<String, bool> prefs) =>
      ApiClient.put('/api/notifications/preferences', {'preferences': prefs});

  static Future<(List<AppNotification>, int)> inbox() async {
    final r = await ApiClient.get('/api/notifications/inbox');
    final list = (r['notifications'] as List? ?? [])
        .map((e) => AppNotification.fromJson(e as Map<String, dynamic>))
        .toList();
    return (list, (r['unread'] as num?)?.toInt() ?? 0);
  }

  static Future<void> markRead(List<int> ids) => ApiClient.put('/api/notifications/inbox/read', {'ids': ids});
  static Future<void> markAllRead() => ApiClient.put('/api/notifications/inbox/read-all');
}

class AiApi {
  static Future<Map<String, dynamic>> keys({int? work}) async {
    final q = work != null ? '?work=$work' : '';
    return ApiClient.get('/api/ai/keys$q');
  }

  static Future<void> saveKeys(int work, List<Map<String, dynamic>> slots) =>
      ApiClient.put('/api/ai/keys', {'work': work, 'slots': slots});

  static Future<Map<String, dynamic>> testKey(int id) =>
      ApiClient.post('/api/ai/keys/$id/test', {});

  static Future<void> deleteKey(int id) => ApiClient.delete('/api/ai/keys/$id');

  static Future<Map<String, dynamic>> models() => ApiClient.get('/api/ai/models');

  static Future<Map<String, dynamic>> verifyModel({
    required String provider,
    required String model,
    required String apiKey,
    String endpoint = '',
  }) =>
      ApiClient.post('/api/ai/models/verify', {
        'provider': provider,
        'model': model,
        'apiKey': apiKey,
        'endpoint': endpoint,
      });

  static Future<void> saveModel({
    required String provider,
    required String model,
    required String apiKey,
    String endpoint = '',
    int latencyMs = 0,
  }) =>
      ApiClient.post('/api/ai/models', {
        'provider': provider,
        'model': model,
        'apiKey': apiKey,
        'endpoint': endpoint,
        'latencyMs': latencyMs,
      });

  static Future<Map<String, dynamic>> testModel(int id) =>
      ApiClient.post('/api/ai/models/$id/test', {});

  static Future<void> setPrimary(int id) => ApiClient.put('/api/ai/models/$id/primary');
  static Future<void> setEnabled(int id, bool enabled) => ApiClient.put('/api/ai/models/$id/enabled', {'enabled': enabled});
  static Future<void> removeModel(int id) => ApiClient.delete('/api/ai/models/$id');

  static Future<List<Trade>> trades({String? kind}) async {
    final q = kind != null ? '?kind=$kind' : '';
    final r = await ApiClient.get('/api/ai/trades$q');
    return (r['trades'] as List? ?? [])
        .map((e) => Trade.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  static Future<TradePerformance> tradePerformance({int hours = 24}) async {
    final r = await ApiClient.get('/api/ai/trades/performance?hours=$hours');
    return TradePerformance.fromJson(r['performance'] as Map<String, dynamic>? ?? {});
  }

  static Future<List<TradeHistoryRecord>> tradeHistory({int hours = 24}) async {
    final r = await ApiClient.get('/api/ai/trades/history?hours=$hours');
    return (r['history'] as List? ?? [])
        .map((e) => TradeHistoryRecord.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  static Future<List<Analysis>> analyses({String kind = 'stock'}) async {
    final r = await ApiClient.get('/api/ai/analyses?kind=$kind');
    return (r['analyses'] as List? ?? [])
        .map((e) => Analysis.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  static Future<String> startHistorical({
    required String symbol,
    String? companyName,
    String? query,
  }) async {
    final r = await ApiClient.post('/api/ai/analyze/historical', {
      'symbol': symbol,
      'companyName': companyName ?? '',
      'query': query ?? '',
    });
    return r['jobId'] as String;
  }

  static Future<String> startSymbolAnalysis({
    required String symbol,
    String kind = 'stock',
    String? companyName,
    double? currentPrice,
  }) async {
    final r = await ApiClient.post('/api/ai/analyze/symbol', {
      'kind': kind,
      'symbol': symbol,
      'companyName': companyName ?? '',
      'currentPrice': currentPrice,
    });
    return r['jobId'] as String;
  }

  static Future<AnalysisJob> jobStatus(String jobId) async {
    final r = await ApiClient.get('/api/ai/jobs/$jobId');
    return AnalysisJob.fromJson(r['job'] as Map<String, dynamic>);
  }
}
