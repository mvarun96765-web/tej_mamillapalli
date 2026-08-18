import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../core/theme.dart';
import '../models/models.dart';
import '../services/api_services.dart';

enum SessionState { starting, unauthenticated, authenticated }

/// Owns the authenticated session and the security-unlock gate.
class SessionProvider extends ChangeNotifier {
  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );

  SessionState state = SessionState.starting;
  User? user;
  bool unlocked = false; // security PIN / biometric gate passed
  String? error;

  /// Load the cached session WITHOUT waiting on the network, then re-validate
  /// in the background. The splash screen must never block on a server call
  /// (cold starts / offline would otherwise stall the app forever).
  Future<void> bootstrap() async {
    await ApiClient.init();
    final savedUser = await _storage.read(key: 'user');
    if (savedUser != null && savedUser.isNotEmpty) {
      try {
        user = User.fromJson(jsonDecode(savedUser) as Map<String, dynamic>);
      } catch (_) {}
    }
    state = user != null ? SessionState.authenticated : SessionState.unauthenticated;
    notifyListeners();
    unawaited(_revalidate());
  }

  /// Background session check: only a real 401 logs the user out. Network or
  /// server failures keep the cached session (offline-tolerant startup).
  Future<void> _revalidate() async {
    try {
      user = await AuthApi.me();
      await _storage.write(key: 'user', value: jsonEncode(user!.toJson()));
      if (state != SessionState.authenticated) {
        state = SessionState.authenticated;
        notifyListeners();
      }
    } on ApiException catch (e) {
      if (e.statusCode == 401) {
        await _storage.delete(key: 'user');
        state = SessionState.unauthenticated;
        notifyListeners();
      }
    } catch (_) {
      // keep the cached session; offline or server hiccup
    }
  }

  Future<void> _resolve() async {
    state = SessionState.starting;
    notifyListeners();
    try {
      user = await AuthApi.me();
      state = SessionState.authenticated;
      await _storage.write(key: 'user', value: jsonEncode(user!.toJson()));
    } catch (e) {
      state = SessionState.unauthenticated;
      await _storage.delete(key: 'user');
    }
    notifyListeners();
  }

  Future<void> login(String username, String password) async {
    error = null;
    notifyListeners();
    final (access, refresh, u) = await AuthApi.login(username, password);
    await ApiClient.setTokens(accessToken: access, refreshToken: refresh);
    user = u;
    state = SessionState.authenticated;
    unlocked = false; // security unlock required after login
    await _storage.write(key: 'user', value: jsonEncode(u.toJson()));
    notifyListeners();
  }

  /// Re-validate the session (used after changing the server URL).
  Future<void> resolveSession() => _resolve();

  Future<void> refreshUser() async {
    try {
      user = await AuthApi.me();
      await _storage.write(key: 'user', value: jsonEncode(user!.toJson()));
      notifyListeners();
    } catch (_) {}
  }

  Future<void> logout() async {
    await AuthApi.logout();
    await _storage.delete(key: 'user');
    state = SessionState.unauthenticated;
    unlocked = false;
    notifyListeners();
  }

  Future<void> setUnlocked(bool value) async {
    unlocked = value;
    notifyListeners();
  }
}

/// Appearance (Light / Dark / System), persisted locally + on the backend.
class ThemeProvider extends ChangeNotifier {
  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );

  ThemeMode mode = ThemeMode.system;

  Future<void> init() async {
    final saved = await _storage.read(key: 'theme');
    mode = saved == 'light' ? ThemeMode.light : (saved == 'dark' ? ThemeMode.dark : ThemeMode.system);
    notifyListeners();
  }

  Future<void> setMode(ThemeMode m) async {
    mode = m;
    notifyListeners();
    final label = m == ThemeMode.light ? 'light' : (m == ThemeMode.dark ? 'dark' : 'system');
    await _storage.write(key: 'theme', value: label);
    try {
      await ProfileApi.saveSettings(theme: label);
    } catch (_) {}
  }

  ThemeData get light => AppTheme.light();
  ThemeData get dark => AppTheme.dark();
}

