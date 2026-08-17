import 'package:flutter/material.dart';

import '../../models/models.dart';
import '../../services/api_services.dart';
import '../../widgets/common.dart';

/// Settings -> News API History.
/// Shows every article returned by the Marketaux News API during the last
/// 24 hours (request time, title, main point). Older entries are deleted
/// automatically by the backend.
class NewsHistoryScreen extends StatefulWidget {
  const NewsHistoryScreen({super.key});

  @override
  State<NewsHistoryScreen> createState() => _NewsHistoryScreenState();
}

class _NewsHistoryScreenState extends State<NewsHistoryScreen> {
  List<NewsHistoryEntry> history = [];
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
      final h = await NewsApi.history();
      if (mounted) setState(() {
        history = h;
        loading = false;
      });
    } catch (e) {
      if (mounted) setState(() {
        error = e is ApiException ? e.message : 'Failed to load news history';
        loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('NEWS API HISTORY'),
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
                : history.isEmpty
                    ? ListView(
                        children: const [
                          Padding(
                            padding: EdgeInsets.all(40),
                            child: Column(
                              children: [
                                Icon(Icons.article_outlined, size: 48, color: Colors.grey),
                                SizedBox(height: 12),
                                Text('No news requests yet', style: TextStyle(fontWeight: FontWeight.w800)),
                                SizedBox(height: 6),
                                Text('Articles returned by the Marketaux News API between 08:00–14:00 IST will appear here. History older than 24 hours is deleted automatically.',
                                    textAlign: TextAlign.center, style: TextStyle(fontSize: 13, color: Colors.grey)),
                              ],
                            ),
                          ),
                        ],
                      )
                    : ListView.builder(
                        itemCount: history.length,
                        itemBuilder: (c, i) => _HistoryCard(entry: history[i]),
                      ),
      ),
    );
  }
}

class _HistoryCard extends StatelessWidget {
  final NewsHistoryEntry entry;
  const _HistoryCard({required this.entry});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.access_time, size: 15, color: Colors.grey.shade500),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    'Requested ${timeAgo(entry.requestTime)}',
                    style: TextStyle(fontSize: 12, color: Colors.grey.shade600),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.primary.withValues(alpha: 0.10),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text('${entry.returned} returned',
                      style: TextStyle(fontSize: 11, color: theme.colorScheme.primary, fontWeight: FontWeight.w700)),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(entry.title.isEmpty ? '(untitled article)' : entry.title,
                style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700)),
            if (entry.mainPoint.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(entry.mainPoint, style: TextStyle(fontSize: 12.5, color: Colors.grey.shade700, height: 1.4)),
            ],
            const SizedBox(height: 8),
            Row(
              children: [
                if (entry.source.isNotEmpty) ...[
                  Icon(Icons.public, size: 13, color: Colors.grey.shade500),
                  const SizedBox(width: 4),
                  Flexible(child: Text(entry.source, style: TextStyle(fontSize: 11.5, color: Colors.grey.shade600), overflow: TextOverflow.ellipsis)),
                  const SizedBox(width: 12),
                ],
                if (entry.companies.isNotEmpty)
                  Flexible(
                    child: Text('Companies: ${entry.companies}', style: TextStyle(fontSize: 11.5, color: Colors.grey.shade600), overflow: TextOverflow.ellipsis),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
