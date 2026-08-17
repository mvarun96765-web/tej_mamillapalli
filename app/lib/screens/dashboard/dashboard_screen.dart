import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/theme.dart';
import '../../models/models.dart';
import '../../providers/providers.dart';
import '../../services/api_services.dart';
import '../../widgets/common.dart';
import '../notifications/inbox_screen.dart';
import '../options/options_screen.dart';
import '../profile/profile_screen.dart';
import '../search/search_screen.dart';
import '../stocks/stocks_screen.dart';
import '../trades/trades_screen.dart';

/// Main application shell: Dashboard tab (spec order) + quick tabs.
class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  int _tab = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<MarketProvider>().startPolling();
      context.read<NotificationProvider>().startPolling();
    });
  }

  @override
  void dispose() {
    context.read<MarketProvider>().stopPolling();
    context.read<NotificationProvider>().stopPolling();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(
        index: _tab,
        children: const [
          _DashboardTab(),
          TradesScreen(),
          StocksScreen(),
          OptionsScreen(),
          ProfileScreen(),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) => setState(() => _tab = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.dashboard_outlined), selectedIcon: Icon(Icons.dashboard), label: 'Home'),
          NavigationDestination(icon: Icon(Icons.swap_vert), label: 'Trades'),
          NavigationDestination(icon: Icon(Icons.business_outlined), selectedIcon: Icon(Icons.business), label: 'Stocks'),
          NavigationDestination(icon: Icon(Icons.show_chart_outlined), selectedIcon: Icon(Icons.show_chart), label: 'Options'),
          NavigationDestination(icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person), label: 'Profile'),
        ],
      ),
    );
  }
}

class _DashboardTab extends StatefulWidget {
  const _DashboardTab();

  @override
  State<_DashboardTab> createState() => _DashboardTabState();
}

class _DashboardTabState extends State<_DashboardTab> {
  List<Trade> _trades = [];
  bool _tradesLoaded = false;

  @override
  void initState() {
    super.initState();
    _loadTrades();
  }

