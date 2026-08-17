import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../models/models.dart';
import '../../services/api_services.dart';
import '../../widgets/common.dart';

class TradesScreen extends StatefulWidget {
  const TradesScreen({super.key});

  @override
  State<TradesScreen> createState() => _TradesScreenState();
}

class _TradesScreenState extends State<TradesScreen> {
  List<Trade> trades = [];
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
      final t = await AiApi.trades();
      if (mounted) setState(() {
        trades = t;
        loading = false;
      });
    } catch (e) {
      if (mounted) setState(() {
        error = e is ApiException ? e.message : 'Failed to load trades';
        loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('TRADES'),
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
                : trades.isEmpty
                    ? ListView(
                        children: const [
                          Padding(
                            padding: EdgeInsets.all(40),
                            child: Column(
                              children: [
                                Icon(Icons.auto_awesome, size: 48, color: Colors.grey),
                                SizedBox(height: 12),
                                Text('No Trades Available Now', style: TextStyle(fontWeight: FontWeight.w800)),
                                SizedBox(height: 6),
                                Text('Trades appear only when the 3-stage AI pipeline finds an options opportunity with 50% or higher potential profit during market hours (08:00–14:00 IST news analysis). The system never forces a trade.', textAlign: TextAlign.center, style: TextStyle(fontSize: 13, color: Colors.grey)),
                              ],
                            ),
                          ),
                        ],
                      )
                    : ListView.builder(
                        itemCount: trades.length,
                        itemBuilder: (c, i) => _TradeDetailCard(trade: trades[i]),
                      ),
      ),
    );
  }
}

class _TradeDetailCard extends StatelessWidget {
  final Trade trade;
  const _TradeDetailCard({required this.trade});

  @override
  Widget build(BuildContext context) {
    final signalColor = trade.signal == 'BUY'
        ? AppColors.gain
        : trade.signal == 'WATCH'
            ? AppColors.gold
            : AppColors.loss;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
                  decoration: BoxDecoration(color: signalColor.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(8)),
                  child: Text(trade.signal, style: TextStyle(color: signalColor, fontWeight: FontWeight.w900)),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(trade.symbol, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900)),
                ),
                if (trade.highConfidence)
                  const Tooltip(
                    message: 'High-confidence trade',
                    child: Icon(Icons.verified, color: AppColors.primary),
                  ),
              ],
            ),
            if (trade.instrument.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(trade.instrument, style: TextStyle(fontSize: 13, color: Colors.grey.shade600)),
            ],
            const Divider(height: 24),
            Row(
              children: [
                _kv('Entry Zone', trade.entryZone),
                _kv('Target', trade.target),
                _kv('Stop Loss', trade.stopLoss),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('AI Confidence', style: TextStyle(fontSize: 11, color: Colors.grey)),
                      const SizedBox(height: 4),
                      LinearProgressIndicator(
                        value: (trade.confidence / 100).clamp(0, 1),
                        minHeight: 8,
                        borderRadius: BorderRadius.circular(4),
                        color: signalColor,
                        backgroundColor: Colors.grey.shade300,
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 16),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text('${trade.confidence}%', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900)),
                    Text('Risk: ${trade.risk.toUpperCase()} · ${trade.timeframe}', style: TextStyle(fontSize: 11, color: Colors.grey.shade600)),
                  ],
                ),
              ],
            ),
            if (trade.reason.isNotEmpty) ...[
              const SizedBox(height: 12),
              Text(trade.reason, style: TextStyle(fontSize: 13, color: Colors.grey.shade700, height: 1.4)),
            ],
            const SizedBox(height: 8),
            Text('Generated ${timeAgo(trade.createdAt)} · Status: ${trade.status.replaceAll('_', ' ')} · Potential profit ${trade.confidence}%',
                style: TextStyle(fontSize: 11, color: Colors.grey.shade500)),
          ],
        ),
      ),
    );
  }

  Widget _kv(String k, String v) {
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(k, style: const TextStyle(fontSize: 11, color: Colors.grey)),
          const SizedBox(height: 2),
          Text(v.isEmpty ? '—' : v, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }
}
