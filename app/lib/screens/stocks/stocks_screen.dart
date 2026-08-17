import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../models/models.dart';
import '../../services/api_services.dart';
import 'stock_detail_screen.dart';

class StocksScreen extends StatefulWidget {
  const StocksScreen({super.key});

  @override
  State<StocksScreen> createState() => _StocksScreenState();
}

class _StocksScreenState extends State<StocksScreen> {
  List<Analysis> analyses = [];
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
      final a = await AiApi.analyses(kind: 'stock');
      if (mounted) setState(() {
        analyses = a;
        loading = false;
      });
    } catch (e) {
      if (mounted) setState(() {
        error = e is ApiException ? e.message : 'Failed to load stocks';
        loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('STOCKS'),
        actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: loading ? null : _load)],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: loading
            ? const Center(child: CircularProgressIndicator())
            : error != null
                ? ListView(children: [Padding(padding: const EdgeInsets.all(24), child: Text(error!, textAlign: TextAlign.center))])
                : analyses.isEmpty
                    ? ListView(
                        children: const [
                          Padding(
                            padding: EdgeInsets.all(40),
                            child: Column(
                              children: [
                                Icon(Icons.business, size: 48, color: Colors.grey),
                                SizedBox(height: 12),
                                Text('No stock analyses yet', style: TextStyle(fontWeight: FontWeight.w800)),
                                SizedBox(height: 6),
                                Text('Open a stock and tap ANALYZE to run the 3-stage AI pipeline. Longer-duration opportunities (1–3 months) appear here.', textAlign: TextAlign.center, style: TextStyle(fontSize: 13, color: Colors.grey)),
                              ],
                            ),
                          ),
                        ],
                      )
                    : ListView.builder(
                        itemCount: analyses.length,
                        itemBuilder: (c, i) => _AnalysisTile(analysis: analyses[i]),
                      ),
      ),
    );
  }
}

class _AnalysisTile extends StatelessWidget {
  final Analysis analysis;
  const _AnalysisTile({required this.analysis});

  @override
  Widget build(BuildContext context) {
    final signalColor = analysis.aiSignal == 'BUY'
        ? AppColors.gain
        : analysis.aiSignal == 'WATCH'
            ? AppColors.gold
            : AppColors.loss;
    return Card(
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 8),
        leading: CircleAvatar(
          backgroundColor: signalColor.withValues(alpha: 0.15),
          child: Text(analysis.symbol.isNotEmpty ? analysis.symbol[0] : '?', style: TextStyle(color: signalColor, fontWeight: FontWeight.w900)),
        ),
        title: Text(analysis.symbol, style: const TextStyle(fontWeight: FontWeight.w800)),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 2),
            Text(
              'Target ${analysis.target.isEmpty ? '—' : analysis.target} · SL ${analysis.stopLoss.isEmpty ? '—' : analysis.stopLoss}',
              style: const TextStyle(fontSize: 12),
            ),
            Text('${analysis.timeframe.isEmpty ? '—' : analysis.timeframe} · Risk ${analysis.risk.toUpperCase()} · Confidence ${analysis.confidence}%',
                style: TextStyle(fontSize: 11, color: Colors.grey.shade600)),
          ],
        ),
        trailing: Text(analysis.aiSignal, style: TextStyle(color: signalColor, fontWeight: FontWeight.w900)),
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => StockDetailScreen(symbol: analysis.symbol, companyName: analysis.symbol)),
        ),
      ),
    );
  }
}
