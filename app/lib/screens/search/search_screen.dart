import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../models/models.dart';
import '../../services/api_services.dart';
import '../../widgets/common.dart';
import '../options/option_detail_screen.dart';
import '../stocks/stock_detail_screen.dart';

class SearchScreen extends StatefulWidget {
  const SearchScreen({super.key});

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  final _controller = TextEditingController();
  Timer? _debounce;
  List<InstrumentSearchResult> results = [];
  bool loading = false;
  String? error;

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _onChanged(String q) {
    _debounce?.cancel();
    if (q.trim().isEmpty) {
      setState(() {
        results = [];
        loading = false;
        error = null;
      });
      return;
    }
    setState(() => loading = true);
    _debounce = Timer(const Duration(milliseconds: 400), () => _search(q));
  }

  Future<void> _search(String q) async {
    try {
      final r = await MarketApi.search(q);
      if (!mounted) return;
      setState(() {
        results = r;
        loading = false;
        error = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        loading = false;
        error = e is ApiException ? e.message : 'Search failed';
      });
    }
  }

  void _open(InstrumentSearchResult r) {
    if (r.type == 'option') {
      Navigator.of(context).push(MaterialPageRoute(builder: (_) => OptionDetailScreen(symbol: r.symbol)));
    } else if (r.type == 'index') {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${r.symbol} is displayed live on the Dashboard')),
      );
    } else {
      Navigator.of(context).push(MaterialPageRoute(builder: (_) => StockDetailScreen(symbol: r.symbol, companyName: r.symbol)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: TextField(
          controller: _controller,
          autofocus: true,
          onChanged: _onChanged,
          decoration: const InputDecoration(hintText: 'Search stocks, companies, options...', border: InputBorder.none),
        ),
        actions: [
          if (loading) const Padding(padding: EdgeInsets.all(16), child: SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionHeader('SEARCH'),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 20),
            child: Text('Stocks · Companies · Trading symbols · NIFTY · SENSEX · Options', style: TextStyle(fontSize: 12, color: Colors.grey)),
          ),
          const SizedBox(height: 8),
          if (error != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Text(error!, style: const TextStyle(color: AppColors.loss, fontSize: 13)),
            ),
          Expanded(
            child: results.isEmpty && !loading
                ? Center(
                    child: Text(
                      _controller.text.trim().isEmpty ? 'Type to search instruments' : 'No results found',
                      style: TextStyle(color: Colors.grey.shade500),
                    ),
                  )
                : ListView.builder(
                    itemCount: results.length,
                    itemBuilder: (c, i) {
                      final r = results[i];
                      return ListTile(
                        leading: Icon(
                          r.type == 'option' ? Icons.show_chart : (r.type == 'index' ? Icons.query_stats : Icons.business),
                          color: Theme.of(context).colorScheme.primary,
                        ),
                        title: Text(r.symbol, style: const TextStyle(fontWeight: FontWeight.w700)),
                        subtitle: Text(r.type.toUpperCase() + (r.exchange.isNotEmpty ? ' · ${r.exchange}' : '')),
                        trailing: const Icon(Icons.chevron_right),
                        onTap: () => _open(r),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}
