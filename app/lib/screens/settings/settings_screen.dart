import 'package:flutter/material.dart';

import 'ai_keys_screen.dart';
import 'ai_models_screen.dart';
import 'appearance_settings_screen.dart';
import 'account_settings_screen.dart';
import 'news_history_screen.dart';
import 'notifications_settings_screen.dart';
import 'security_settings_screen.dart';
import 'server_settings_screen.dart';
import 'trade_performance_screen.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('SETTINGS')),
      body: ListView(
        children: [
          _Item(
            icon: Icons.notifications_outlined,
            title: 'Notifications',
            subtitle: 'Manage app notifications',
            onTap: () => _push(context, const NotificationsSettingsScreen()),
          ),
          _Item(
            icon: Icons.key_outlined,
            title: 'AI API Keys',
            subtitle: 'Manage AI provider API keys',
            onTap: () => _push(context, const AiKeysScreen()),
          ),
          _Item(
            icon: Icons.smart_toy_outlined,
            title: 'AI Models',
            subtitle: 'Add & verify AI models (Google Gemini, OpenAI, ...)',
            onTap: () => _push(context, const AiModelsScreen()),
          ),
          _Item(
            icon: Icons.article_outlined,
            title: 'News API History',
            subtitle: 'Request time, title & main point of articles (last 24 hours)',
            onTap: () => _push(context, const NewsHistoryScreen()),
          ),
          _Item(
            icon: Icons.analytics_outlined,
            title: 'Trade Performance',
            subtitle: 'AI trade history & results (target / stop loss / expired)',
            onTap: () => _push(context, const TradePerformanceScreen()),
          ),
          _Item(
            icon: Icons.security,
            title: 'Security',
            subtitle: 'PIN and biometric settings',
            onTap: () => _push(context, const SecuritySettingsScreen()),
          ),
          _Item(
            icon: Icons.palette_outlined,
            title: 'Appearance',
            subtitle: 'Light / Dark / System',
            onTap: () => _push(context, const AppearanceSettingsScreen()),
          ),
          _Item(
            icon: Icons.dns_outlined,
            title: 'Server',
            subtitle: 'Backend URL for the VARUN TEJ API',
            onTap: () => _push(context, const ServerSettingsScreen()),
          ),
          _Item(
            icon: Icons.account_circle_outlined,
            title: 'Account',
            subtitle: 'Account management',
            onTap: () => _push(context, const AccountSettingsScreen()),
          ),
          const SizedBox(height: 24),
        ],
      ),
    );
  }

  void _push(BuildContext context, Widget page) {
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => page));
  }
}

class _Item extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  const _Item({required this.icon, required this.title, required this.subtitle, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: Icon(icon),
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
        subtitle: Text(subtitle, style: const TextStyle(fontSize: 12)),
        trailing: const Icon(Icons.chevron_right),
        onTap: onTap,
      ),
    );
  }
}