/// Live dashboard data (indices + gainers).
///
/// Primary source: the backend's Server-Sent-Events market stream, which pushes
/// Angel One SmartStream ticks ~every second. REST polling is only a fallback
/// (every 30s) so the dashboard keeps working if the stream drops.
class MarketProvider extends ChangeNotifier {
  Indices? indices;
  List<Gainer> topStocks = [];
  List<Gainer> topOptions = [];
  List<Gainer> topStockLosers = [];
  List<Gainer> topOptionLosers = [];
  bool loading = false;
  String? error;
  DateTime? lastUpdated;

  Timer? _timer;
  StreamSubscription<String>? _streamSub;
  bool _streamReconnectScheduled = false;

  void startPolling() {
    refresh();
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 30), (_) => refresh(silent: true));
    _connectStream();
  }

  void stopPolling() {
    _timer?.cancel();
    _timer = null;
    _disconnectStream();
  }

  // ── Live SSE stream (Angel One SmartStream via the backend) ──
  Future<void> _connectStream() async {
    if (_streamSub != null) return; // already connected
    try {
      final res = await ApiClient.openMarketStream();
      _streamSub = res.stream
          .transform(utf8.decoder)
          .transform(const LineSplitter())
          .listen(_onSseLine, onError: (_) => _onStreamClosed(), onDone: _onStreamClosed);
    } catch (_) {
      _onStreamClosed();
    }
  }

  void _onSseLine(String line) {
    final t = line.trim();
    if (!t.startsWith('data:')) return; // includes SSE keep-alive comments
    final payload = t.substring(5).trim();
    if (payload.isEmpty) return;
    try {
      _applyLive(jsonDecode(payload) as Map<String, dynamic>);
    } catch (_) {}
  }

  void _applyLive(Map<String, dynamic> json) {
    final idx = json['indices'];
    if (idx is Map<String, dynamic>) indices = Indices.fromJson(idx);
    final st = json['topStocks'];
    if (st is List) topStocks = _gainers(st);
    final sl = json['topStockLosers'];
    if (sl is List) topStockLosers = _gainers(sl);
    lastUpdated = DateTime.now();
    error = null;
    notifyListeners();
  }

  void _onStreamClosed() {
    _streamSub?.cancel();
    _streamSub = null;
    if (_streamReconnectScheduled || _timer == null) return;
    _streamReconnectScheduled = true;
    Future.delayed(const Duration(seconds: 8), () {
      _streamReconnectScheduled = false;
      if (_timer != null) _connectStream(); // still active
    });
  }

  void _disconnectStream() {
    _streamReconnectScheduled = false;
    _streamSub?.cancel();
    _streamSub = null;
  }

  Future<void> refresh({bool silent = false}) async {
    if (!silent) {
      loading = true;
      error = null;
      notifyListeners();
    }
    try {
      final r = await MarketApi.dashboard();
      final data = r['data'] as Map<String, dynamic>;
      indices = Indices.fromJson(data['indices'] as Map<String, dynamic>? ?? {});
      topStocks = _gainers(data['topStocks']);
      topOptions = _gainers(data['topOptions']);
      topStockLosers = _gainers(data['topStockLosers']);
      topOptionLosers = _gainers(data['topOptionLosers']);
      lastUpdated = DateTime.now();
      error = null;
    } catch (e) {
      error = e is ApiException ? e.message : 'Failed to load market data';
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  List<Gainer> _gainers(dynamic v) {
    if (v is Map && v.containsKey('error')) return [];
    if (v is! List) return [];
    return v.map((e) => Gainer.fromJson(e as Map<String, dynamic>)).toList();
  }
}

/// Notifications inbox + unread badge.
class NotificationProvider extends ChangeNotifier {
  List<AppNotification> notifications = [];
  int unread = 0;
  Timer? _timer;

  void startPolling() {
    refresh();
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 30), (_) => refresh());
  }

  void stopPolling() {
    _timer?.cancel();
    _timer = null;
  }

  Future<void> refresh() async {
    try {
      final (list, u) = await NotificationApi.inbox();
      notifications = list;
      unread = u;
    } catch (_) {}
    notifyListeners();
  }

  Future<void> markAllRead() async {
    await NotificationApi.markAllRead();
    unread = 0;
    notifyListeners();
  }

  Future<void> markRead(List<int> ids) async {
    await NotificationApi.markRead(ids);
    await refresh();
  }
}
