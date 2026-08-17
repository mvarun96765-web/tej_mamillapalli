import 'package:flutter/material.dart';

import '../../services/api_services.dart';

class NotificationsSettingsScreen extends StatefulWidget {
  const NotificationsSettingsScreen({super.key});

  @override
  State<NotificationsSettingsScreen> createState() => _NotificationsSettingsScreenState();
}

class _NotificationsSettingsScreenState extends State<NotificationsSettingsScreen> {
  Map<String, bool> prefs = {};
  bool loading = true;
  bool saving = false;

  static const _labels = <String, String>{
    'new_trade': 'New Trade',
    'high_confidence_trade': 'New High-Confidence Trade',
    'trade_update': 'Trade Update',
    'target_reached': 'Target Reached',
    'stop_loss_alert': 'Stop Loss Alert',
    'new_stock_opportunity': 'New Stock Opportunity',
    'new_option_opportunity': 'New Option Opportunity',
    'market_alert': 'Market Alert',
    'important_news': 'Important News',
    'major_company_news': 'Major Company News',
    'bullish_news': 'Bullish News',
    'bearish_news': 'Bearish News',
    'news_analysis_completed': 'News Analysis Completed',
    'ai_analysis_completed': 'AI Analysis Completed',
    'daily_market_summary': 'Daily Market Summary',
    'market_open': 'Market Open',
    'market_close': 'Market Close',
  };

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final p = await NotificationApi.preferences();
      if (mounted) {
        setState(() {
          prefs = p;
          loading = false;
        });
      }
    } catch (e) {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _toggle(String key, bool value) async {
    setState(() {
      prefs[key] = value;
      saving = true;
    });
    try {
      await NotificationApi.savePreferences(prefs);
    } on ApiException catch (e) {
      if (mounted) {
        setState(() => prefs[key] = !value);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      }
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('NOTIFICATIONS'),
        actions: [
          if (saving) const Padding(padding: EdgeInsets.all(16), child: SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))),
        ],
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              children: [
                const Padding(
                  padding: EdgeInsets.fromLTRB(20, 12, 20, 4),
                  child: Text(
                    'Each notification type has its own independent ON/OFF control. If a type is OFF, it will never be delivered — the event still appears inside the app.',
                    style: TextStyle(fontSize: 12, color: Colors.grey, height: 1.4),
                  ),
                ),
                ..._labels.entries.map(
                  (e) => SwitchListTile(
                    title: Text(e.value, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                    value: prefs[e.key] ?? false,
                    onChanged: (v) => _toggle(e.key, v),
                  ),
                ),
                const SizedBox(height: 24),
              ],
            ),
    );
  }
}
