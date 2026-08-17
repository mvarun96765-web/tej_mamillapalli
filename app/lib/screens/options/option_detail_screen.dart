import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/theme.dart';
import '../../models/models.dart';
import '../../providers/providers.dart';
import '../../services/api_services.dart';
import '../../widgets/candle_chart.dart';
import '../../widgets/common.dart';

class OptionDetailScreen extends StatefulWidget {
  final String symbol;
  const OptionDetailScreen({super.key, required this.symbol});

  @override
  State<OptionDetailScreen> createState() => _OptionDetailScreenState();
}

class _OptionDetailScreenState extends State<OptionDetailScreen> {
  bool analyzing = false;
  AnalysisJob? job;
  Timer? _poll;
  Timer? _quoteTimer;

  // Live market data
  InstrumentDetails? details;
  List<Candle> candles = [];
  bool marketLoading = true;
  String? marketError;

  @override
  void initState() {
    super.initState();
    _loadMarket();
    _quoteTimer = Timer.periodic(const Duration(seconds: 10), (_) => _loadMarket(silent: true));
  }

  @override
  void dispose() {
    _poll?.cancel();
    _quoteTimer?.cancel();
    super.dispose();
  }

  Future<void> _loadMarket({bool silent = false}) async {
    if (!silent) {
      setState(() {
        marketLoading = true;
        marketError = null;
      });
    }
    try {
      final results = await Future.wait([
        MarketApi.details(symbol: widget.symbol, kind: 'option'),
        MarketApi.candles(symbol: widget.symbol, kind: 'option', days: 120),
      ]);
      if (!mounted) return;
      setState(() {
        details = results[0] as InstrumentDetails;
        candles = results[1] as List<Candle>;
        marketLoading = false;
        marketError = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        marketError = e is ApiException ? e.message : 'Failed to load market data';
        marketLoading = false;
      });
    }
  }

  Future<void> _analyze() async {
    setState(() {
      analyzing = true;
      job = const AnalysisJob(status: 'preparing', message: 'Preparing analysis...');
    });
    try {
      final jobId = await AiApi.startSymbolAnalysis(symbol: widget.symbol, kind: 'option');
      _poll?.cancel();
      _poll = Timer.periodic(const Duration(seconds: 2), (_) => _pollJob(jobId));
    } catch (e) {
      setState(() {
        analyzing = false;
        job = AnalysisJob(status: 'error', message: e is ApiException ? e.message : 'Failed to start analysis');
      });
    }
  }

  Future<void> _pollJob(String jobId) async {
    try {
      final j = await AiApi.jobStatus(jobId);
      if (!mounted) return;
      setState(() => job = j);
      if (j.status == 'completed' || j.status == 'error') {
        _poll?.cancel();
        setState(() => analyzing = false);
        context.read<NotificationProvider>().refresh();
      }
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('OPTION')),
      body: RefreshIndicator(
        onRefresh: () => _loadMarket(),
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (marketLoading && details == null)
              const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator()))
            else if (marketError != null && details == null)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(children: [
                    const Icon(Icons.cloud_off, size: 40, color: Colors.grey),
                    const SizedBox(height: 8),
                    Text(marketError!, textAlign: TextAlign.center),
                    const SizedBox(height: 10),
                    OutlinedButton(onPressed: _loadMarket, child: const Text('Retry')),
                  ]),
                ),
              )
            else if (details != null) ...[
              _LivePriceCard(details: details!),
              const SizedBox(height: 12),
              if (details!.quote.oi > 0) ...[
                _OptionStatsCard(details: details!),
                const SizedBox(height: 12),
              ],
            ],
            // ── LIVE CANDLESTICK CHART ──────────────────────────
            Card(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(8, 14, 8, 10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                      child: Row(
                        children: [
                          const Text('LIVE CHART · DAILY CANDLES', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800, letterSpacing: 0.5)),
                          const Spacer(),
                          Icon(Icons.trending_up, size: 16, color: AppColors.gain),
                          const SizedBox(width: 4),
                          Text('120 days', style: TextStyle(fontSize: 11, color: Colors.grey.shade600)),
                        ],
                      ),
                    ),
                    const SizedBox(height: 8),
                    if (candles.isEmpty)
                      SizedBox(
                        height: 220,
                        child: Center(child: Text('Chart unavailable', style: TextStyle(color: Colors.grey.shade500))),
                      )
                    else
                      CandleChart(
                        candles: candles,
                        livePrice: details?.quote.ltp,
                        height: 240,
                      ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
            // ── AI ANALYSIS ─────────────────────────────────────
            Card(
              child: Padding(
                padding: const EdgeInsets.all(18),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(widget.symbol, style: const TextStyle(fontSize: 21, fontWeight: FontWeight.w900)),
                        ),
                        const Icon(Icons.show_chart, color: AppColors.primary),
                      ],
                    ),
                    const SizedBox(height: 12),
                    const Divider(),
                    const Text('AI OPTION ANALYSIS', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800, letterSpacing: 1)),
                    const SizedBox(height: 6),
                    const Text(
                      'Considers underlying, strike, expiry, option type, live price, volatility, liquidity, open interest, trend and news impact. Output: BUY / WATCH / AVOID with entry zone, target & stop-loss. Decision-support only, never a guarantee.',
                      style: TextStyle(fontSize: 12, height: 1.5, color: Colors.grey),
                    ),
                    const SizedBox(height: 16),
                    PrimaryButton(
                      label: analyzing ? 'ANALYZING...' : 'ANALYZE',
                      loading: analyzing,
                      onPressed: analyzing ? null : _analyze,
                    ),
                  ],
                ),
              ),
            ),
            if (job != null) ...[
              const SizedBox(height: 12),
              _OptionJobCard(job: job!),
            ],
            const SizedBox(height: 16),
          ],
        ),
      ),
    );
  }
}

