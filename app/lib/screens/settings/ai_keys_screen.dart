import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../models/models.dart';
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
  final Map<String, String> draftProviders = {};
  final Map<String, String> draftModels = {};
  final Map<String, bool> enabledMap = {};
  final Map<String, TextEditingController> _modelControllers = {};
  bool loading = true;
  bool saving = false;
  int? testingKey;

  @override
  void dispose() {
    for (final c in _modelControllers.values) {
      c.dispose();
    }
    super.dispose();
  }

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

  Map<String, dynamic>? _providerCfg(String provider) =>
      (meta?['providers'] as Map<String, dynamic>?)?[provider] as Map<String, dynamic>?;

  List<String> _modelsFor(String provider) =>
      (_providerCfg(provider)?['models'] as List? ?? []).cast<String>();

  Future<void> _save() async {
    setState(() => saving = true);
    try {
      final newKeys = <String>[];
      for (var work = 1; work <= 3; work++) {
        final slots = <Map<String, dynamic>>[];
        for (var i = 1; i <= 10; i++) {
          final ref = '$work:$i';
          final existing = _existing(work, i);
          final provider = draftProviders[ref] ?? existing?.provider ?? 'google';
          final model = draftModels[ref] ?? existing?.model ?? '';
          final key = draftKeys[ref] ?? '';
          slots.add({
            'slot': i,
            'provider': provider,
            'model': model,
            'key': key,
            'enabled': enabledMap[ref] ?? existing?.enabled ?? true,
          });
          if (key.isNotEmpty) newKeys.add(ref);
        }
        await AiApi.saveKeys(work, slots);
      }
      draftKeys.clear();
      draftProviders.clear();
      draftModels.clear();
      await _load();

      if (newKeys.isNotEmpty) {
        // Auto-verify every newly entered key and report the result.
        final results = <String>[];
        for (final ref in newKeys) {
          final parts = ref.split(':');
          final k = _existing(int.parse(parts[0]), int.parse(parts[1]));
          if (k == null) continue;
          final r = await AiApi.testKey(k.id);
          final ok = r['ok'] == true;
          results.add('${ok ? '✓' : '✗'} Key ${k.slot}: ${r['message'] ?? (ok ? 'Connected' : 'Failed')}');
        }
        if (!mounted) return;
        final allOk = results.isNotEmpty && results.every((r) => r.startsWith('✓'));
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(allOk ? 'AI Keys Successfully Connected ✓' : results.join('\n')),
          backgroundColor: allOk ? AppColors.gain : AppColors.loss,
          duration: const Duration(seconds: 5),
        ));
        await _load();
      } else if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('AI API keys saved')));
      }
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  Future<void> _test(AiKey key) async {
    setState(() => testingKey = key.id);
    try {
      final r = await AiApi.testKey(key.id);
      if (!mounted) return;
      final ok = r['ok'] == true;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(ok ? 'Key ${key.slot}: AI Key Successfully Connected' : 'Key ${key.slot}: ${r['message'] ?? 'Verification failed'}'),
        backgroundColor: ok ? AppColors.gain : AppColors.loss,
      ));
    } finally {
      if (mounted) {
        setState(() => testingKey = null);
        await _load();
      }
    }
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
                    'Works with any AI provider: Google Gemini, OpenAI, Anthropic, Mistral, Groq, DeepSeek, xAI, Cohere, Together, Perplexity, OpenRouter, local Ollama/LM Studio and custom OpenAI-compatible endpoints. Enter a key and save — it is verified automatically. On quota/rate errors the backend rotates to the next healthy key.',
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
    return List.generate(10, (i) {
      final slot = i + 1;
      final ref = '$work:$slot';
      final existing = _existing(work, slot);
      final provider = draftProviders[ref] ?? existing?.provider ?? 'google';
      final cfg = _providerCfg(provider);
      final models = _modelsFor(provider);
      final draftModel = draftModels[ref];
      final model = draftModel ?? existing?.model ?? (models.isNotEmpty ? models.first : '');

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
                    items: ((meta?['providers'] as Map<String, dynamic>?)?.keys ?? <String>[])
                        .map((p) => DropdownMenuItem(
                              value: p,
                              child: Text(_providerCfg(p)?['label'] as String? ?? p),
                            ))
                        .toList(),
                    onChanged: (v) {
                      if (v == null) return;
                      setState(() {
                        draftProviders[ref] = v;
                        draftModels.remove(ref);
                      });
                    },
                  ),
                  const SizedBox(height: 10),
                  if (models.isNotEmpty)
                    DropdownButtonFormField<String>(
                      initialValue: model,
                      decoration: const InputDecoration(labelText: 'Model', isDense: true),
                      items: models.map((m) => DropdownMenuItem(value: m, child: Text(m))).toList(),
                      onChanged: (v) => setState(() => draftModels[ref] = v ?? ''),
                    )
                  else
                    TextField(
                      controller: _modelControllers.putIfAbsent(ref, () => TextEditingController(text: model)),
                      decoration: const InputDecoration(
                        labelText: 'Model',
                        hintText: 'Enter model name (e.g. my-local-model)',
                        isDense: true,
                      ),
                      onChanged: (v) => draftModels[ref] = v.trim(),
                    ),
                  const SizedBox(height: 10),
                  TextField(
                    obscureText: true,
                    decoration: InputDecoration(
                      labelText: (cfg?['noKey'] == true) ? 'API Key (optional for local models)' : 'API Key',
                      hintText: existing?.keyHint.isNotEmpty == true
                          ? '${existing!.keyHint} (stored — enter only to replace)'
                          : 'Enter API key',
                      isDense: true,
                      suffixIcon: const Icon(Icons.visibility_off, size: 18),
                    ),
                    onChanged: (v) => draftKeys[ref] = v.trim(),
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
                          value: enabledMap[ref] ?? existing?.enabled ?? true,
                          onChanged: (v) => setState(() => enabledMap[ref] = v),
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
