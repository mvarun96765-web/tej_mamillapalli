import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../providers/providers.dart';
import '../../widgets/common.dart';

class InboxScreen extends StatefulWidget {
  const InboxScreen({super.key});

  @override
  State<InboxScreen> createState() => _InboxScreenState();
}

class _InboxScreenState extends State<InboxScreen> {
  @override
  Widget build(BuildContext context) {
    final notif = context.watch<NotificationProvider>();
    return Scaffold(
      appBar: AppBar(
        title: const Text('NOTIFICATIONS'),
        actions: [
          TextButton(onPressed: notif.unread > 0 ? notif.markAllRead : null, child: const Text('Mark all read')),
        ],
      ),
      body: notif.notifications.isEmpty
          ? const Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.notifications_none, size: 56, color: Colors.grey),
                  SizedBox(height: 12),
                  Text('No notifications yet', style: TextStyle(fontWeight: FontWeight.w800)),
                  SizedBox(height: 6),
                  Text('Trade signals, news and AI analysis updates will appear here.', style: TextStyle(fontSize: 13, color: Colors.grey)),
                ],
              ),
            )
          : RefreshIndicator(
              onRefresh: notif.refresh,
              child: ListView.builder(
                itemCount: notif.notifications.length,
                itemBuilder: (c, i) {
                  final n = notif.notifications[i];
                  return ListTile(
                    leading: Icon(
                      _iconFor(n.type),
                      color: n.read ? Colors.grey : Theme.of(context).colorScheme.primary,
                    ),
                    title: Text(
                      n.title,
                      style: TextStyle(
                        fontWeight: n.read ? FontWeight.w600 : FontWeight.w800,
                        color: n.read ? Colors.grey.shade600 : null,
                      ),
                    ),
                    subtitle: Text(
                      '${n.body.isEmpty ? '' : '${n.body}\n'}${timeAgo(n.createdAt)}',
                      style: const TextStyle(fontSize: 12),
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                    ),
                    trailing: n.read
                        ? null
                        : Container(width: 10, height: 10, decoration: const BoxDecoration(color: Color(0xFFFF5252), shape: BoxShape.circle)),
                    onTap: () {
                      if (!n.read) notif.markRead([n.id]);
                    },
                  );
                },
              ),
            ),
    );
  }

  IconData _iconFor(String type) {
    switch (type) {
      case 'new_trade':
      case 'high_confidence_trade':
      case 'trade_update':
      case 'target_reached':
      case 'stop_loss_alert':
      case 'new_stock_opportunity':
      case 'new_option_opportunity':
        return Icons.swap_vert;
      case 'market_alert':
      case 'market_open':
      case 'market_close':
      case 'daily_market_summary':
        return Icons.query_stats;
      case 'bullish_news':
      case 'bearish_news':
      case 'important_news':
      case 'major_company_news':
        return Icons.article_outlined;
      case 'news_analysis_completed':
      case 'ai_analysis_completed':
        return Icons.auto_awesome;
      default:
        return Icons.notifications_none;
    }
  }
}
