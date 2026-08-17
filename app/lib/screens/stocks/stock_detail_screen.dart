import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/theme.dart';
import '../../models/models.dart';
import '../../providers/providers.dart';
import '../../services/api_services.dart';
import '../../widgets/candle_chart.dart';
import '../../widgets/common.dart';

class StockDetailScreen extends StatefulWidget {
  final String symbol;
  final String companyName;

  const StockDetailScreen({super.key, required this.symbol, required this.companyName});

  @override
  State<StockDetailScreen> createState() => _StockDetailScreenState();
}

class _StockDetailScreenState extends State<StockDetailScreen> {
  bool analyzing = false;
  AnalysisJob? job;
  Timer? _poll;
  Timer? _quoteTimer;
  bool _useHistorical = true;

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
    if (!silent) setState(() {
      marketLoading = true;
      marketError = null;
    });
    try {
      final results = await Future.wait([
        MarketApi.details(symbol: widget.symbol, kind: 'stock'),
        MarketApi.candles(symbol: widget.symbol, kind: 'stock', days: 120),
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
      job = const AnalysisJob(status: 'preparing', message: 'Preparing historical analysis...');
    });
    try {
      final String jobId;
      if (_useHistorical) {
        jobId = await AiApi.startHistorical(symbol: widget.symbol, companyName: widget.companyName, query: widget.companyName);
      } else {
        jobId = await AiApi.startSymbolAnalysis(symbol: widget.symbol, companyName: widget.companyName);
      }
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
      appBar: AppBar(title: Text(widget.symbol)),
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
              if (details!.week52 != null) ...[
                _Week52Card(week52: details!.week52!, today: details!.today),
                const SizedBox(height: 12),
              ],
              _FundamentalsCard(f: details!.fundamentals),
              const SizedBox(height: 12),
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
            // ── AI ANALYSIS (unchanged) ─────────────────────────
            Card(
              child: Padding(
                padding: const EdgeInsets.all(18),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(widget.symbol, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900)),
                        ),
                        const Icon(Icons.business, color: AppColors.primary),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(widget.companyName, style: TextStyle(fontSize: 13, color: Colors.grey.shade600)),
                    const SizedBox(height: 12),
                    const Divider(),
                    const SizedBox(height: 4),
                    const Text('AI STOCK ANALYSIS', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800, letterSpacing: 1)),
                    const SizedBox(height: 6),
                    const Text(
                      'Runs the 3-stage AI pipeline (News Intelligence → Market Impact → Final Intelligence) with 1-year historical news. Longer-duration opportunities: 1–3 months. Decision-support only, never a guarantee.',
                      style: TextStyle(fontSize: 12, height: 1.5, color: Colors.grey),
                    ),
                    const SizedBox(height: 16),
                    SwitchListTile(
                      contentPadding: EdgeInsets.zero,
                      title: const Text('One-Year Historical Analysis', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700)),
                      subtitle: Text(_useHistorical ? 'Collects 1 year of company news in batches' : 'Uses recent news only (faster)', style: const TextStyle(fontSize: 12)),
                      value: _useHistorical,
                      onChanged: (v) => setState(() => _useHistorical = v),
                    ),
                    const SizedBox(height: 8),
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
              _JobCard(job: job!, symbol: widget.symbol),
            ],
            const SizedBox(height: 16),
            Text(
              'Expected job stages: Preparing historical analysis... → Collecting data... → Filtering news... → AI Analysis 1/3... → AI Analysis 2/3... → Final Analysis... → Completed',
              style: TextStyle(fontSize: 11, color: Colors.grey.shade500, height: 1.5),
            ),
          ],
        ),
      ),
    );
  }
}

/// Live price header with today's high / low.
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

/// 52-week range with a position indicator.
class _Week52Card extends StatelessWidget {
  final Week52Range week52;
  final TodayRange today;
  const _Week52Card({required this.week52, required this.today});

