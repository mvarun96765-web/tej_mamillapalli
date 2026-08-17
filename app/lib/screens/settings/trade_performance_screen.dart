import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../models/models.dart';
import '../../services/api_services.dart';
import '../../widgets/common.dart';

/// Settings -> Trade Performance / AI Trade History.
/// Shows 24-hour AI trade performance (total, success, loss, expired and
/// rates) plus the complete record of every closed trade.
class TradePerformanceScreen extends StatefulWidget {
  const TradePerformanceScreen({super.key});

  @override
  State<TradePerformanceScreen> createState() => _TradePerformanceScreenState();
}

class _TradePerformanceScreenState extends State<TradePerformanceScreen> {
  TradePerformance? performance;
  List<TradeHistoryRecord> history = [];
  bool loading = true;
  String? error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final p = await AiApi.tradePerformance();
      final h = await AiApi.tradeHistory();
      if (mounted) setState(() {
        performance = p;
        history = h;
        loading = false;
      });
    } catch (e) {
      if (mounted) setState(() {
        error = e is ApiException ? e.message : 'Failed to load trade performance';
        loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('TRADE PERFORMANCE'),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: loading ? null : _load),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: loading
            ? const Center(child: CircularProgressIndicator())
            : error != null
                ? ListView(
                    children: [
                      Padding(
                        padding: const EdgeInsets.all(24),
                        child: Column(
                          children: [
                            const Icon(Icons.cloud_off, size: 48, color: Colors.grey),
                            const SizedBox(height: 12),
                            Text(error!, textAlign: TextAlign.center),
                            const SizedBox(height: 16),
                            ElevatedButton(onPressed: _load, child: const Text('Retry')),
                          ],
                        ),
                      ),
                    ],
                  )
                : ListView(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                    children: [
                      if (performance != null) _SummaryCard(p: performance!),
                      const SizedBox(height: 8),
                      const SectionHeader('CLOSED TRADES · LAST 24 HOURS'),
                      if (history.isEmpty)
                        Padding(
                          padding: const EdgeInsets.all(32),
                          child: Column(
                            children: [
                              const Icon(Icons.history, size: 44, color: Colors.grey),
                              const SizedBox(height: 10),
                              Text('No closed trades in the last 24 hours',
                                  textAlign: TextAlign.center, style: TextStyle(color: Colors.grey.shade600, fontSize: 13)),
                            ],
                          ),
                        )
                      else
                        ...history.map((h) => _HistoryCard(record: h)),
                    ],
                  ),
      ),
    );
  }
}

class _SummaryCard extends StatelessWidget {
  final TradePerformance p;
  const _SummaryCard({required this.p});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    Widget stat(String label, String value, {Color? color}) => Expanded(
          child: Column(
            children: [
              Text(value, style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: color)),
              const SizedBox(height: 2),
              Text(label, style: TextStyle(fontSize: 11, color: Colors.grey.shade600), textAlign: TextAlign.center),
            ],
          ),
        );

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text('AI TRADE PERFORMANCE', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800, letterSpacing: 1, color: theme.colorScheme.primary)),
                const Spacer(),
                Text('Last 24h', style: TextStyle(fontSize: 11, color: Colors.grey.shade500)),
              ],
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                stat('Total Trades', '${p.total}'),
                stat('Successful', '${p.successful}', color: AppColors.gain),
                stat('Loss Trades', '${p.loss}', color: AppColors.loss),
                stat('Expired', '${p.expired}', color: AppColors.gold),
              ],
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                stat('Success Rate', '${p.successRate}%', color: AppColors.gain),
                stat('Loss Rate', '${p.lossRate}%', color: AppColors.loss),
                stat('Active Now', '${p.activeCount}'),
                stat('Cancelled', '${p.cancelled}'),
              ],
            ),
            const SizedBox(height: 12),
            Text(
              'A trade counts as Success only when the actual price reaches the target, and as Loss only when it reaches the stop loss. Trades that hit neither level before market close are recorded separately as Expired — they never inflate the success or loss rate.',
              style: TextStyle(fontSize: 11, color: Colors.grey.shade600, height: 1.4),
            ),
          ],
        ),
      ),
    );
  }
}

class _HistoryCard extends StatelessWidget {
  final TradeHistoryRecord record;
  const _HistoryCard({required this.record});

  @override
  Widget build(BuildContext context) {
    final statusColor = switch (record.finalStatus) {
      'TARGET_REACHED' => AppColors.gain,
      'STOP_LOSS_REACHED' => AppColors.loss,
      'EXPIRED_AT_MARKET_CLOSE' => AppColors.gold,
      _ => Colors.grey,
    };

    Widget kv(String k, String v) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 2),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(width: 120, child: Text(k, style: TextStyle(fontSize: 12, color: Colors.grey.shade600))),
              Expanded(child: Text(v.isEmpty ? '—' : v, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600))),
            ],
          ),
        );

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(record.symbol, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: statusColor.withValues(alpha: 0.14),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    record.finalStatus.replaceAll('_', ' '),
                    style: TextStyle(color: statusColor, fontSize: 11, fontWeight: FontWeight.w800),
                  ),
                ),
              ],
            ),
            if (record.instrument.isNotEmpty) ...[
              const SizedBox(height: 2),
              Text(record.instrument, style: TextStyle(fontSize: 12, color: Colors.grey.shade600)),
            ],
            const Divider(height: 20),
            kv('Result', record.result),
            kv('Entry Price', record.entryPrice),
            kv('Target', record.target),
            kv('Stop Loss', record.stopLoss),
            kv('Highest Price', record.highestPrice),
            kv('Lowest Price', record.lowestPrice),
            kv('Final Market Price', record.finalPrice),
            kv('Generated', record.generatedAt.isEmpty ? '—' : timeAgo(record.generatedAt)),
            kv('Closed', record.closedAt.isEmpty ? '—' : timeAgo(record.closedAt)),
            if (record.reason.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text('AI Reasoning: ${record.reason}', style: TextStyle(fontSize: 12, color: Colors.grey.shade700, height: 1.4)),
            ],
          ],
        ),
      ),
    );
  }
}
