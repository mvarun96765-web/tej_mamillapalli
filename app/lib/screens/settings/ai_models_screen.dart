import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../models/models.dart';
import '../../services/api_services.dart';
import 'add_ai_model_screen.dart';

class AiModelsScreen extends StatefulWidget {
  const AiModelsScreen({super.key});

  @override
  State<AiModelsScreen> createState() => _AiModelsScreenState();
}

class _AiModelsScreenState extends State<AiModelsScreen> {
  List<AiModel> models = [];
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
      final r = await AiApi.models();
      if (mounted) setState(() {
        models = (r['models'] as List? ?? []).map((e) => AiModel.fromJson(e as Map<String, dynamic>)).toList();
        loading = false;
      });
    } catch (e) {
      if (mounted) setState(() {
        error = e is ApiException ? e.message : 'Failed to load models';
        loading = false;
      });
    }
  }

  Future<void> _confirmRemove(AiModel m) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Remove AI Model?'),
        content: Text('Remove ${m.provider.toUpperCase()} ${m.model} and its encrypted API key?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.loss),
            onPressed: () => Navigator.pop(c, true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    await AiApi.removeModel(m.id);
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('AI MODELS'),
        actions: [
          IconButton(
            icon: const Icon(Icons.add),
            tooltip: 'Add AI Model',
            onPressed: () async {
              await Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const AddAiModelScreen()),
              );
              await _load();
            },
          ),
        ],
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : error != null
              ? ListView(children: [Padding(padding: const EdgeInsets.all(24), child: Text(error!, textAlign: TextAlign.center))])
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    children: [
                      const Padding(
                        padding: EdgeInsets.fromLTRB(20, 12, 20, 4),
                        child: Text(
                          'API keys are encrypted and never displayed in full.',
                          style: TextStyle(fontSize: 12, color: Colors.grey),
                        ),
                      ),
                      if (models.isEmpty)
                        Padding(
                          padding: const EdgeInsets.all(40),
                          child: Column(
                            children: [
                              const Icon(Icons.smart_toy_outlined, size: 48, color: Colors.grey),
                              const SizedBox(height: 12),
                              const Text('No AI models configured', style: TextStyle(fontWeight: FontWeight.w800)),
                              const SizedBox(height: 8),
                              ElevatedButton.icon(
                                onPressed: () async {
                                  await Navigator.of(context).push(
                                    MaterialPageRoute(builder: (_) => const AddAiModelScreen()),
                                  );
                                  await _load();
                                },
                                icon: const Icon(Icons.add),
                                label: const Text('Add AI Model'),
                              ),
                            ],
                          ),
                        ),
                      ...models.map((m) => _ModelCard(model: m, onTest: () async {
                        final r = await AiApi.testModel(m.id);
                        if (r['ok'] == false) {
                          if (context.mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(r['message'] as String? ?? 'Test failed')));
                          }
                        } else if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Connection healthy')));
                        }
                        await _load();
                      }, onSetPrimary: () async {
                        await AiApi.setPrimary(m.id);
                        await _load();
                      }, onToggle: (v) async {
                        await AiApi.setEnabled(m.id, v);
                        await _load();
                      }, onRemove: () => _confirmRemove(m))),
                      const SizedBox(height: 24),
                    ],
                  ),
                ),
    );
  }
}

class _ModelCard extends StatelessWidget {
  final AiModel model;
  final VoidCallback onTest;
  final VoidCallback onSetPrimary;
  final ValueChanged<bool> onToggle;
  final VoidCallback onRemove;

  const _ModelCard({
    required this.model,
    required this.onTest,
    required this.onSetPrimary,
    required this.onToggle,
    required this.onRemove,
  });

  @override
  Widget build(BuildContext context) {
    final statusColor = model.status == 'CONNECTED'
        ? AppColors.gain
        : model.status == 'DISABLED'
            ? Colors.grey
            : model.status == 'FAILED'
                ? AppColors.loss
                : AppColors.gold;

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text('${model.provider.toUpperCase()} · ${model.model}',
                      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(color: statusColor.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(8)),
                  child: Text(model.status.replaceAll('_', ' '), style: TextStyle(color: statusColor, fontSize: 11, fontWeight: FontWeight.w800)),
                ),
                if (model.isPrimary) ...[
                  const SizedBox(width: 6),
                  const Icon(Icons.star, color: AppColors.gold, size: 18),
                ],
              ],
            ),
            const SizedBox(height: 4),
            Text(
              model.keyHint.isNotEmpty ? 'Key ${model.keyHint}' : 'No key',
              style: const TextStyle(fontSize: 12, color: Colors.grey),
            ),
            if (model.verifiedAt.isNotEmpty)
              Text('Last verified: ${model.verifiedAt}', style: const TextStyle(fontSize: 11, color: Colors.grey)),
            if (model.lastError.isNotEmpty)
              Text(model.lastError, style: const TextStyle(fontSize: 11, color: AppColors.loss)),
            const Divider(height: 20),
            Row(
              children: [
                TextButton(onPressed: onTest, child: const Text('Test Connection')),
                TextButton(onPressed: onSetPrimary, child: const Text('Set as Primary')),
                const Spacer(),
                Switch(value: model.enabled, onChanged: onToggle),
                IconButton(icon: const Icon(Icons.delete_outline, color: AppColors.loss), onPressed: onRemove),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