  @override
  Widget build(BuildContext context) {
    final pos = week52.rangePosition.clamp(0.0, 100.0);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('52 WEEK RANGE', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, letterSpacing: 1, color: Colors.grey)),
            const SizedBox(height: 10),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(formatPrice(week52.low), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
                Text('${pos.toStringAsFixed(1)}% of range', style: TextStyle(fontSize: 11, color: Colors.grey.shade600)),
                Text(formatPrice(week52.high), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
              ],
            ),
            const SizedBox(height: 8),
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: Stack(
                children: [
                  Container(height: 8, color: Colors.grey.withValues(alpha: 0.25)),
                  Container(
                    height: 8,
                    width: double.infinity * pos / 100,
                    color: AppColors.gain.withValues(alpha: 0.7),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Current: ${formatPrice(today.ltp)}',
              style: TextStyle(fontSize: 12, color: Colors.grey.shade600),
            ),
          ],
        ),
      ),
    );
  }
}

/// Fundamentals / key market data for the stock.
class _FundamentalsCard extends StatelessWidget {
  final Fundamentals f;
  const _FundamentalsCard({required this.f});

  @override
  Widget build(BuildContext context) {
    Widget row(String k, String v) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 5),
          child: Row(
            children: [
              SizedBox(width: 140, child: Text(k, style: TextStyle(fontSize: 12.5, color: Colors.grey.shade600))),
              Expanded(child: Text(v, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700))),
            ],
          ),
        );

    String num(double v) => v >= 100000 ? '${(v / 100000).toStringAsFixed(2)}L' : v >= 1000 ? '${(v / 1000).toStringAsFixed(1)}K' : v.toStringAsFixed(0);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('FUNDAMENTALS', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, letterSpacing: 1, color: Colors.grey)),
            const SizedBox(height: 8),
            row('Previous Close', formatPrice(f.previousClose)),
            if (f.openInterest > 0) row('Open Interest', num(f.openInterest)),
            row('Volume (today)', num(f.volume)),
            row('Buy Quantity', num(f.buyQuantity)),
            row('Sell Quantity', num(f.sellQuantity)),
            if (f.lowerCircuit > 0) ...[
              row('Lower Circuit', formatPrice(f.lowerCircuit)),
              row('Upper Circuit', formatPrice(f.upperCircuit)),
            ],
            if (f.lastTradedTime.isNotEmpty) row('Last Traded Time', f.lastTradedTime),
          ],
        ),
      ),
    );
  }
}

class _JobCard extends StatelessWidget {
  final AnalysisJob job;
  final String symbol;
  const _JobCard({required this.job, required this.symbol});

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
                Expanded(
                  child: Text(
                    job.message.isEmpty ? 'Working...' : job.message,
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                ),
              ],
            ),
            if (!done && !failed && job.progress != null) ...[
              const SizedBox(height: 12),
              LinearProgressIndicator(value: job.progress!.clamp(0.0, 1.0), minHeight: 6, borderRadius: BorderRadius.circular(3)),
            ],
            if (done && job.report != null) ...[
              const Divider(height: 28),
              _Report(report: job.report!, symbol: symbol),
            ],
          ],
        ),
      ),
    );
  }
}

class _Report extends StatelessWidget {
  final Map<String, dynamic> report;
  final String symbol;
  const _Report({required this.report, required this.symbol});

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
        Text('FINAL HISTORICAL REPORT', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: signalColor, letterSpacing: 1)),
        const SizedBox(height: 10),
        kv('Signal', signal),
        kv('Entry Zone', report['entryZone'] as String? ?? ''),
        kv('Target', report['target'] as String? ?? ''),
        kv('Stop Loss', report['stopLoss'] as String? ?? ''),
        kv('Timeframe', report['timeframe'] as String? ?? ''),
        kv('Risk', report['risk'] as String? ?? ''),
        kv('Confidence', '${report['confidence'] ?? '—'}%'),
        if ((report['reasoning'] as String?)?.isNotEmpty == true) ...[
          const SizedBox(height: 8),
          Text(report['reasoning'] as String, style: const TextStyle(fontSize: 13, height: 1.4)),
        ],
        if ((report['summary'] as String?)?.isNotEmpty == true) ...[
          const SizedBox(height: 8),
          Text(report['summary'] as String, style: TextStyle(fontSize: 12, height: 1.4, color: Colors.grey.shade700)),
        ],
      ],
    );
  }
}