  Future<void> _loadTrades() async {
    try {
      final trades = await AiApi.trades();
      if (mounted) setState(() {
        _trades = trades.take(5).toList();
        _tradesLoaded = true;
      });
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final market = context.watch<MarketProvider>();
    final notif = context.watch<NotificationProvider>();
    final session = context.watch<SessionProvider>();
    final user = session.user;
    final theme = Theme.of(context);

    return RefreshIndicator(
      onRefresh: () => market.refresh(),
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          SliverAppBar(
            pinned: true,
            floating: true,
            title: Row(
              children: [
                // App icon (asset placeholder, replaceable later)
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: theme.colorScheme.primary,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(Icons.trending_up_rounded, color: Colors.white, size: 22),
                ),
                const SizedBox(width: 12),
                // Search bar -> Search screen
                Expanded(
                  child: GestureDetector(
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => const SearchScreen()),
                    ),
                    child: Container(
                      height: 40,
                      padding: const EdgeInsets.symmetric(horizontal: 14),
                      decoration: BoxDecoration(
                        color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.6),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Row(
                        children: [
                          Icon(Icons.search, size: 18, color: Colors.grey.shade600),
                          const SizedBox(width: 8),
                          Text('Search stocks, companies, options...',
                              style: TextStyle(fontSize: 13, color: Colors.grey.shade600)),
                        ],
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                // Notifications bell
                IconButton(
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const InboxScreen()),
                  ),
                  icon: NotificationBell(unread: notif.unread),
                ),
                // Profile picture -> Profile
                GestureDetector(
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const ProfileScreen()),
                  ),
                  child: CircleAvatar(
                    radius: 18,
                    backgroundColor: theme.colorScheme.primary.withValues(alpha: 0.15),
                    backgroundImage: (user != null && user.profilePic.isNotEmpty)
                        ? MemoryImage(base64DecodeSafe(user.profilePic))
                        : null,
                    child: (user == null || user.profilePic.isEmpty)
                        ? Text(
                            (user!.name.isNotEmpty ? user.name[0] : 'U').toUpperCase(),
                            style: TextStyle(fontWeight: FontWeight.w800, color: theme.colorScheme.primary),
                          )
                        : null,
                  ),
                ),
              ],
            ),
            bottom: market.error != null && market.indices == null
                ? PreferredSize(
                    preferredSize: const Size.fromHeight(40),
                    child: Container(
                      color: AppColors.loss.withValues(alpha: 0.15),
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                      child: Text('Market data: ${market.error}', style: const TextStyle(color: AppColors.loss, fontSize: 12)),
                    ),
                  )
                : null,
          ),
          // ── LIVE MARKET ──────────────────────────────────────
          SliverToBoxAdapter(
            child: SectionHeader('LIVE MARKET', trailing: Text('LIVE', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: AppColors.gain))),
          ),
          SliverPadding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            sliver: SliverToBoxAdapter(
              child: Row(
                children: [
                  IndexCard(name: 'NIFTY', quote: market.indices?.nifty ?? const Quote()),
                  const SizedBox(width: 10),
                  IndexCard(
                    name: market.indices?.sensex?.error != null ? 'BANKNIFTY' : 'SENSEX',
                    quote: market.indices?.sensex?.error != null ? (market.indices?.banknifty ?? const Quote()) : (market.indices?.sensex ?? const Quote()),
                  ),
                ],
              ),
            ),
          ),
          // ── TOP STOCK GAINERS ────────────────────────────────
          SliverToBoxAdapter(
            child: SectionHeader(
              'TOP STOCK GAINERS',
              trailing: TextButton(onPressed: _openStocks, child: const Text('View all')),
            ),
          ),
          if (market.topStocks.isEmpty)
            const SliverToBoxAdapter(child: _EmptySection('No gainers right now — market may be closed.'))
          else
            SliverList.builder(
              itemCount: market.topStocks.length,
              itemBuilder: (c, i) => GainerTile(gainer: market.topStocks[i], onTap: _openStocks),
            ),
          // ── TOP OPTION GAINERS ───────────────────────────────
          SliverToBoxAdapter(
            child: SectionHeader(
              'TOP OPTION GAINERS',
              trailing: TextButton(onPressed: _openOptions, child: const Text('View all')),
            ),
          ),
          if (market.topOptions.isEmpty)
            const SliverToBoxAdapter(child: _EmptySection('No option gainers right now.'))
          else
            SliverList.builder(
              itemCount: market.topOptions.length,
              itemBuilder: (c, i) => GainerTile(gainer: market.topOptions[i], onTap: _openOptions),
            ),
          // ── TOP STOCK LOSERS ───────────────────────────────────
          SliverToBoxAdapter(
            child: SectionHeader(
              'TOP STOCK LOSERS',
              trailing: TextButton(onPressed: _openStocks, child: const Text('View all')),
            ),
          ),
          if (market.topStockLosers.isEmpty)
            const SliverToBoxAdapter(child: _EmptySection('No stock losers right now — market may be closed.'))
          else
            SliverList.builder(
              itemCount: market.topStockLosers.length,
              itemBuilder: (c, i) => GainerTile(gainer: market.topStockLosers[i], onTap: _openStocks),
            ),
          // ── TOP OPTION LOSERS ──────────────────────────────────
          SliverToBoxAdapter(
            child: SectionHeader(
              'TOP OPTION LOSERS',
              trailing: TextButton(onPressed: _openOptions, child: const Text('View all')),
            ),
          ),
          if (market.topOptionLosers.isEmpty)
            const SliverToBoxAdapter(child: _EmptySection('No option losers right now.'))
          else
            SliverList.builder(
              itemCount: market.topOptionLosers.length,
              itemBuilder: (c, i) => GainerTile(gainer: market.topOptionLosers[i], onTap: _openOptions),
            ),
          // ── TRADES (AI signals) ──────────────────────────────
          SliverToBoxAdapter(
            child: SectionHeader(
              'TRADES',
              trailing: TextButton(onPressed: _openTrades, child: const Text('View all')),
            ),
          ),
          if (!_tradesLoaded)
            const SliverToBoxAdapter(child: Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator())))
          else if (_trades.isEmpty)
            const SliverToBoxAdapter(child: _EmptySection('No AI signals yet — analysis runs during market hours.'))
          else
            SliverList.builder(
              itemCount: _trades.length,
              itemBuilder: (c, i) => _TradeCard(trade: _trades[i]),
            ),
          // ── STOCKS ───────────────────────────────────────────
          SliverToBoxAdapter(
            child: SectionHeader('STOCKS', trailing: TextButton(onPressed: _openStocks, child: const Text('Open'))),
          ),
          const SliverToBoxAdapter(child: SizedBox(height: 8)),
          SliverPadding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            sliver: SliverToBoxAdapter(
              child: _ModuleBanner(
                icon: Icons.business,
                title: 'Stock Analysis',
                subtitle: '1–3 month opportunities with AI targets & stop-loss',
                onTap: _openStocks,
              ),
            ),
          ),
          const SliverToBoxAdapter(child: SizedBox(height: 8)),
          // ── OPTIONS ──────────────────────────────────────────
          SliverToBoxAdapter(
            child: SectionHeader('OPTIONS', trailing: TextButton(onPressed: _openOptions, child: const Text('Open'))),
          ),
          const SliverToBoxAdapter(child: SizedBox(height: 8)),
          SliverPadding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            sliver: SliverToBoxAdapter(
              child: _ModuleBanner(
                icon: Icons.show_chart,
                title: 'Option Opportunities',
                subtitle: 'Intraday / short-term signals with entry, target & stop-loss',
                onTap: _openOptions,
              ),
            ),
          ),
          const SliverToBoxAdapter(child: SizedBox(height: 32)),
        ],
      ),
    );
  }

  void _openTrades() => _openTab(1);
  void _openStocks() => _openTab(2);
  void _openOptions() => _openTab(3);

  void _openTab(int i) {
    final shell = context.findAncestorStateOfType<_DashboardScreenState>();
    shell?.setState(() => shell._tab = i);
  }
}