/// Live option price header with today's high / low / open / OI.
class _LivePriceCard extends StatelessWidget {
  final InstrumentDetails details;
  const _LivePriceCard({required this.details});

  @override
  Widget build(BuildContext context) {
    final t = details.today;
    final color = AppTheme.changeColor(t.percentChange);

    Widget kv(String k, String v, {Color? c}) => Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(k, style: TextStyle(fontSize: 11, color: Colors.grey.shade600)),
              const SizedBox(height: 2),
              FittedBox(
                child: Text(v, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: c)),
              ),
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
                const Text('LIVE PRICE', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, letterSpacing: 1, color: AppColors.gain)),
                const Spacer(),
                Container(width: 7, height: 7, decoration: const BoxDecoration(color: AppColors.gain, shape: BoxShape.circle)),
                const SizedBox(width: 4),
                Text('LIVE', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: AppColors.gain)),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(formatPrice(t.ltp), style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w900)),
                const SizedBox(width: 10),
                Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: Text(
                    '${t.netchange >= 0 ? '+' : ''}${t.netchange.toStringAsFixed(2)} (${t.percentChange >= 0 ? '+' : ''}${t.percentChange.toStringAsFixed(2)}%)',
                    style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: color),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                kv('Today High', formatPrice(t.high), c: AppColors.gain),
                kv('Today Low', formatPrice(t.low), c: AppColors.loss),
                kv('Open', formatPrice(t.open)),
                kv('Prev Close', formatPrice(details.fundamentals.previousClose)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Option liquidity / interest stats.
class _OptionStatsCard extends StatelessWidget {
  final InstrumentDetails details;
  const _OptionStatsCard({required this.details});

  @override
  Widget build(BuildContext context) {
    final q = details.quote;
    final f = details.fundamentals;

    String num(double v) => v >= 100000 ? '${(v / 100000).toStringAsFixed(2)}L' : v >= 1000 ? '${(v / 1000).toStringAsFixed(1)}K' : v.toStringAsFixed(0);

    Widget row(String k, String v) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 5),
          child: Row(
            children: [
              SizedBox(width: 140, child: Text(k, style: TextStyle(fontSize: 12.5, color: Colors.grey.shade600))),
              Expanded(child: Text(v, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700))),
            ],
          ),
        );

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('OPTION STATS', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, letterSpacing: 1, color: Colors.grey)),
            const SizedBox(height: 8),
            if (q.oi > 0) row('Open Interest', num(q.oi)),
            row('Volume (today)', num(f.volume)),
            row('Buy Quantity', num(f.buyQuantity)),
            row('Sell Quantity', num(f.sellQuantity)),
            if (f.lastTradedTime.isNotEmpty) row('Last Traded Time', f.lastTradedTime),
          ],
        ),
      ),
    );
  }
}

class _OptionJobCard extends StatelessWidget {
  final AnalysisJob job;
  const _OptionJobCard({required this.job});

  @override
  Widget build(BuildContext context) {
    final done = job.status == 'completed';
    final failed = job.status == 'error';
    final color = done ? AppColors.gain : (failed ? AppColors.loss : AppColors.primary);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(done ? Icons.check_circle : (failed ? Icons.error : Icons.sync), color: color),
                const SizedBox(width: 10),
                Expanded(child: Text(job.message.isEmpty ? 'Working...' : job.message, style: const TextStyle(fontWeight: FontWeight.w700))),
              ],
            ),
            if (done && job.report != null) ...[
              const Divider(height: 28),
              _OptionReport(report: job.report!),
            ],
          ],
        ),
      ),
    );
  }
}

class _OptionReport extends StatelessWidget {
  final Map<String, dynamic> report;
  const _OptionReport({required this.report});

  @override
  Widget build(BuildContext context) {
    final signal = (report['signal'] as String?) ?? '—';
    final signalColor = signal == 'BUY'
        ? AppColors.gain
        : signal == 'WATCH'
            ? AppColors.gold
            : AppColors.loss;

    Widget kv(String k, String v) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 3),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(width: 110, child: Text(k, style: const TextStyle(fontSize: 12, color: Colors.grey))),
              Expanded(child: Text(v.isEmpty ? '—' : v, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600))),
            ],
          ),
        );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('FINAL REPORT', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: signalColor, letterSpacing: 1)),
        const SizedBox(height: 10),
        kv('Signal', signal),
        kv('Entry Zone', report['entryZone'] as String? ?? ''),
        kv('Target', report['target'] as String? ?? ''),
        kv('Stop Loss', report['stopLoss'] as String? ?? ''),
        kv('Time Horizon', report['timeframe'] as String? ?? ''),
        kv('Risk', report['risk'] as String? ?? ''),
        kv('AI Confidence', '${report['confidence'] ?? '—'}%'),
        if ((report['reasoning'] as String?)?.isNotEmpty == true) ...[
          const SizedBox(height: 8),
          Text(report['reasoning'] as String, style: const TextStyle(fontSize: 13, height: 1.4)),
        ],
      ],
    );
  }
}
