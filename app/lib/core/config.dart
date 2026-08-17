/// App configuration.
///
/// The backend URL is injected at build time with
/// `--dart-define=API_BASE_URL=...` and can be overridden at runtime from
/// Settings -> Server (stored in secure storage). No credentials or test data
/// are hard-coded in the app: every value comes from the VARUN TEJ backend.
class AppConfig {
  AppConfig._();

  static const String _definedBaseUrl = String.fromEnvironment('API_BASE_URL');

  static String get defaultBaseUrl =>
      _definedBaseUrl.isNotEmpty ? _definedBaseUrl : 'http://10.0.2.2:8080';

  static const String appName = 'VARUN TEJ';
  static const String welcomeName = 'MAMILLAPALLI VARUN TEJ';
}
