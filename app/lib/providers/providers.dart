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

  Future<void> bootstrap() async {
    await ApiClient.init();
    final savedUser = await _storage.read(key: 'user');
    if (savedUser != null && savedUser.isNotEmpty) {
      try {
        user = User.fromJson(jsonDecode(savedUser) as Map<String, dynamic>);
      } catch (_) {}
    }
    await _resolve();
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

/// Live dashboard data (indices + gainers), auto-refreshed from the backend.
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

  void startPolling() {
    refresh();
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 10), (_) => refresh(silent: true));
  }

  void stopPolling() {
    _timer?.cancel();
    _timer = null;
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