/// base64 -> Uint8List with a safe fallback for the profile avatar.
Uint8List base64DecodeSafe(String data) {
  try {
    return base64Decode(data);
  } catch (_) {
    return Uint8List(0);
  }
}

class _TradeCard extends StatelessWidget {
  final Trade trade;
  const _TradeCard({required this.trade});

  @override
  Widget build(BuildContext context) {
    final signalColor = trade.signal == 'BUY'
        ? AppColors.gain
        : trade.signal == 'WATCH'
            ? AppColors.gold
            : AppColors.loss;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: signalColor.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    trade.signal,
                    style: TextStyle(color: signalColor, fontWeight: FontWeight.w800, fontSize: 13),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    trade.symbol,
                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (trade.highConfidence)
                  const Icon(Icons.verified, color: AppColors.primary, size: 18),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                _kv('Entry Zone', trade.entryZone),
                _kv('Target', trade.target),
                _kv('Stop Loss', trade.stopLoss),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Text('AI Confidence: ${trade.confidence}%',
                    style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                const Spacer(),
                Text('Risk: ${trade.risk.toUpperCase()}',
                    style: TextStyle(fontSize: 12, color: Colors.grey.shade600)),
                const SizedBox(width: 8),
                Text(trade.timeframe, style: TextStyle(fontSize: 12, color: Colors.grey.shade600)),
              ],
            ),
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
          Text(v.isEmpty ? '—' : v, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }
}

class _ModuleBanner extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  const _ModuleBanner({required this.icon, required this.title, required this.subtitle, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: ListTile(
        contentPadding: const EdgeInsets.all(16),
        leading: Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            color: theme.colorScheme.primary.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Icon(icon, color: theme.colorScheme.primary),
        ),
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.w800)),
        subtitle: Text(subtitle, style: TextStyle(fontSize: 12, color: Colors.grey.shade600)),
        trailing: const Icon(Icons.chevron_right),
        onTap: onTap,
      ),
    );
  }
}

class _EmptySection extends StatelessWidget {
  final String text;
  const _EmptySection(this.text);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 8, 24, 8),
      child: Text(text, style: TextStyle(fontSize: 13, color: Colors.grey.shade500)),
    );
  }
}
