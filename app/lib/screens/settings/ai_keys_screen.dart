import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../models/models.dart';
import '../../services/api_client.dart';
import '../../services/api_services.dart';
import '../../widgets/common.dart';

class AiKeysScreen extends StatefulWidget {
  const AiKeysScreen({super.key});

  @override
  State<AiKeysScreen> createState() => _AiKeysScreenState();
}

class _AiKeysScreenState extends State<AiKeysScreen> {
  Map<int, List<AiKey>> keysByWork = {};
  Map<String, dynamic>? meta;
  final Map<String, String> draftKeys = {}; // "$work:$slot" -> entered key
  final Map<String, bool> enabledMap = {};
  bool loading = true;
  bool saving = false;
  int? testingKey;

  static const _workTitles = {1: 'AI WORK 1', 2: 'AI WORK 2', 3: 'AI WORK 3'};
  static const _workSubtitles = {
    1: 'News Intelligence',
    2: 'Market Impact Analysis',
    3: 'Final Trading Intelligence',
  };

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await AiApi.keys();
      if (!mounted) return;
      setState(() {
        meta = r;
        keysByWork = {1: [], 2: [], 3: []};
        for (final row in r['keys'] as List? ?? []) {
          final k = AiKey.fromJson(row as Map<String, dynamic>);
          keysByWork[k.work]!.add(k);
          enabledMap['${k.work}:${k.slot}'] = k.enabled;
        }
        loading = false;
      });
    } catch (e) {
      if (mounted) setState(() => loading = false);
    }
  }

  AiKey? _existing(int work, int slot) =>
      (keysByWork[work] ?? []).where((k) => k.slot == slot).firstOrNull;

  Future<void> _save() async {
    setState(() => saving = true);
    try {
      for (var work = 1; work <= 3; work++) {
        final slots = <Map<String, dynamic>>[];
        for (var i = 1; i <= 10; i++) {
          final existing = _existing(work, i);
          slots.add({
            'slot': i,
            'provider': existing?.provider ?? 'google',
            'model': existing?.model ?? '',
            'key': draftKeys['$work:$i'] ?? '',
            'enabled': enabledMap['$work:$i'] ?? existing?.enabled ?? true,
          });
        }
        await AiApi.saveKeys(work, slots);
      }
      draftKeys.clear();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('AI API keys saved')));
      }
      await _load();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  Future<void> _test(AiKey key) async {
    setState(() => testingKey = key.id);
    final r = await AiApi.testKey(key.id);
    if (!mounted) return;
    final ok = r['ok'] == true;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text('Key ${key.slot}: ${r['message'] ?? (ok ? 'Working' : 'Failed')}'),
      backgroundColor: ok ? AppColors.gain : AppColors.loss,
    ));
    setState(() => testingKey = null);
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('AI API KEYS'),
        actions: [
          TextButton(
            onPressed: saving ? null : _save,
            child: saving ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('SAVE'),
          ),
        ],
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              children: [
                const Padding(
                  padding: EdgeInsets.fromLTRB(20, 12, 20, 4),
                  child: Text(
                    '3 AI works × 10 keys = 30 configurable keys. Keys are encrypted and never shown in full. On quota/rate errors the backend automatically rotates to the next healthy key.',
                    style: TextStyle(fontSize: 12, color: Colors.grey, height: 1.4),
                  ),
                ),
                for (var work = 1; work <= 3; work++) ...[
                  SectionHeader(
                    '${_workTitles[work]} · ${_workSubtitles[work]}',
                    padding: const EdgeInsets.fromLTRB(20, 20, 20, 6),
                  ),
                  ..._buildWork(work),
                ],
                const SizedBox(height: 24),
              ],
            ),
    );
  }

  List<Widget> _buildWork(int work) {
    final providers = (meta?['providers'] as Map<String, dynamic>?) ?? {};

    return List.generate(10, (i) {
      final slot = i + 1;
      final existing = _existing(work, slot);
      final provider = existing?.provider ?? 'google';
      final models = ((providers[provider] as Map<String, dynamic>?)?['models'] as List? ?? []).cast<String>();

      return Card(
        margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
        child: ExpansionTile(
          leading: CircleAvatar(
            radius: 14,
            backgroundColor: _statusColor(existing?.status ?? 'UNKNOWN').withValues(alpha: 0.15),
            child: Icon(Icons.key, size: 16, color: _statusColor(existing?.status ?? 'UNKNOWN')),
          ),
          title: Text('API Key ${slot.toString().padLeft(2, '0')}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700)),
          subtitle: Row(
            children: [
              Flexible(
                child: Text(
                  existing?.keyHint.isNotEmpty == true ? existing!.keyHint : 'Not set',
                  style: const TextStyle(fontSize: 12),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: 10),
              if (existing != null)
                Text(existing.status, style: TextStyle(fontSize: 11, color: _statusColor(existing.status), fontWeight: FontWeight.w700)),
            ],
          ),
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  DropdownButtonFormField<String>(
                    initialValue: provider,
                    decoration: const InputDecoration(labelText: 'AI Provider', isDense: true),
                    items: providers.keys
                        .map((p) => DropdownMenuItem(
                              value: p,
                              child: Text((providers[p] as Map<String, dynamic>?)?['label'] as String? ?? p),
                            ))
                        .toList(),
                    onChanged: (_) => setState(() {}),
                  ),
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    initialValue: existing?.model ?? (models.isNotEmpty ? models.first : ''),
                    decoration: const InputDecoration(labelText: 'Model', isDense: true),
                    items: models.map((m) => DropdownMenuItem(value: m, child: Text(m))).toList(),
                    onChanged: (_) => setState(() {}),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    obscureText: true,
                    decoration: InputDecoration(
                      labelText: 'API Key',
                      hintText: existing?.keyHint.isNotEmpty == true
                          ? '${existing!.keyHint} (stored — enter only to replace)'
                          : 'Enter API key',
                      isDense: true,
                      suffixIcon: const Icon(Icons.visibility_off, size: 18),
                    ),
                    onChanged: (v) => draftKeys['$work:$slot'] = v.trim(),
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton(
                          onPressed: existing == null || testingKey == existing.id ? null : () => _test(existing),
                          child: Text(testingKey == existing?.id ? 'Testing...' : 'Test Key'),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: SwitchListTile(
                          contentPadding: EdgeInsets.zero,
                          title: const Text('Enabled', style: TextStyle(fontSize: 12)),
                          value: enabledMap['$work:$slot'] ?? existing?.enabled ?? true,
                          onChanged: (v) => setState(() => enabledMap['$work:$slot'] = v),
                        ),
                      ),
                    ],
                  ),
                  if (existing?.lastError.isNotEmpty == true)
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Text('Last error: ${existing!.lastError}', style: const TextStyle(fontSize: 11, color: Colors.grey)),
                    ),
                ],
              ),
            ),
          ],
        ),
      );
    });
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'ACTIVE':
        return AppColors.gain;
      case 'RATE_LIMITED':
      case 'QUOTA_EXCEEDED':
        return AppColors.gold;
      case 'INVALID':
        return AppColors.loss;
      case 'DISABLED':
        return Colors.grey;
      default:
        return Colors.blueGrey;
    }
  }
}
